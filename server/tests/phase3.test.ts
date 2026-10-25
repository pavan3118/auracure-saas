import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID, randomBytes, generateKeyPairSync } from "node:crypto";
import request from "supertest";
import { connect, type Database } from "../src/db.js";
import { Identity, passwordHash } from "../src/auth.js";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { roles, type Role } from "../src/types.js";
let db: Database,
  identity: Identity,
  app: Awaited<ReturnType<typeof createApp>>,
  hash: string;
const accounts = new Map<string, { id: string; token: string }>();
const password = "phase three doctor password";
const key = () => randomUUID();
const actor = (role: Role = "DOCTOR", tenant = "alpha", second = false) =>
  accounts.get(`${tenant}:${role}${second ? ":2" : ""}`)!;
const medicine = {
  medicine: "Manual test medicine",
  strength: "10 mg",
  dose: "One tablet",
  route: "Oral",
  frequency: "As prescribed by clinician",
  duration: "Three days",
  quantity: 3,
  instructions: "Synthetic test only",
};
async function queued(tenant = "alpha") {
  const id = key(),
    user = await db.users(tenant).create({
      name: "Synthetic Patient",
      login: `${id}@patient.test`,
      role: "PATIENT",
      passwordHash: "",
      contactVerified: true,
      pinHash: hash,
    });
  const patient = await db.patients(tenant).create({
    name: "Synthetic Patient",
    searchName: "synthetic patient",
    contactType: "EMAIL",
    contactValue: user.login,
    dateOfBirth: "1990-05-20",
    userId: user._id,
    version: 0,
  });
  const t = await db
    .tenants(tenant)
    .update({ _id: tenant }, { $inc: { queueSequence: 1 } });
  const visit = await db.visits(tenant).create({
    patientId: patient._id,
    doctorId: "",
    state: "QUEUED",
    queueNumber: t!.queueSequence,
    queuedAt: new Date(),
    version: 0,
    checkInKey: key(),
    requestHash: "fixture",
  });
  return { visit, patient, user };
}
async function claim(second = false, tenant = "alpha", k = key()) {
  const r = await request(app)
    .post("/api/v1/queue/claim-next")
    .auth(actor("DOCTOR", tenant, second).token, { type: "bearer" })
    .set("Idempotency-Key", k)
    .send({})
    .expect(201);
  return r.body.data as {
    visit: { id: string; version: number };
    consultation: { version: number };
    patient: { id: string };
  };
}
async function active() {
  const fixture = await queued();
  return { ...fixture, detail: await claim() };
}
async function notes(id: string, second = false) {
  return request(app)
    .patch(`/api/v1/visits/${id}/consultation`)
    .auth(actor("DOCTOR", "alpha", second).token, { type: "bearer" })
    .send({
      complaint: "Synthetic presenting complaint",
      assessment: "Synthetic assessment",
      plan: "Manual plan",
      expected_version: 0,
    })
    .expect(200);
}
async function draft(id: string) {
  const r = await request(app)
    .post(`/api/v1/visits/${id}/prescriptions`)
    .auth(actor().token, { type: "bearer" })
    .set("Idempotency-Key", key())
    .send({})
    .expect(201);
  return r.body.data as { id: string; version: number; state: string };
}
async function leased(id: string, version: number) {
  const r = await request(app)
    .post(`/api/v1/prescriptions/${id}/lease`)
    .auth(actor().token, { type: "bearer" })
    .send({ expected_version: version })
    .expect(200);
  return r.body.data as {
    id: string;
    version: number;
    lease_expires_at: string;
  };
}
async function saved(id: string, version: number) {
  const r = await request(app)
    .patch(`/api/v1/prescriptions/${id}`)
    .auth(actor().token, { type: "bearer" })
    .send({
      expected_version: version,
      items: [medicine],
      notes: "Synthetic prescription notes",
    })
    .expect(200);
  return r.body.data as { id: string; version: number };
}
async function signed(id: string, version: number, k = key()) {
  const r = await request(app)
    .post(`/api/v1/prescriptions/${id}/sign`)
    .auth(actor().token, { type: "bearer" })
    .set("Idempotency-Key", k)
    .send({ expected_version: version, password })
    .expect(200);
  return r.body.data as {
    id: string;
    version: number;
    state: string;
    content_hash: string;
    signed_at: string;
  };
}
async function fullRx() {
  const f = await active(),
    rx = await draft(f.visit._id),
    lease = await leased(rx.id, rx.version),
    save = await saved(rx.id, lease.version),
    sign = await signed(rx.id, save.version);
  return { ...f, rx, lease, save, sign };
}
async function complete(id: string, k = key()) {
  const v = await db.visits("alpha").findOne({ _id: id });
  return request(app)
    .post(`/api/v1/visits/${id}/complete`)
    .auth(actor().token, { type: "bearer" })
    .set("Idempotency-Key", k)
    .send({ expected_version: v!.version });
}
beforeAll(async () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const uri = new URL(
    process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017/?replicaSet=rs0",
  );
  uri.pathname = `/auracare_test_phase3_${randomUUID().replaceAll("-", "")}`;
  const cfg: Config = {
    mongoUri: uri.toString(),
    origin: "http://localhost:5173",
    port: 3000,
    production: false,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    encryptionKey: randomBytes(32),
    pinPepper: randomBytes(32),
    issuer: "phase3",
    audience: "tenant",
    mailDir: ".local/test-mail",
    mailFrom: "phase3@test.test",
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
        contactVerified: true,
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
beforeEach(async () => {
  for (const t of ["alpha", "beta"])
    await db
      .visits(t)
      .updateMany(
        { state: { $in: ["QUEUED", "IN_CONSULTATION"] } },
        { $set: { state: "CANCELLED" } },
      );
  await db.connection.collection("ratebuckets").deleteMany({});
});
afterAll(async () => {
  if (db) {
    expect(db.connection.name).toMatch(/^auracare_test_/);
    await db.connection.dropDatabase();
    await db.connection.close();
  }
});
describe("doctor permissions and tenant/assignment boundaries", () => {
  for (const role of roles)
    it(`${role} has only its authorized clinical access`, async () => {
      await request(app)
        .get("/api/v1/doctor/workspace")
        .auth(actor(role).token, { type: "bearer" })
        .expect(role === "DOCTOR" ? 200 : 403);
      await request(app)
        .get("/api/v1/doctor/visits")
        .auth(actor(role).token, { type: "bearer" })
        .expect(role === "DOCTOR" ? 200 : 403);
      if (role !== "DOCTOR")
        await request(app)
          .post("/api/v1/queue/claim-next")
          .auth(actor(role).token, { type: "bearer" })
          .set("Idempotency-Key", key())
          .send({})
          .expect(403);
    });
  it("requires a full session and rejects scope injection", async () => {
    await request(app).get("/api/v1/doctor/workspace").expect(401);
    await request(app)
      .get("/api/v1/doctor/workspace?tenant_id=beta")
      .auth(actor().token, { type: "bearer" })
      .expect(400);
    await request(app)
      .post("/api/v1/queue/claim-next")
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ tenant_id: "beta" })
      .expect(400);
  });
  it("denies other doctors and tenants access to the assigned patient, notes and encounter", async () => {
    const f = await active();
    for (const a of [actor("DOCTOR", "alpha", true), actor("DOCTOR", "beta")])
      for (const path of [
        `/visits/${f.visit._id}`,
        `/visits/${f.visit._id}/consultation`,
      ])
        await request(app)
          .get(`/api/v1${path}`)
          .auth(a.token, { type: "bearer" })
          .expect(404);
    for (const role of [
      "OWNER",
      "RECEPTIONIST",
      "PHARMACIST",
      "LAB",
      "PATIENT",
    ] as const)
      await request(app)
        .get(`/api/v1/visits/${f.visit._id}`)
        .auth(actor(role).token, { type: "bearer" })
        .expect(403);
  });
});
describe("atomic claim-next and consultation lifecycle", () => {
  it("settles two doctors racing for one waiting patient with exactly one assignment", async () => {
    const f = await queued();
    const r = await Promise.all(
      [false, true].map((second) =>
        request(app)
          .post("/api/v1/queue/claim-next")
          .auth(actor("DOCTOR", "alpha", second).token, { type: "bearer" })
          .set("Idempotency-Key", key())
          .send({}),
      ),
    );
    expect(r.map((v) => v.status).sort()).toEqual([201, 409]);
    expect(await db.notes("alpha").count({ visitId: f.visit._id })).toBe(1);
    expect(
      (await db.visits("alpha").findOne({ _id: f.visit._id }))!.state,
    ).toBe("IN_CONSULTATION");
  });
  it("claims in FIFO order and prevents one doctor from holding two active visits", async () => {
    const first = await queued(),
      second = await queued();
    const a = await claim();
    expect(a.visit.id).toBe(first.visit._id);
    await request(app)
      .post("/api/v1/queue/claim-next")
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({})
      .expect(409);
    const b = await claim(true);
    expect(b.visit.id).toBe(second.visit._id);
  });
  it("replays a claim without advancing to another patient", async () => {
    const first = await queued();
    await queued();
    const k = key();
    const a = await claim(false, "alpha", k),
      b = await claim(false, "alpha", k);
    expect(a.visit.id).toBe(first.visit._id);
    expect(b.visit.id).toBe(a.visit.id);
  });
  it("does not claim another facility’s queue", async () => {
    await queued("beta");
    await request(app)
      .post("/api/v1/queue/claim-next")
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({})
      .expect(409);
  });
  it("saves notes optimistically, rejects arbitrary fields and requires complaint/assessment for completion", async () => {
    const f = await active();
    expect((await complete(f.visit._id)).status).toBe(400);
    await notes(f.visit._id);
    await request(app)
      .patch(`/api/v1/visits/${f.visit._id}/consultation`)
      .auth(actor().token, { type: "bearer" })
      .send({
        complaint: "Stale note",
        assessment: "Stale",
        expected_version: 0,
      })
      .expect(409);
    await request(app)
      .patch(`/api/v1/visits/${f.visit._id}/consultation`)
      .auth(actor().token, { type: "bearer" })
      .send({
        complaint: "Test",
        assessment: "Test",
        tenant_id: "beta",
        expected_version: 1,
      })
      .expect(400);
  });
});
describe("prescription leases and versioned content", () => {
  it("requires an explicit edit lease and enforces its 120-second expiry", async () => {
    const f = await active(),
      rx = await draft(f.visit._id);
    await request(app)
      .patch(`/api/v1/prescriptions/${rx.id}`)
      .auth(actor().token, { type: "bearer" })
      .send({ expected_version: 0, items: [medicine] })
      .expect(409);
    const l = await leased(rx.id, rx.version);
    expect(new Date(l.lease_expires_at).getTime() - Date.now()).toBeGreaterThan(
      118000,
    );
    await db
      .prescriptions("alpha")
      .update(
        { _id: rx.id },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1) } },
      );
    await request(app)
      .post(`/api/v1/prescriptions/${rx.id}/lease/renew`)
      .auth(actor().token, { type: "bearer" })
      .send({ expected_version: l.version })
      .expect(409);
    await request(app)
      .patch(`/api/v1/prescriptions/${rx.id}`)
      .auth(actor().token, { type: "bearer" })
      .send({ expected_version: l.version, items: [medicine] })
      .expect(409);
    const re = await leased(rx.id, l.version);
    await saved(rx.id, re.version);
  });
  it("binds an edit lease to the authenticated session, not merely the doctor ID", async () => {
    const f = await active(),
      rx = await draft(f.visit._id),
      l = await leased(rx.id, rx.version);
    const user = await db.users("alpha").findOne({ _id: actor().id });
    const another = await identity.session(user!);
    await request(app)
      .post(`/api/v1/prescriptions/${rx.id}/lease`)
      .auth(another.access_token, { type: "bearer" })
      .send({ expected_version: l.version })
      .expect(409);
    await request(app)
      .patch(`/api/v1/prescriptions/${rx.id}`)
      .auth(another.access_token, { type: "bearer" })
      .send({ expected_version: l.version, items: [medicine] })
      .expect(409);
  });
  it("rejects concurrent stale edits and extends inactivity expiry after save", async () => {
    const f = await active(),
      rx = await draft(f.visit._id),
      l = await leased(rx.id, rx.version);
    const responses = await Promise.all(
      [0, 1].map((i) =>
        request(app)
          .patch(`/api/v1/prescriptions/${rx.id}`)
          .auth(actor().token, { type: "bearer" })
          .send({
            expected_version: l.version,
            items: [{ ...medicine, instructions: `edit ${i}` }],
          }),
      ),
    );
    expect(responses.map((v) => v.status).sort()).toEqual([200, 409]);
    const actual = await db.prescriptions("alpha").findOne({ _id: rx.id });
    expect(actual!.leaseExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
      118000,
    );
  });
  it("rejects prescription reads/writes from other doctors, tenants and unapproved roles", async () => {
    const f = await active(),
      rx = await draft(f.visit._id);
    for (const a of [actor("DOCTOR", "alpha", true), actor("DOCTOR", "beta")])
      await request(app)
        .get(`/api/v1/prescriptions/${rx.id}`)
        .auth(a.token, { type: "bearer" })
        .expect(404);
    for (const role of ["OWNER", "RECEPTIONIST", "LAB"] as const)
      await request(app)
        .get(`/api/v1/prescriptions/${rx.id}`)
        .auth(actor(role).token, { type: "bearer" })
        .expect(403);
    for (const role of ["PHARMACIST", "PATIENT"] as const)
      await request(app)
        .get(`/api/v1/prescriptions/${rx.id}`)
        .auth(actor(role).token, { type: "bearer" })
        .expect(404);
  });
  it("does not create a second draft for one encounter", async () => {
    const f = await active();
    await draft(f.visit._id);
    await request(app)
      .post(`/api/v1/visits/${f.visit._id}/prescriptions`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({})
      .expect(409);
  });
});
describe("deliberate signing, revisions and draft discard", () => {
  it("requires the current password and a nonempty leased draft before signing", async () => {
    const f = await active(),
      rx = await draft(f.visit._id),
      l = await leased(rx.id, rx.version);
    await request(app)
      .post(`/api/v1/prescriptions/${rx.id}/sign`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ expected_version: l.version, password: "wrong" })
      .expect(401);
    await request(app)
      .post(`/api/v1/prescriptions/${rx.id}/sign`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ expected_version: l.version, password })
      .expect(400);
  });
  it("signs once, freezes the content and retains the same hash on replay", async () => {
    const f = await active(),
      rx = await draft(f.visit._id),
      l = await leased(rx.id, rx.version),
      save = await saved(rx.id, l.version),
      k = key();
    const first = await signed(rx.id, save.version, k),
      second = await signed(rx.id, save.version, k);
    expect(first.state).toBe("SIGNED");
    expect(first.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.content_hash).toBe(first.content_hash);
    const before = await db.prescriptions("alpha").findOne({ _id: rx.id });
    await request(app)
      .patch(`/api/v1/prescriptions/${rx.id}`)
      .auth(actor().token, { type: "bearer" })
      .send({
        expected_version: first.version,
        items: [{ ...medicine, dose: "different" }],
      })
      .expect(409);
    await request(app)
      .post(`/api/v1/prescriptions/${rx.id}/discard`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({
        expected_version: first.version,
        reason: "Cannot discard a signed record",
      })
      .expect(409);
    const after = await db.prescriptions("alpha").findOne({ _id: rx.id });
    expect(after!.items).toEqual(before!.items);
    expect(after!.signedAt).toEqual(before!.signedAt);
    expect(after!.contentHash).toBe(before!.contentHash);
  });
  it("creates a correction draft without changing the signed source", async () => {
    const f = await fullRx();
    const before = await db.prescriptions("alpha").findOne({ _id: f.rx.id });
    const r = await request(app)
      .post(`/api/v1/prescriptions/${f.rx.id}/revisions`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ reason: "Documented medicine correction" })
      .expect(201);
    expect(r.body.data.revision).toBe(2);
    expect(r.body.data.state).toBe("DRAFT");
    expect(r.body.data.source_id).toBe(f.rx.id);
    const after = await db.prescriptions("alpha").findOne({ _id: f.rx.id });
    expect(after!.items).toEqual(before!.items);
    expect(after!.contentHash).toBe(before!.contentHash);
  });
  it("allows pharmacy and only the linked patient to read a signed projection", async () => {
    const f = await fullRx();
    const own = await identity.session(f.user);
    await request(app)
      .get(`/api/v1/prescriptions/${f.rx.id}`)
      .auth(own.access_token, { type: "bearer" })
      .expect(200);
    await request(app)
      .get(`/api/v1/prescriptions/${f.rx.id}`)
      .auth(actor("PATIENT").token, { type: "bearer" })
      .expect(404);
    const p = await request(app)
      .get(`/api/v1/prescriptions/${f.rx.id}`)
      .auth(actor("PHARMACIST").token, { type: "bearer" })
      .expect(200);
    expect(p.body.data.lease_owned).toBeUndefined();
    expect(p.body.data.password).toBeUndefined();
    await request(app)
      .get(`/api/v1/prescriptions/${f.rx.id}`)
      .auth(actor("PHARMACIST", "beta").token, { type: "bearer" })
      .expect(404);
  });
  it("retains an explicitly discarded unsigned draft and permits no-medication completion", async () => {
    const f = await active();
    await notes(f.visit._id);
    const rx = await draft(f.visit._id),
      l = await leased(rx.id, rx.version);
    const r = await request(app)
      .post(`/api/v1/prescriptions/${rx.id}/discard`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({
        expected_version: l.version,
        reason: "Medication is not indicated",
      })
      .expect(200);
    expect(r.body.data.state).toBe("DISCARDED");
    expect((await complete(f.visit._id)).status).toBe(200);
    expect(
      (await db.prescriptions("alpha").findOne({ _id: rx.id }))!.state,
    ).toBe("DISCARDED");
  });
  it("locks out failed password guesses without blocking successful signing frequency", async () => {
    const f = await active(),
      rx = await draft(f.visit._id),
      l = await leased(rx.id, rx.version);
    for (let i = 0; i < 5; i++)
      await request(app)
        .post(`/api/v1/prescriptions/${rx.id}/sign`)
        .auth(actor().token, { type: "bearer" })
        .set("Idempotency-Key", key())
        .send({ expected_version: l.version, password: "wrong" })
        .expect(401);
    await request(app)
      .post(`/api/v1/prescriptions/${rx.id}/sign`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ expected_version: l.version, password })
      .expect(429);
  });
});
describe("add-on orders and clinical projections", () => {
  it("creates lab/service requests once and does not expose notes to LAB", async () => {
    const f = await active();
    await notes(f.visit._id);
    const k = key(),
      input = {
        visit_id: f.visit._id,
        tests: [
          {
            name: "Manually requested test",
            instructions: "Synthetic clinical instruction",
          },
        ],
      };
    const a = await request(app)
      .post("/api/v1/lab/orders")
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", k)
      .send(input)
      .expect(201);
    const b = await request(app)
      .post("/api/v1/lab/orders")
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", k)
      .send(input)
      .expect(201);
    expect(a.body.data.id).toBe(b.body.data.id);
    await request(app)
      .post(`/api/v1/visits/${f.visit._id}/service-orders`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ name: "Manual add-on service", instructions: "No price implied" })
      .expect(201);
    const lab = await request(app)
      .get("/api/v1/lab/orders")
      .auth(actor("LAB").token, { type: "bearer" })
      .expect(200);
    expect(
      lab.body.data.some((o: { id: string }) => o.id === a.body.data.id),
    ).toBe(true);
    expect(JSON.stringify(lab.body)).not.toContain("Synthetic assessment");
    expect(JSON.stringify(lab.body)).not.toContain("consultation");
  });
  it("denies cross-tenant/other-doctor orders and role escalation", async () => {
    const f = await active(),
      input = { visit_id: f.visit._id, tests: [{ name: "Test" }] };
    for (const a of [actor("DOCTOR", "alpha", true), actor("DOCTOR", "beta")])
      await request(app)
        .post("/api/v1/lab/orders")
        .auth(a.token, { type: "bearer" })
        .set("Idempotency-Key", key())
        .send(input)
        .expect(404);
    for (const role of [
      "OWNER",
      "RECEPTIONIST",
      "PHARMACIST",
      "PATIENT",
      "LAB",
    ] as const)
      await request(app)
        .post("/api/v1/lab/orders")
        .auth(actor(role).token, { type: "bearer" })
        .set("Idempotency-Key", key())
        .send(input)
        .expect(403);
    const beta = await request(app)
      .get("/api/v1/lab/orders")
      .auth(actor("LAB", "beta").token, { type: "bearer" })
      .expect(200);
    expect(beta.body.data).toHaveLength(0);
  });
  it("validates prescribed fields, quantities and order payloads without adding clinical recommendations", async () => {
    const f = await active(),
      rx = await draft(f.visit._id),
      l = await leased(rx.id, rx.version);
    for (const items of [
      [{ ...medicine, route: "" }],
      [{ ...medicine, quantity: -1 }],
      [{ ...medicine, tenant_id: "beta" }],
    ])
      await request(app)
        .patch(`/api/v1/prescriptions/${rx.id}`)
        .auth(actor().token, { type: "bearer" })
        .send({ expected_version: l.version, items })
        .expect(400);
    await request(app)
      .post("/api/v1/lab/orders")
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ visit_id: f.visit._id, tests: [] })
      .expect(400);
  });
});
describe("completion, immutable notes and one metering event", () => {
  it("completes concurrently and emits exactly one usage event and final note", async () => {
    const f = await active();
    await notes(f.visit._id);
    const v = await db.visits("alpha").findOne({ _id: f.visit._id }),
      k = key();
    const r = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post(`/api/v1/visits/${f.visit._id}/complete`)
          .auth(actor().token, { type: "bearer" })
          .set("Idempotency-Key", k)
          .send({ expected_version: v!.version }),
      ),
    );
    expect(r.map((v) => v.status)).toEqual([200, 200]);
    expect(
      await db
        .usage("alpha")
        .count({ meter: "COMPLETED_CONSULTATION", sourceId: f.visit._id }),
    ).toBe(1);
    const event = await db.usage("alpha").findOne({ sourceId: f.visit._id });
    expect(event!.quantity).toBe(1);
    expect(event!.unit).toBe("encounter");
    expect(
      (await db.notes("alpha").findOne({ visitId: f.visit._id }))!.state,
    ).toBe("FINAL");
    expect(
      (await db.visits("alpha").findOne({ _id: f.visit._id }))!.state,
    ).toBe("COMPLETED");
  });
  it("rejects stale completion and unsigned drafts without producing any meter or finalizing notes", async () => {
    const f = await active();
    await notes(f.visit._id);
    await request(app)
      .post(`/api/v1/visits/${f.visit._id}/complete`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ expected_version: 0 })
      .expect(409);
    await draft(f.visit._id);
    expect((await complete(f.visit._id)).status).toBe(409);
    expect(await db.usage("alpha").count({ sourceId: f.visit._id })).toBe(0);
    expect(
      (await db.notes("alpha").findOne({ visitId: f.visit._id }))!.state,
    ).toBe("DRAFT");
  });
  it("prevents duplicate completion under different keys and further clinical mutations", async () => {
    const f = await active();
    await notes(f.visit._id);
    expect((await complete(f.visit._id)).status).toBe(200);
    expect((await complete(f.visit._id)).status).toBe(409);
    await request(app)
      .patch(`/api/v1/visits/${f.visit._id}/consultation`)
      .auth(actor().token, { type: "bearer" })
      .send({
        complaint: "Overwrite",
        assessment: "Overwrite",
        expected_version: 2,
      })
      .expect(409);
    await request(app)
      .post("/api/v1/lab/orders")
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ visit_id: f.visit._id, tests: [{ name: "Late test" }] })
      .expect(409);
  });
  it("appends a reauthenticated correction without changing the base note or counting the encounter again", async () => {
    const f = await active();
    await notes(f.visit._id);
    expect((await complete(f.visit._id)).status).toBe(200);
    const before = await db.notes("alpha").findOne({ visitId: f.visit._id });
    const input = {
      complaint: "Corrected complaint",
      assessment: "Corrected assessment",
      plan: "Corrected plan",
      reason: "Documented note correction",
      password,
    };
    const k = key();
    for (let i = 0; i < 2; i++)
      await request(app)
        .post(`/api/v1/visits/${f.visit._id}/amendments`)
        .auth(actor().token, { type: "bearer" })
        .set("Idempotency-Key", k)
        .send(input)
        .expect(201);
    expect(await db.amendments("alpha").count({ visitId: f.visit._id })).toBe(
      1,
    );
    const after = await db.notes("alpha").findOne({ visitId: f.visit._id });
    expect(after!.complaint).toBe(before!.complaint);
    expect(after!.assessment).toBe(before!.assessment);
    expect(await db.usage("alpha").count({ sourceId: f.visit._id })).toBe(1);
  });
  it("never stores clinical bodies or password proofs in audit/retry records", async () => {
    const f = await fullRx();
    await notes(f.visit._id);
    const entries = await db.operations("alpha").find();
    const audits = await db.audits("alpha").find();
    const text = JSON.stringify({ entries, audits });
    expect(text).not.toContain(password);
    expect(text).not.toContain("Manual test medicine");
    expect(text).not.toContain("Synthetic assessment");
    expect(text).not.toContain(hash);
  });
});

describe("doctor concurrency and retry regressions", () => {
  it("allows only one active visit for concurrent distinct claims by the same doctor", async () => {
    await queued();
    await queued();
    const results = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post("/api/v1/queue/claim-next")
          .auth(actor().token, { type: "bearer" })
          .set("Idempotency-Key", key())
          .send({}),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db
        .visits("alpha")
        .count({ doctorId: actor().id, state: "IN_CONSULTATION" }),
    ).toBe(1);
  });
  it("rejects a changed completion payload even with the original retry key", async () => {
    const f = await active();
    await notes(f.visit._id);
    const before = await db.visits("alpha").findOne({ _id: f.visit._id }),
      k = key();
    await request(app)
      .post(`/api/v1/visits/${f.visit._id}/complete`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", k)
      .send({ expected_version: before!.version })
      .expect(200);
    await request(app)
      .post(`/api/v1/visits/${f.visit._id}/complete`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", k)
      .send({ expected_version: before!.version + 1 })
      .expect(409);
    expect(await db.usage("alpha").count({ sourceId: f.visit._id })).toBe(1);
  });
  it("can discard a correction draft and create another from the unchanged signed source", async () => {
    const f = await fullRx();
    const revised = await request(app)
      .post(`/api/v1/prescriptions/${f.rx.id}/revisions`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ reason: "Correction draft" })
      .expect(201);
    const l = await leased(revised.body.data.id, 0);
    await request(app)
      .post(`/api/v1/prescriptions/${l.id}/discard`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({
        expected_version: l.version,
        reason: "Correction no longer required",
      })
      .expect(200);
    const next = await request(app)
      .post(`/api/v1/prescriptions/${f.rx.id}/revisions`)
      .auth(actor().token, { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ reason: "New correction draft" })
      .expect(201);
    expect(next.body.data.revision).toBe(3);
    expect(
      (await db.prescriptions("alpha").findOne({ _id: f.rx.id }))!.contentHash,
    ).toBe(f.sign.content_hash);
  });
});

describe("clinical text and scope protection", () => {
  it("accepts literal tenant_id in clinical text while forbidding tenant mutations and rename targets", async () => {
    const f = await active();
    const r = await request(app)
      .patch(`/api/v1/visits/${f.visit._id}/consultation`)
      .auth(actor().token, { type: "bearer" })
      .send({
        complaint: "Literal technical phrase tenant_id in a patient report",
        assessment: "Manually entered assessment",
        expected_version: 0,
      })
      .expect(200);
    expect(r.body.data.complaint).toContain("tenant_id");
    expect(() =>
      db
        .users("alpha")
        .update({ _id: actor().id }, { $rename: { name: "tenant_id" } }),
    ).toThrow("SCOPE_IMMUTABLE");
    expect(() =>
      db
        .users("alpha")
        .update({ _id: actor().id }, { $set: { tenant_id: "beta" } }),
    ).toThrow("SCOPE_IMMUTABLE");
  });
});
