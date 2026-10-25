import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID, randomBytes, generateKeyPairSync } from "node:crypto";
import request from "supertest";
import { connect, type Database } from "../src/db.js";
import { Identity, passwordHash } from "../src/auth.js";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { roles, type Role } from "../src/types.js";
import { seal, newSecret, digest } from "../src/crypto.js";
let db: Database,
  identity: Identity,
  app: Awaited<ReturnType<typeof createApp>>,
  hash: string;
const accounts = new Map<string, { id: string; token: string }>();
const password = "phase four doctor password",
  key = () => randomUUID();
const actor = (role: Role = "RECEPTIONIST", tenant = "alpha", second = false) =>
  accounts.get(`${tenant}:${role}${second ? ":2" : ""}`)!;
function get(
  path: string,
  role: Role = "RECEPTIONIST",
  tenant = "alpha",
  second = false,
) {
  return request(app)
    .get(`/api/v1${path}`)
    .auth(actor(role, tenant, second).token, { type: "bearer" });
}
function post(
  path: string,
  body: unknown,
  role: Role = "RECEPTIONIST",
  k = key(),
  tenant = "alpha",
  second = false,
) {
  return request(app)
    .post(`/api/v1${path}`)
    .auth(actor(role, tenant, second).token, { type: "bearer" })
    .set("Idempotency-Key", k)
    .send(body);
}
async function patient() {
  const u = await db.users("alpha").create({
    name: "Synthetic Patient",
    login: `${key()}@test.test`,
    role: "PATIENT",
    contactVerified: true,
  });
  const p = await db.patients("alpha").create({
    name: "Synthetic Patient",
    searchName: "synthetic patient",
    contactType: "EMAIL",
    contactValue: u.login,
    userId: u._id,
  });
  return { id: p._id, token: (await identity.session(u)).access_token };
}
const line = {
  description: "Synthetic service",
  quantity: 1,
  unit_price: "100.00",
  tax_percent: "18.00",
};
async function invoice(issue = true) {
  const p = await patient();
  const c = await post("/invoices", { patient_id: p.id, lines: [line] }).expect(
    201,
  );
  let i = c.body.data;
  if (issue)
    i = (
      await post(`/invoices/${i.id}/issue`, {
        expected_version: i.version,
      }).expect(201)
    ).body.data;
  return { i, p };
}
async function ownerProof() {
  const code = key();
  await db
    .users("alpha")
    .update(
      { _id: actor("OWNER").id },
      { $push: { recoveryHashes: digest(code) } },
    );
  return code;
}
const medicine = {
  medicine: "Synthetic medicine",
  strength: "10 mg",
  dose: "One tablet",
  route: "Oral",
  frequency: "Manual frequency",
  duration: "Manual duration",
  quantity: 3,
  instructions: "Synthetic only",
};
async function prescription(
  items: (Omit<typeof medicine, "quantity"> & { quantity?: number })[] = [
    medicine,
  ],
) {
  const p = await patient();
  const v = await db.visits("alpha").create({
    patientId: p.id,
    doctorId: actor("DOCTOR").id,
    state: "COMPLETED",
    queueNumber: Date.now() + Math.floor(Math.random() * 1000),
    queuedAt: new Date(),
    checkInKey: key(),
    requestHash: "fixture",
  });
  const rx = await db.prescriptions("alpha").create({
    visitId: v._id,
    patientId: p.id,
    authorId: actor("DOCTOR").id,
    revision: 1,
    state: "SIGNED",
    items,
    operationKey: key(),
    signedAt: new Date(),
    signedBy: actor("DOCTOR").id,
    contentHash: "fixture",
  });
  return { rx, p, v };
}
async function batch(extra: Record<string, unknown> = {}) {
  return (
    await post(
      "/pharmacy/batches",
      {
        medicine: medicine.medicine,
        strength: medicine.strength,
        route: medicine.route,
        unit: "tablet",
        batch_number: key(),
        expiry_date: "2090-01-01",
        quantity: 10,
        ...extra,
      },
      "PHARMACIST",
    ).expect(201)
  ).body.data;
}
async function labOrder() {
  const { rx, p } = await prescription();
  const o = await db.labOrders("alpha").create({
    visitId: rx.visitId,
    patientId: p.id,
    doctorId: actor("DOCTOR").id,
    tests: [{ name: "Synthetic test", instructions: "Synthetic instruction" }],
    state: "ORDERED",
    operationKey: key(),
  });
  return { o, p };
}
const resultBody = {
  observations: [
    {
      name: "Synthetic analyte",
      value: "12",
      unit: "u",
      reference_interval: "manual",
      comments: "synthetic only",
    },
  ],
  comments: "Synthetic result",
  correction_reason: "",
};
async function labDraft() {
  const f = await labOrder();
  await post(
    `/lab/orders/${f.o._id}/collect`,
    { state: "COLLECTED", expected_version: 0 },
    "LAB",
  ).expect(201);
  const r = (
    await post(`/lab/orders/${f.o._id}/results`, resultBody, "LAB").expect(201)
  ).body.data;
  return { ...f, r };
}
async function labSigned() {
  const f = await labDraft();
  const r = (
    await post(
      `/lab/results/${f.r.id}/sign`,
      { expected_version: 0, signoff_pin: "827391" },
      "LAB",
    ).expect(201)
  ).body.data;
  return { ...f, r };
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
  uri.pathname = `/auracare_test_phase4_${randomUUID().replaceAll("-", "")}`;
  const cfg: Config = {
    mongoUri: uri.toString(),
    origin: "http://localhost:5173",
    port: 3000,
    production: false,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    encryptionKey: randomBytes(32),
    pinPepper: randomBytes(32),
    issuer: "phase4",
    audience: "tenant",
    mailDir: ".local/test-mail",
    mailFrom: "phase4@test.test",
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
    await db.connection.dropDatabase();
    await db.connection.close();
  }
});
describe("Phase 4 role and tenant boundaries", () => {
  for (const role of roles)
    it(`${role} has scoped operational reads`, async () => {
      await get("/invoices", role).expect(
        ["OWNER", "RECEPTIONIST", "PATIENT"].includes(role) ? 200 : 403,
      );
      await get("/pharmacy/batches", role).expect(
        ["OWNER", "PHARMACIST"].includes(role) ? 200 : 403,
      );
      await get("/pharmacy/prescriptions", role).expect(
        role === "PHARMACIST" ? 200 : 403,
      );
      await get("/lab/orders", role).expect(
        ["DOCTOR", "LAB"].includes(role) ? 200 : 403,
      );
    });
  it("rejects tenant injection, unknown fields and unauthenticated reads", async () => {
    await request(app).get("/api/v1/invoices").expect(401);
    await get("/invoices?tenant_id=beta").expect(400);
    await post("/invoices", {
      patient_id: key(),
      lines: [line],
      tenant_id: "beta",
    }).expect(400);
  });
  it("hides another tenant's invoice, batches and results", async () => {
    const { i } = await invoice();
    await get(`/invoices/${i.id}`, "OWNER", "beta").expect(404);
    const b = await batch();
    await post(
      `/pharmacy/batches/${b.id}/adjustments`,
      { delta: 1, reason: "Synthetic count", expected_version: 0 },
      "PHARMACIST",
      key(),
      "beta",
    ).expect(404);
    const { r } = await labDraft();
    await get(`/lab/results/${r.id}`, "LAB", "beta").expect(404);
  });
});
describe("invoice ledger and reconciliation", () => {
  it("issues sequential immutable invoices with explicit half-up tax", async () => {
    const p = await patient(),
      k = key(),
      body = {
        patient_id: p.id,
        lines: [{ ...line, unit_price: "0.01", tax_percent: "50.00" }],
      };
    const draft = (await post("/invoices", body, "RECEPTIONIST", k).expect(201))
      .body.data;
    expect(
      (await post("/invoices", body, "RECEPTIONIST", k).expect(201)).body.data
        .id,
    ).toBe(draft.id);
    await post(
      "/invoices",
      { ...body, lines: [line] },
      "RECEPTIONIST",
      k,
    ).expect(409);
    const a = (
      await post(`/invoices/${draft.id}/issue`, { expected_version: 0 }).expect(
        201,
      )
    ).body.data;
    expect(a.total_minor).toBe(2);
    expect(a.lines[0].tax_minor).toBe(1);
    const b = (await invoice()).i;
    expect(Number(b.number.slice(4))).toBe(Number(a.number.slice(4)) + 1);
    await request(app)
      .patch(`/api/v1/invoices/${a.id}`)
      .auth(actor().token, { type: "bearer" })
      .send({ expected_version: a.version, lines: [line] })
      .expect(409);
  });
  it("scopes patient receipts to their own issued invoices", async () => {
    const { i, p } = await invoice(false);
    const own = (path: string) =>
      request(app).get(`/api/v1${path}`).auth(p.token, { type: "bearer" });
    await own(`/invoices/${i.id}`).expect(404);
    await post(`/invoices/${i.id}/issue`, { expected_version: 0 }).expect(201);
    await own(`/invoices/${i.id}`).expect(200);
    await get(`/invoices/${i.id}`, "PATIENT").expect(404);
  });
  it("prevents overpayments under concurrency and replays exactly once", async () => {
    const { i } = await invoice(),
      k = key(),
      body = { amount: "118.00", method: "UPI", external_reference: key() };
    const results = await Promise.all([
      post(`/invoices/${i.id}/payments`, body, "RECEPTIONIST", k),
      post(`/invoices/${i.id}/payments`, body, "RECEPTIONIST", k),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
    expect((await get(`/invoices/${i.id}`).expect(200)).body.data.state).toBe(
      "PAID",
    );
    await post(`/invoices/${i.id}/payments`, {
      ...body,
      amount: "0.01",
      external_reference: key(),
    }).expect(409);
    expect(await db.payments("alpha").count({ invoiceId: i.id })).toBe(1);
  });
  it("allows only one of two competing balance receipts", async () => {
    const { i } = await invoice();
    const results = await Promise.all(
      [1, 2].map(() =>
        post(`/invoices/${i.id}/payments`, {
          amount: "100.00",
          method: "CARD",
          external_reference: key(),
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await get(`/invoices/${i.id}`)).body.data.paid_minor).toBe(10000);
  });
  it("rejects reused external references across invoices", async () => {
    const a = await invoice(),
      b = await invoice(),
      body = { amount: "1.00", method: "UPI", external_reference: key() };
    await post(`/invoices/${a.i.id}/payments`, body).expect(201);
    await post(`/invoices/${b.i.id}/payments`, body).expect(409);
    expect((await get(`/invoices/${b.i.id}`)).body.data.paid_minor).toBe(0);
  });
  it("voids unpaid invoices only with fresh owner MFA", async () => {
    const { i } = await invoice();
    await post(
      `/invoices/${i.id}/void`,
      {
        expected_version: i.version,
        reason: "Synthetic cancellation",
        mfa_proof: "invalid",
      },
      "OWNER",
    ).expect(401);
    await post(
      `/invoices/${i.id}/void`,
      {
        expected_version: i.version,
        reason: "Synthetic cancellation",
        mfa_proof: await ownerProof(),
      },
      "OWNER",
    ).expect(201);
    await post(`/invoices/${i.id}/payments`, {
      amount: "1.00",
      method: "UPI",
      external_reference: key(),
    }).expect(409);
    const paid = (await invoice()).i;
    await post(`/invoices/${paid.id}/payments`, {
      amount: "1.00",
      method: "UPI",
      external_reference: key(),
    }).expect(201);
    await post(
      `/invoices/${paid.id}/void`,
      {
        expected_version: paid.version + 1,
        reason: "Synthetic cancellation",
        mfa_proof: await ownerProof(),
      },
      "OWNER",
    ).expect(409);
  });
  it("requires own open cash shift and closes/reviews its exact ledger", async () => {
    const { i } = await invoice();
    await post(`/invoices/${i.id}/payments`, {
      amount: "18.00",
      method: "CASH",
    }).expect(409);
    const cash = (
      await post("/cash/sessions", {
        opening_float: "50.00",
        currency: "INR",
      }).expect(201)
    ).body.data;
    await post(`/invoices/${i.id}/payments`, {
      amount: "18.00",
      method: "CASH",
    }).expect(201);
    const c = (await get(`/cash/sessions/${cash.id}`).expect(200)).body.data;
    expect(c.expected_cash_minor).toBe(6800);
    await post(`/cash/sessions/${c.id}/close`, {
      expected_version: c.version,
      counted_cash: "67.00",
    }).expect(400);
    const closed = (
      await post(`/cash/sessions/${c.id}/close`, {
        expected_version: c.version,
        counted_cash: "67.00",
        variance_reason: "Synthetic count difference",
      }).expect(201)
    ).body.data;
    expect(closed.variance_minor).toBe(-100);
    await post(
      `/cash/sessions/${c.id}/review`,
      {
        expected_version: closed.version,
        review_note: "Synthetic review",
        mfa_proof: await ownerProof(),
      },
      "OWNER",
    ).expect(201);
    expect(await db.cashMovements("alpha").count({ cashSessionId: c.id })).toBe(
      1,
    );
    await post(`/invoices/${i.id}/payments`, {
      amount: "1.00",
      method: "CASH",
    }).expect(409);
  });
  it("serializes cash receipts against closing and supports older float records", async () => {
    const { i } = await invoice();
    const c = (
      await post("/cash/sessions", {
        opening_float: "0.00",
        currency: "INR",
      }).expect(201)
    ).body.data;
    await db
      .cashSessions("alpha")
      .update({ _id: c.id }, { $unset: { version: 1, cashReceiptsMinor: 1 } });
    const results = await Promise.all([
      post(`/invoices/${i.id}/payments`, { amount: "1.00", method: "CASH" }),
      post(`/cash/sessions/${c.id}/close`, {
        expected_version: 0,
        counted_cash: "0.00",
      }),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const now = (await get(`/cash/sessions/${c.id}`)).body.data;
    if (now.state === "OPEN")
      await post(`/cash/sessions/${c.id}/close`, {
        expected_version: now.version,
        counted_cash: "1.00",
      }).expect(201);
  });
});
describe("pharmacy stock and clinical authorization", () => {
  it("uses FEFO and excludes expired batches, with durable dispense replay", async () => {
    const f = await prescription(),
      name = `Synthetic ${key()}`;
    await db
      .prescriptions("alpha")
      .update(
        { _id: f.rx._id },
        { $set: { items: [{ ...medicine, medicine: name }] } },
      );
    const expired = await batch({
        medicine: name,
        expiry_date: "2000-01-01",
        quantity: 9,
      }),
      early = await batch({
        medicine: name,
        expiry_date: "2080-01-01",
        quantity: 2,
      }),
      late = await batch({ medicine: name, quantity: 9 });
    const k = key(),
      body = { line_units: [{ line_index: 0, unit: "tablet" }] };
    const a = (
      await post(
        `/prescriptions/${f.rx._id}/dispense`,
        body,
        "PHARMACIST",
        k,
      ).expect(201)
    ).body.data;
    expect(
      a.allocations.map((x: { batchId: string; quantity: number }) => [
        x.batchId,
        x.quantity,
      ]),
    ).toEqual([
      [early.id, 2],
      [late.id, 1],
    ]);
    expect(
      (
        await post(
          `/prescriptions/${f.rx._id}/dispense`,
          body,
          "PHARMACIST",
          k,
        ).expect(201)
      ).body.data.id,
    ).toBe(a.id);
    await post(
      `/prescriptions/${f.rx._id}/dispense`,
      body,
      "PHARMACIST",
    ).expect(409);
    expect(
      (await db.batches("alpha").findOne({ _id: expired.id }))!.quantity,
    ).toBe(9);
    // Keep the encounter otherwise eligible, so this proves the dispense guard itself.
    await db
      .visits("alpha")
      .update({ _id: f.v._id }, { $set: { state: "IN_CONSULTATION" } });
    const correction = await post(
      `/prescriptions/${f.rx._id}/revisions`,
      { reason: "Synthetic correction" },
      "DOCTOR",
    ).expect(409);
    expect(correction.body.error.code).toBe("ALREADY_DISPENSED");
    await db
      .visits("alpha")
      .update({ _id: f.v._id }, { $set: { state: "COMPLETED" } });
  });
  it("rolls back deductions when any line lacks stock", async () => {
    const name = `Synthetic ${key()}`,
      missing = `Missing ${key()}`,
      f = await prescription([
        { ...medicine, medicine: name },
        { ...medicine, medicine: missing },
      ]);
    const b = await batch({ medicine: name });
    await post(
      `/prescriptions/${f.rx._id}/dispense`,
      {
        line_units: [
          { line_index: 0, unit: "tablet" },
          { line_index: 1, unit: "tablet" },
        ],
      },
      "PHARMACIST",
    ).expect(409);
    expect((await db.batches("alpha").findOne({ _id: b.id }))!.quantity).toBe(
      10,
    );
    expect(await db.dispenses("alpha").count({ visitId: f.v._id })).toBe(0);
  });
  it("rejects missing quantities, wrong units and superseded prescriptions", async () => {
    const f = await prescription([{ ...medicine, quantity: undefined }]);
    await post(
      `/prescriptions/${f.rx._id}/dispense`,
      { line_units: [{ line_index: 0, unit: "tablet" }] },
      "PHARMACIST",
    ).expect(400);
    const g = await prescription();
    await post(
      `/prescriptions/${g.rx._id}/dispense`,
      { line_units: [{ line_index: 0, unit: "ml" }] },
      "PHARMACIST",
    ).expect(409);
    await db.prescriptions("alpha").create({
      ...g.rx,
      _id: key(),
      revision: 2,
      state: "DRAFT",
      operationKey: key(),
    });
    await post(
      `/prescriptions/${g.rx._id}/dispense`,
      { line_units: [{ line_index: 0, unit: "tablet" }] },
      "PHARMACIST",
    ).expect(409);
  });
  it("prevents negative stock under simultaneous dispensing", async () => {
    const name = `Concurrent ${key()}`,
      a = await prescription([{ ...medicine, medicine: name }]),
      b = await prescription([{ ...medicine, medicine: name }]),
      stock = await batch({ medicine: name, quantity: 3 });
    const results = await Promise.all(
      [a, b].map((f) =>
        post(
          `/prescriptions/${f.rx._id}/dispense`,
          { line_units: [{ line_index: 0, unit: "tablet" }] },
          "PHARMACIST",
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await db.batches("alpha").findOne({ _id: stock.id }))!.quantity,
    ).toBe(0);
  });
  it("requires prescribing doctor approval of the exact generic alternative", async () => {
    const f = await prescription(),
      name = `Alternative ${key()}`;
    await batch({ medicine: name });
    const swap = (
      await post(
        `/prescriptions/${f.rx._id}/substitutions`,
        {
          line_index: 0,
          medicine: name,
          strength: medicine.strength,
          route: medicine.route,
          unit: "tablet",
          reason: "Synthetic generic request",
        },
        "PHARMACIST",
      ).expect(201)
    ).body.data;
    const body = {
      line_units: [{ line_index: 0, unit: "tablet", substitution_id: swap.id }],
    };
    await post(
      `/prescriptions/${f.rx._id}/dispense`,
      body,
      "PHARMACIST",
    ).expect(409);
    await post(
      `/pharmacy/substitutions/${swap.id}/approve`,
      { password },
      "DOCTOR",
      key(),
      "alpha",
      true,
    ).expect(404);
    await post(
      `/pharmacy/substitutions/${swap.id}/approve`,
      { password: "wrong" },
      "DOCTOR",
    ).expect(401);
    const view = (
      await get("/pharmacy/substitutions", "DOCTOR")
    ).body.data.find((s: { id: string }) => s.id === swap.id);
    expect(view.original.medicine).toBe(medicine.medicine);
    await post(
      `/pharmacy/substitutions/${swap.id}/approve`,
      { password },
      "DOCTOR",
    ).expect(201);
    await post(
      `/prescriptions/${f.rx._id}/dispense`,
      body,
      "PHARMACIST",
    ).expect(201);
  });
  it("rejects unverified licence and stale or negative stock adjustment", async () => {
    const b = await batch();
    await post(
      `/pharmacy/batches/${b.id}/adjustments`,
      { delta: -11, reason: "Synthetic count", expected_version: 0 },
      "PHARMACIST",
    ).expect(409);
    await post(
      `/pharmacy/batches/${b.id}/adjustments`,
      { delta: -1, reason: "Synthetic count", expected_version: 0 },
      "PHARMACIST",
    ).expect(201);
    await post(
      `/pharmacy/batches/${b.id}/adjustments`,
      { delta: 1, reason: "Synthetic count", expected_version: 0 },
      "PHARMACIST",
    ).expect(409);
    await db
      .users("alpha")
      .update(
        { _id: actor("PHARMACIST").id },
        { $set: { licenceStatus: "PENDING" } },
      );
    await post(
      "/pharmacy/batches",
      {
        medicine: "Test",
        strength: "x",
        route: "y",
        unit: "z",
        batch_number: key(),
        expiry_date: "2090-01-01",
        quantity: 1,
      },
      "PHARMACIST",
    ).expect(403);
    await db
      .users("alpha")
      .update(
        { _id: actor("PHARMACIST").id },
        { $set: { licenceStatus: "VERIFIED" } },
      );
  });
});
describe("lab sign-off, verification, release and corrections", () => {
  it("requires collection and correct separate PIN before immutable signing", async () => {
    const { o } = await labOrder();
    await post(`/lab/orders/${o._id}/results`, resultBody, "LAB").expect(409);
    const { r } = await labDraft();
    await post(
      `/lab/results/${r.id}/sign`,
      { expected_version: 0, signoff_pin: "111111" },
      "LAB",
    ).expect(401);
    await post(
      `/lab/results/${r.id}/sign`,
      { expected_version: 0, signoff_pin: "827391" },
      "LAB",
    ).expect(201);
    await request(app)
      .patch(`/api/v1/lab/results/${r.id}`)
      .auth(actor("LAB").token, { type: "bearer" })
      .send({
        ...resultBody,
        correction_reason: undefined,
        expected_version: 1,
      })
      .expect(409);
  });
  it("only the requesting doctor verifies; LAB explicitly releases to the linked patient", async () => {
    const { r, p } = await labSigned();
    const own = () =>
      request(app)
        .get(`/api/v1/lab/results/${r.id}`)
        .auth(p.token, { type: "bearer" });
    await own().expect(404);
    await post(
      `/lab/results/${r.id}/release`,
      { expected_version: 1 },
      "LAB",
    ).expect(409);
    await post(
      `/lab/results/${r.id}/verify`,
      { expected_version: 1, password },
      "DOCTOR",
      key(),
      "alpha",
      true,
    ).expect(404);
    await get(`/lab/results/${r.id}`, "DOCTOR", "alpha", true).expect(404);
    await post(
      `/lab/results/${r.id}/verify`,
      { expected_version: 1, password },
      "DOCTOR",
    ).expect(201);
    await own().expect(404);
    await post(
      `/lab/results/${r.id}/release`,
      { expected_version: 2 },
      "LAB",
    ).expect(201);
    await own().expect(200);
    await get(`/lab/results/${r.id}`, "PATIENT").expect(404);
  });
  it("re-verifies corrections and withholds old patient release while correction is pending", async () => {
    const { r, p, o } = await labSigned();
    await post(
      `/lab/results/${r.id}/verify`,
      { expected_version: 1, password },
      "DOCTOR",
    ).expect(201);
    await post(
      `/lab/results/${r.id}/release`,
      { expected_version: 2 },
      "LAB",
    ).expect(201);
    await post(`/lab/orders/${o._id}/results`, resultBody, "LAB").expect(400);
    const next = (
      await post(
        `/lab/orders/${o._id}/results`,
        { ...resultBody, correction_reason: "Synthetic correction" },
        "LAB",
      ).expect(201)
    ).body.data;
    await request(app)
      .get(`/api/v1/lab/results/${r.id}`)
      .auth(p.token, { type: "bearer" })
      .expect(404);
    await post(
      `/lab/results/${next.id}/release`,
      { expected_version: 0 },
      "LAB",
    ).expect(409);
    await post(
      `/lab/results/${next.id}/sign`,
      { expected_version: 0, signoff_pin: "827391" },
      "LAB",
    ).expect(201);
    await post(
      `/lab/results/${next.id}/verify`,
      { expected_version: 1, password },
      "DOCTOR",
    ).expect(201);
    await post(
      `/lab/results/${next.id}/release`,
      { expected_version: 2 },
      "LAB",
    ).expect(201);
    const history = (
      await get(`/lab/orders/${o._id}/results`, "LAB").expect(200)
    ).body.data;
    expect(history).toHaveLength(2);
    expect(history[1].state).toBe("RELEASED");
  });
  it("rejects stale draft edits and keeps clinical/credential payloads out of audit/retries", async () => {
    const { r } = await labDraft();
    const patch = () =>
      request(app)
        .patch(`/api/v1/lab/results/${r.id}`)
        .auth(actor("LAB").token, { type: "bearer" })
        .send({
          observations: resultBody.observations,
          comments: "Edited synthetic",
          expected_version: 0,
        });
    await patch().expect(200);
    await patch().expect(409);
    const encoded = JSON.stringify({
      audit: await db.audits("alpha").find(),
      retry: await db.operations("alpha").find(),
    });
    expect(encoded).not.toMatch(
      /827391|Synthetic result|Synthetic analyte|phase four doctor password/,
    );
  });
});
describe("mutation role matrix", () => {
  for (const role of roles)
    it(`${role} cannot bypass mutation roles`, async () => {
      if (role !== "RECEPTIONIST")
        await post(
          `/invoices/${key()}/payments`,
          { amount: "1.00", method: "CASH" },
          role,
        ).expect(403);
      if (role !== "OWNER")
        await post(
          `/cash/sessions/${key()}/review`,
          {
            expected_version: 0,
            review_note: "Synthetic review",
            mfa_proof: "proof",
          },
          role,
        ).expect(403);
      if (role !== "PHARMACIST")
        await post(
          "/pharmacy/batches",
          {
            medicine: "Synthetic",
            strength: "10 mg",
            route: "Oral",
            unit: "tablet",
            batch_number: key(),
            expiry_date: "2090-01-01",
            quantity: 1,
          },
          role,
        ).expect(403);
      if (role !== "LAB")
        await post(
          `/lab/results/${key()}/sign`,
          { expected_version: 0, signoff_pin: "827391" },
          role,
        ).expect(403);
      if (role !== "DOCTOR")
        await post(
          `/lab/results/${key()}/verify`,
          { expected_version: 0, password },
          role,
        ).expect(403);
    });
});
describe("sensitive proof limits and result races", () => {
  it("limits failed diagnostic PIN proofs without persisting the PIN", async () => {
    const { r } = await labDraft();
    const u = await db.users("alpha").create({
      name: "Synthetic rate test technician",
      login: `${key()}@test.test`,
      role: "LAB",
      passwordHash: hash,
      signoffPinHash: await identity.hashPin("827391"),
      contactVerified: true,
    });
    const token = (await identity.session(u)).access_token;
    const sign = (pin: string) =>
      request(app)
        .post(`/api/v1/lab/results/${r.id}/sign`)
        .auth(token, { type: "bearer" })
        .set("Idempotency-Key", key())
        .send({ expected_version: 0, signoff_pin: pin });
    for (let i = 0; i < 5; i++) await sign("111111").expect(401);
    await sign("827391").expect(429);
    expect((await db.labResults("alpha").findOne({ _id: r.id }))!.state).toBe(
      "RESULT_DRAFT",
    );
  });
  it("allows only one current result draft under competing requests", async () => {
    const { o } = await labOrder();
    await post(
      `/lab/orders/${o._id}/collect`,
      { state: "COLLECTED", expected_version: 0 },
      "LAB",
    ).expect(201);
    const results = await Promise.all(
      [1, 2].map(() => post(`/lab/orders/${o._id}/results`, resultBody, "LAB")),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.labResults("alpha").count({ orderId: o._id })).toBe(1);
  });
});
