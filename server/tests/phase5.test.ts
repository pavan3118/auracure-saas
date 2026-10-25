import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  randomUUID,
  randomBytes,
  generateKeyPairSync,
  createHmac,
} from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { connect, type Database } from "../src/db.js";
import { Identity, passwordHash } from "../src/auth.js";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { roles, type Role, type Principal } from "../src/types.js";
import { digest, seal, newSecret, open } from "../src/crypto.js";
import { Platform } from "../src/modules/platform/service.js";
let db: Database,
  identity: Identity,
  app: Awaited<ReturnType<typeof createApp>>,
  hash: string,
  docsDir: string;
const webhookSecret = randomBytes(32).toString("hex");
const accounts = new Map<string, { id: string; token: string }>(),
  password = "phase five fixture password",
  key = () => randomUUID();
const actor = (role: Role = "OWNER", tenant = "alpha", second = false) =>
  accounts.get(`${tenant}:${role}${second ? ":2" : ""}`)!;
function get(path: string, role: Role = "OWNER", tenant = "alpha") {
  return request(app)
    .get(`/api/v1${path}`)
    .auth(actor(role, tenant).token, { type: "bearer" });
}
function post(
  path: string,
  body: unknown,
  role: Role = "OWNER",
  k = key(),
  tenant = "alpha",
) {
  return request(app)
    .post(`/api/v1${path}`)
    .auth(actor(role, tenant).token, { type: "bearer" })
    .set("Idempotency-Key", k)
    .send(body);
}
async function principal(role: Role = "OWNER"): Promise<Principal> {
  return (await identity.authenticate(actor(role).token)).principal;
}
async function patient(verified = true, mobile = false) {
  const login = mobile
    ? `+919${String(Date.now()).slice(-9)}`
    : `${key()}@patient.test`;
  const u = await db.users("alpha").create({
    name: "Synthetic Portal Patient",
    login,
    role: "PATIENT",
    contactVerified: verified,
    pinHash: await identity.hashPin("5831"),
  });
  const pat = await db.patients("alpha").create({
    name: u.name,
    searchName: "synthetic portal patient",
    contactType: mobile ? "MOBILE" : "EMAIL",
    contactValue: login,
    userId: u._id,
    version: 0,
  });
  return { u, pat, token: (await identity.session(u)).access_token };
}
function own(token: string, path: string) {
  return request(app).get(`/api/v1${path}`).auth(token, { type: "bearer" });
}
function ownPost(token: string, path: string, body: unknown) {
  return request(app)
    .post(`/api/v1${path}`)
    .auth(token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .send(body);
}
async function activation(p: Awaited<ReturnType<typeof patient>>) {
  await identity.requestPatientActivation("alpha", p.u.login);
  const [m] = await db
    .outbox("alpha")
    .list({ recipient: p.u.login }, { sort: { createdAt: -1 }, limit: 1 });
  return /token=([\w-]+)/.exec(
    open(m!.encryptedBody, identity.config.encryptionKey),
  )![1]!;
}
async function clinical() {
  const p = await patient();
  const v = await db.visits("alpha").create({
    patientId: p.pat._id,
    doctorId: actor("DOCTOR").id,
    state: "COMPLETED",
    queueNumber: Date.now(),
    queuedAt: new Date(),
    completedAt: new Date(),
    checkInKey: key(),
    requestHash: "fixture",
  });
  const rx = await db.prescriptions("alpha").create({
    visitId: v._id,
    patientId: p.pat._id,
    authorId: actor("DOCTOR").id,
    revision: 1,
    state: "SIGNED",
    items: [
      {
        medicine: "Synthetic medicine",
        strength: "10 mg",
        dose: "One tablet",
        route: "Oral",
        frequency: "Manual",
        duration: "Manual",
        quantity: 3,
      },
    ],
    signedAt: new Date(),
    signedBy: actor("DOCTOR").id,
    contentHash: "fixture",
    operationKey: key(),
  });
  const order = await db.labOrders("alpha").create({
    visitId: v._id,
    patientId: p.pat._id,
    doctorId: actor("DOCTOR").id,
    tests: [{ name: "Synthetic test" }],
    state: "RELEASED",
    operationKey: key(),
  });
  const result = await db.labResults("alpha").create({
    orderId: order._id,
    visitId: v._id,
    patientId: p.pat._id,
    doctorId: actor("DOCTOR").id,
    revision: 1,
    state: "RELEASED",
    observations: [
      {
        name: "Synthetic analyte",
        value: "12",
        unit: "u",
        referenceInterval: "Manual",
        comments: "",
      },
    ],
    signedAt: new Date(),
    verifiedAt: new Date(),
    releasedAt: new Date(),
    operationKey: key(),
  });
  await db
    .labOrders("alpha")
    .update({ _id: order._id }, { $set: { currentResultId: result._id } });
  return { ...p, v, rx, order, result };
}
async function proof() {
  const v = key();
  await db
    .users("alpha")
    .update({ _id: actor().id }, { $push: { recoveryHashes: digest(v) } });
  return v;
}
async function credit(units = 3) {
  return post("/platform/wallet/test-credits", {
    units,
    mfa_proof: await proof(),
  }).expect(201);
}
async function callback(
  reference: string,
  status = "DELIVERED",
  event = key(),
  bad = false,
) {
  const body = JSON.stringify({ event_id: event, reference, status }),
    ts = String(Math.floor(Date.now() / 1000)),
    sig = createHmac("sha256", bad ? "invalid" : webhookSecret)
      .update(`${ts}.${body}`)
      .digest("hex");
  return request(app)
    .post("/api/v1/providers/sandbox/message")
    .set("Content-Type", "application/json")
    .set("Sandbox-Signature", `t=${ts},v1=${sig}`)
    .send(body);
}
beforeAll(async () => {
  docsDir = await mkdtemp(join(tmpdir(), "auracare-test-docs-"));
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const uri = new URL(
    process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017/?replicaSet=rs0",
  );
  uri.pathname = `/auracare_test_phase5_${randomUUID().replaceAll("-", "")}`;
  const cfg: Config = {
    mongoUri: uri.toString(),
    documentsDir: docsDir,
    sandboxWebhookSecret: webhookSecret,
    origin: "http://localhost:5173",
    port: 3000,
    production: false,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    encryptionKey: randomBytes(32),
    pinPepper: randomBytes(32),
    issuer: "phase5",
    audience: "tenant",
    mailDir: ".local/test-mail",
    mailFrom: "phase5@test.test",
  };
  db = await connect(cfg.mongoUri);
  identity = await Identity.create(db, cfg, { send: async () => {} });
  app = await createApp(identity);
  hash = await passwordHash(password);
  for (const tenant of ["alpha", "beta"]) {
    await db.tenants(tenant).create({
      _id: tenant,
      name: tenant,
      type: "CLINIC",
      subdomain: tenant,
      status: "ACTIVE",
      ownerId: "owner",
      capacity: 5,
    });
    for (const role of roles) {
      const u = await db.users(tenant).create({
        name: `${role} test`,
        login: `${role}@${tenant}.test`,
        role,
        passwordHash: hash,
        mfaEnabled: role === "OWNER",
        mfaSecret: role === "OWNER" ? seal(newSecret(), cfg.encryptionKey) : "",
        contactVerified: true,
        licenceStatus: role === "PHARMACIST" ? "VERIFIED" : "PENDING",
        signoffPinHash: role === "LAB" ? await identity.hashPin("827391") : "",
      });
      const session = await identity.session(u);
      accounts.set(`${tenant}:${role}`, {
        id: u._id,
        token: session.access_token,
      });
    }
    const second = await db.users(tenant).create({
      name: "Second Doctor",
      login: `second@${tenant}.test`,
      role: "DOCTOR",
      passwordHash: hash,
      contactVerified: true,
    });
    accounts.set(`${tenant}:DOCTOR:2`, {
      id: second._id,
      token: (await identity.session(second)).access_token,
    });
  }
});
afterAll(async () => {
  if (db) {
    expect(db.connection.name).toMatch(/^auracare_test_/);
    await db.connection.dropDatabase();
    await db.connection.close();
  }
  if (docsDir) await rm(docsDir, { recursive: true, force: true });
});
describe("Phase 5 role and ownership boundaries", () => {
  for (const role of roles)
    it(`${role} has only its portal/platform permissions`, async () => {
      await get("/portal", role).expect(role === "PATIENT" ? 404 : 403);
      await get(
        `/platform/usage?month=${new Date().toISOString().slice(0, 7)}`,
        role,
      ).expect(role === "OWNER" ? 200 : 403);
      if (role !== "PATIENT")
        await post(
          "/portal/documents",
          { kind: "INVOICE", source_id: key() },
          role,
        ).expect(403);
      if (role !== "OWNER")
        await post(
          "/platform/messages",
          { patient_id: key(), channel: "SMS" },
          role,
        ).expect(403);
    });
  it("returns only linked records and rejects tenant scope injection", async () => {
    const f = await clinical(),
      g = await clinical();
    const r = await own(f.token, "/portal").expect(200);
    expect(r.body.data.visits.map((v: { id: string }) => v.id)).toEqual([
      f.v._id,
    ]);
    expect(r.body.data.prescriptions.map((v: { id: string }) => v.id)).toEqual([
      f.rx._id,
    ]);
    expect(JSON.stringify(r.body.data)).not.toMatch(
      /assessment|complaint|passwordHash|pinHash/,
    );
    await own(f.token, `/prescriptions/${g.rx._id}`).expect(404);
    await own(f.token, "/portal?tenant_id=beta").expect(400);
    await ownPost(f.token, "/portal/documents", {
      kind: "PRESCRIPTION",
      source_id: g.rx._id,
    }).expect(404);
    await ownPost(f.token, "/portal/documents", {
      kind: "PRESCRIPTION",
      source_id: f.rx._id,
      tenant_id: "beta",
    }).expect(400);
    await get(`/prescriptions/${f.rx._id}`, "PATIENT", "beta").expect(404);
  });
});
describe("patient activation ownership proof", () => {
  it("has generic responses without letting staff activate or view the PIN", async () => {
    const f = await patient(false);
    const a = await request(app)
      .post("/api/v1/auth/patient-activation-requests")
      .send({ facility_subdomain: "alpha", login: f.u.login })
      .expect(202);
    const b = await request(app)
      .post("/api/v1/auth/patient-activation-requests")
      .send({ facility_subdomain: "alpha", login: "unknown@patient.test" })
      .expect(202);
    expect(a.body.data).toEqual(b.body.data);
    await request(app)
      .post("/api/v1/auth/patient-activation")
      .send({ token: "invalid", portal_pin: "5831" })
      .expect(400);
    expect(
      (await db.users("alpha").findOne({ _id: f.u._id }))!.contactVerified,
    ).toBe(false);
  });
  it("consumes a tenant-bound link once, invalidates old credentials and enables chosen PIN login", async () => {
    const f = await patient(false),
      raw = await activation(f);
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post("/api/v1/auth/patient-activation")
          .send({ token: raw, portal_pin: "6842" }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    await own(f.token, "/portal").expect(401);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({
        facility_subdomain: "alpha",
        login: f.u.login,
        portal_pin: "6842",
      })
      .expect(200);
    await own(login.body.data.access_token, "/portal").expect(200);
    expect(JSON.stringify(await db.audits("alpha").find())).not.toContain(
      "6842",
    );
  });
  it("invalidates earlier activation links and refuses expired/foreign-account grants", async () => {
    const f = await patient(false),
      first = await activation(f),
      second = await activation(f);
    await expect(
      identity.activatePatient(first, "5831", "test"),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
    const c = await db.resolveChallenge(digest(second), "PATIENT_ACTIVATE");
    await db
      .challenges("alpha")
      .update({ _id: c!._id }, { $set: { expiresAt: new Date(0) } });
    await expect(
      identity.activatePatient(second, "5831", "test"),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
  });
});
describe("private PDF storage and reauthorization", () => {
  it("generates one private checksummed document under simultaneous requests", async () => {
    const f = await clinical(),
      body = { kind: "PRESCRIPTION", source_id: f.rx._id };
    const results = await Promise.all(
      [1, 2].map(() => ownPost(f.token, "/portal/documents", body)),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const id = results[0]!.body.data.id;
    expect(results[1]!.body.data.id).toBe(id);
    const d = await db.documents("alpha").findOne({ _id: id });
    expect(d!.sizeBytes).toBeGreaterThan(1000);
    const bytes = await readFile(join(docsDir, d!.storageKey));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await own(f.token, `/portal/documents/${id}/download`)
      .expect("Content-Type", /application\/pdf/)
      .expect(200);
    await get(`/portal/documents/${id}/download`, "PATIENT", "beta").expect(
      404,
    );
    const g = await patient();
    await own(g.token, `/portal/documents/${id}/download`).expect(404);
    expect(JSON.stringify(results[0]!.body.data)).not.toMatch(
      /storageKey|checksum|recipient/,
    );
  });
  it("binds PDF request retry keys to the authorized source", async () => {
    const f = await clinical(),
      k = key();
    await request(app)
      .post("/api/v1/portal/documents")
      .auth(f.token, { type: "bearer" })
      .set("Idempotency-Key", k)
      .send({ kind: "PRESCRIPTION", source_id: f.rx._id })
      .expect(201);
    await request(app)
      .post("/api/v1/portal/documents")
      .auth(f.token, { type: "bearer" })
      .set("Idempotency-Key", k)
      .send({ kind: "LAB_RESULT", source_id: f.result._id })
      .expect(409);
  });
  it("withholds an existing PDF when a lab correction withdraws that release", async () => {
    const f = await clinical(),
      doc = (
        await ownPost(f.token, "/portal/documents", {
          kind: "LAB_RESULT",
          source_id: f.result._id,
        }).expect(201)
      ).body.data;
    await db
      .labOrders("alpha")
      .update(
        { _id: f.order._id },
        { $set: { state: "RESULT_DRAFT", currentResultId: key() } },
      );
    await own(f.token, `/portal/documents/${doc.id}/download`).expect(404);
    const r = await own(f.token, "/portal").expect(200);
    expect(r.body.data.documents).toHaveLength(0);
    expect(r.body.data.lab_orders[0].released_result_id).toBeNull();
  });
  it("fails closed for tampered or missing objects", async () => {
    const f = await clinical(),
      doc = (
        await ownPost(f.token, "/portal/documents", {
          kind: "PRESCRIPTION",
          source_id: f.rx._id,
        }).expect(201)
      ).body.data;
    const d = await db.documents("alpha").findOne({ _id: doc.id });
    await writeFile(join(docsDir, d!.storageKey), "corrupt synthetic object");
    await own(f.token, `/portal/documents/${doc.id}/download`).expect(503);
  });
  it("does not silently replace unsupported clinical characters in PDFs", async () => {
    const f = await clinical();
    await db
      .prescriptions("alpha")
      .update(
        { _id: f.rx._id },
        { $set: { notes: "Synthetic unsupported emoji 🧬" } },
      );
    await ownPost(f.token, "/portal/documents", {
      kind: "PRESCRIPTION",
      source_id: f.rx._id,
    }).expect(422);
    expect(await db.documents("alpha").count({ sourceId: f.rx._id })).toBe(0);
  });
});
describe("usage measurement and reconciliation", () => {
  it("aggregates more than a display page of consultation events and uses UTC month boundaries", async () => {
    const month = "2025-02",
      from = new Date(`${month}-01T00:00:00Z`),
      p = await patient();
    for (let i = 0; i < 105; i++) {
      const v = await db.visits("alpha").create({
        patientId: p.pat._id,
        doctorId: actor("DOCTOR").id,
        state: "COMPLETED",
        queueNumber: i + 1,
        queuedAt: from,
        completedAt: from,
        checkInKey: key(),
        requestHash: "fixture",
      });
      await db.usage("alpha").create({
        meter: "COMPLETED_CONSULTATION",
        sourceId: v._id,
        quantity: 1,
        unit: "encounter",
        effectiveAt: from,
      });
    }
    await db.usage("alpha").create({
      meter: "COMPLETED_CONSULTATION",
      sourceId: key(),
      quantity: 1,
      unit: "encounter",
      effectiveAt: new Date("2025-03-01T00:00:00Z"),
    });
    const r = (await get(`/platform/usage?month=${month}`).expect(200)).body
      .data;
    expect(r.completed_consultations).toBe(105);
    expect(r.consultation_slabs).toBe(2);
    expect(r.consultation_reconciled).toBe(true);
    expect(r.coverage_complete).toBe(false);
    expect(r.estimate_minor).toBeNull();
    expect(r.charges_enabled).toBe(false);
    await post("/platform/bills/preview", { month }).expect(409);
  });
  it("captures each UTC day once and does not invent gaps or prior storage", async () => {
    const platform = new Platform(identity),
      now = new Date("2025-04-01T18:00:00Z");
    await Promise.all([
      platform.snapshot("alpha", now),
      platform.snapshot("alpha", now),
    ]);
    const r = await platform.usage(await principal(), "2025-04");
    expect(r.observed_days).toEqual(["2025-04-01"]);
    expect(r.clinician_seat_days).toBe(2);
    expect(r.coverage_complete).toBe(false);
    const expected = await db.documents("alpha").sum({}, "sizeBytes");
    expect(r.pdf_byte_days).toBe(expected);
    const beta = (await get("/platform/usage?month=2025-04", "OWNER", "beta"))
      .body.data;
    expect(beta.clinician_seat_days).toBe(0);
  });
  it("rejects malformed periods and flags a source reconciliation discrepancy", async () => {
    await get("/platform/usage?month=2025-13").expect(400);
    const r = (await get("/platform/usage?month=2025-03").expect(200)).body
      .data;
    expect(r.consultation_reconciled).toBe(false);
  });
});
describe("sandbox wallet/provider callback safety", () => {
  it("reserves credits without overspending and debits accepted messages once", async () => {
    await credit(1);
    const f = await patient(true, true),
      body = { patient_id: f.pat._id, channel: "SMS" };
    const results = await Promise.all(
      [1, 2].map(() => post("/platform/messages", body)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const accepted = results.find((r) => r.status === 201)!.body.data;
    const before = await db.wallets("alpha").findOne({});
    expect(before!.balance).toBe(1);
    expect(before!.held).toBe(1);
    const platform = new Platform(identity);
    await Promise.all([platform.sendPending(), platform.sendPending()]);
    const after = await db.wallets("alpha").findOne({});
    expect(after!.balance).toBe(0);
    expect(after!.held).toBe(0);
    expect(
      await db
        .walletEntries("alpha")
        .count({ source: `accepted:${accepted.id}` }),
    ).toBe(1);
  });
  it("authenticates raw callbacks, deduplicates concurrent retries and compensates definitive failure once", async () => {
    await credit(1);
    const f = await patient(true, true),
      id = (
        await post("/platform/messages", {
          patient_id: f.pat._id,
          channel: "WHATSAPP",
        }).expect(201)
      ).body.data.id;
    await new Platform(identity).sendPending();
    const j = await db.messages("alpha").findOne({ _id: id });
    await callback(j!.providerRef, "FAILED", key(), true).then((r) =>
      expect(r.status).toBe(401),
    );
    const event = key();
    const results = await Promise.all([
      callback(j!.providerRef, "FAILED", event),
      callback(j!.providerRef, "FAILED", event),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await db.walletEntries("alpha").count({ source: `refund:${id}` }),
    ).toBe(1);
    expect((await db.wallets("alpha").findOne({}))!.balance).toBe(1);
    await callback(j!.providerRef, "DELIVERED", event).then((r) =>
      expect(r.status).toBe(409),
    );
    await callback(j!.providerRef, "DELIVERED", key()).then((r) =>
      expect(r.status).toBe(409),
    );
  });
  it("rejects unsigned, old and tenant-injected callbacks and unverified/arbitrary recipients", async () => {
    await request(app)
      .post("/api/v1/providers/sandbox/message")
      .send({ event_id: key(), reference: key(), status: "FAILED" })
      .expect(401);
    const raw = JSON.stringify({
        event_id: key(),
        reference: key(),
        status: "FAILED",
      }),
      ts = "1000000000",
      sig = createHmac("sha256", webhookSecret)
        .update(`${ts}.${raw}`)
        .digest("hex");
    await request(app)
      .post("/api/v1/providers/sandbox/message")
      .set("Content-Type", "application/json")
      .set("Sandbox-Signature", `t=${ts},v1=${sig}`)
      .send(raw)
      .expect(401);
    const f = await patient(false, true);
    await post("/platform/messages", {
      patient_id: f.pat._id,
      channel: "SMS",
    }).expect(400);
    await post("/platform/messages", {
      patient_id: f.pat._id,
      channel: "SMS",
      recipient: "+919999999999",
    }).expect(400);
  });
  it("requires explicit rates and complete history before a closed-period bill preview", async () => {
    identity.config.prices = {
      version: "test-rates",
      seatMinor: 1000,
      slabMinor: 200,
      gbMinor: 100,
    };
    const platform = new Platform(identity);
    for (let day = 1; day <= 30; day++)
      await db.dailyUsage("alpha").create({
        day: `2025-06-${String(day).padStart(2, "0")}`,
        observedAt: new Date(
          `2025-06-${String(day).padStart(2, "0")}T00:00:00Z`,
        ),
        clinicians: 1,
        pdfBytes: 1000000000,
      });
    const quote = await platform.usage(await principal(), "2025-06");
    expect(quote.estimate_minor).toBe(1100);
    expect(quote.charges_enabled).toBe(false);
    await post("/platform/bills/preview", { month: "2025-06" }).expect(201);
    const b = await db.platformBills("alpha").findOne({ month: "2025-06" });
    expect(b!.amountMinor).toBe(1100);
    const raw = JSON.stringify({
        event_id: key(),
        reference: b!.providerRef,
        status: "PAID",
      }),
      ts = String(Math.floor(Date.now() / 1000)),
      signature = createHmac("sha256", webhookSecret)
        .update(`${ts}.${raw}`)
        .digest("hex");
    await request(app)
      .post("/api/v1/providers/sandbox/bill")
      .set("Content-Type", "application/json")
      .set("Sandbox-Signature", `t=${ts},v1=${signature}`)
      .send(raw)
      .expect(200);
    expect(
      (await db.platformBills("alpha").findOne({ _id: b!._id }))!.state,
    ).toBe("PAID");

    identity.config.prices = undefined;
  });
  it("fails closed for sandbox actions and callbacks in production", async () => {
    identity.config.production = true;
    try {
      await post("/platform/wallet/test-credits", {
        units: 1,
        mfa_proof: "unused",
      }).expect(503);
      await request(app)
        .post("/api/v1/providers/sandbox/message")
        .send({})
        .expect(503);
    } finally {
      identity.config.production = false;
    }
  });
  it("keeps provider bodies, PINs and clinical content out of audit/retry entries", async () => {
    const records = JSON.stringify({
      audit: await db.audits("alpha").find(),
      ops: await db.operations("alpha").find(),
    });
    expect(records).not.toMatch(
      /5831|6842|Synthetic analyte|encryptedBody|phase five fixture password/,
    );
  });
});

it("backs off an ambiguous adapter failure without charging or blocking newer jobs", async () => {
  await credit(2);
  const f = await patient(true, true),
    id = (
      await post("/platform/messages", {
        patient_id: f.pat._id,
        channel: "SMS",
      }).expect(201)
    ).body.data.id;
  const before = await db.wallets("alpha").findOne({});
  await new Platform(identity, {
    send: async () => {
      throw new Error("Synthetic adapter outage");
    },
  }).sendPending();
  const pending = await db.messages("alpha").findOne({ _id: id });
  expect(pending!.state).toBe("QUEUED");
  expect(pending!.attempts).toBe(1);
  expect(+pending!.nextAttempt).toBeGreaterThan(Date.now());
  expect((await db.wallets("alpha").findOne({}))!.balance).toBe(
    before!.balance,
  );
  const g = await patient(true, true),
    second = (
      await post("/platform/messages", {
        patient_id: g.pat._id,
        channel: "SMS",
      }).expect(201)
    ).body.data.id;
  await new Platform(identity).sendPending();
  expect((await db.messages("alpha").findOne({ _id: second }))!.state).toBe(
    "ACCEPTED",
  );
  expect((await db.messages("alpha").findOne({ _id: id }))!.state).toBe(
    "QUEUED",
  );
});
