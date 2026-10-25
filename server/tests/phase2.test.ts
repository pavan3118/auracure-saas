import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomBytes, randomUUID, generateKeyPairSync } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { connect, type Database } from "../src/db.js";
import { Identity, passwordHash } from "../src/auth.js";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { roles, type Role, type Principal } from "../src/types.js";
import { QueueEvents } from "../src/modules/reception/events.js";
import { liveQueue } from "../src/modules/reception/live.js";
import { Operations } from "../src/modules/reception/operations.js";
let db: Database,
  identity: Identity,
  app: Awaited<ReturnType<typeof createApp>>,
  config: Config,
  http: HttpServer,
  sockets: ReturnType<typeof liveQueue>,
  url: string;
const auth = new Map<string, { token: string; p: Principal }>(),
  events = new QueueEvents();
const password = "phase two secure test password";
const bearer = (role: Role, tenant = "alpha") =>
  auth.get(`${tenant}:${role}`)!.token;
const body = (
  name = "Test Patient",
  contact = `${randomUUID()}@patient.test`,
) => ({
  name,
  contact: { type: "EMAIL", value: contact },
  date_of_birth: "1990-05-20",
});
const key = () => randomUUID();
async function register(name = "Test Patient", tenant = "alpha") {
  const r = await request(app)
    .post("/api/v1/patients")
    .auth(bearer("RECEPTIONIST", tenant), { type: "bearer" })
    .set("Idempotency-Key", key())
    .send(body(name))
    .expect(201);
  return r.body.data as {
    id: string;
    name: string;
    version: number;
    contact: { type: string; value: string };
  };
}
async function checkIn(patientId: string, tenant = "alpha") {
  const r = await request(app)
    .post("/api/v1/visits")
    .auth(bearer("RECEPTIONIST", tenant), { type: "bearer" })
    .set("Idempotency-Key", key())
    .send({ patient_id: patientId })
    .expect(201);
  return r.body.data as { id: string; queue_number: number; version: number };
}
const vitals = {
  observations: [
    { code: "TEMPERATURE", value: 37.1, unit: "°C" },
    { code: "SPO2", value: 98, unit: "%" },
  ],
};
beforeAll(async () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const uri = new URL(
    process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017/?replicaSet=rs0",
  );
  uri.pathname = `/auracare_test_phase2_${randomUUID().replaceAll("-", "")}`;
  config = {
    mongoUri: uri.toString(),
    origin: "http://localhost:5173",
    port: 3000,
    production: false,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    encryptionKey: randomBytes(32),
    pinPepper: randomBytes(32),
    issuer: "phase2",
    audience: "tenant",
    mailDir: ".local/test-mail",
    mailFrom: "test@phase2.test",
  };
  db = await connect(config.mongoUri);
  identity = await Identity.create(db, config, { send: async () => {} });
  app = await createApp(identity, events.publish);
  const hash = await passwordHash(password);
  for (const tenant of ["alpha", "beta"]) {
    await db.tenants(tenant).create({
      _id: tenant,
      name: tenant,
      type: "CLINIC",
      subdomain: tenant,
      capacity: 10,
      status: "ACTIVE",
      ownerId: "owner",
    });
    for (const role of roles) {
      const u = await db.users(tenant).create({
        _id: randomUUID(),
        name: `${role} test`,
        login: `${role.toLowerCase()}@${tenant}.test`,
        role,
        passwordHash: hash,
        mfaEnabled: role === "OWNER",
        contactVerified: true,
      });
      const session = await identity.session(u);
      auth.set(`${tenant}:${role}`, {
        token: session.access_token,
        p: {
          userId: u._id,
          tenantId: tenant,
          role,
          purpose: "access",
          version: u.credentialVersion,
          sessionId: undefined,
        },
      });
    }
  }
  http = createServer(app);
  sockets = liveQueue(http, identity, events);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 60000);
afterAll(async () => {
  if (sockets) await sockets.close();
  if (db) {
    expect(db.connection.name).toMatch(/^auracare_test_/);
    await db.connection.dropDatabase();
    await db.connection.close();
  }
});
describe("reception permission matrix", () => {
  for (const role of roles)
    it(`${role} receives only the approved reception capabilities`, async () => {
      const t = bearer(role);
      await request(app)
        .get("/api/v1/patients")
        .auth(t, { type: "bearer" })
        .expect(["RECEPTIONIST", "OWNER"].includes(role) ? 200 : 403);
      await request(app)
        .get("/api/v1/queue")
        .auth(t, { type: "bearer" })
        .expect(["RECEPTIONIST", "OWNER", "DOCTOR"].includes(role) ? 200 : 403);
      await request(app)
        .get("/api/v1/cash/sessions")
        .auth(t, { type: "bearer" })
        .expect(["RECEPTIONIST", "OWNER"].includes(role) ? 200 : 403);
      if (role !== "RECEPTIONIST")
        await request(app)
          .post("/api/v1/patients")
          .auth(t, { type: "bearer" })
          .set("Idempotency-Key", key())
          .send(body())
          .expect(403);
    });
  it("requires authentication for every new resource", async () => {
    for (const path of ["/patients", "/queue", "/cash/sessions"])
      await request(app).get(`/api/v1${path}`).expect(401);
    await request(app).post("/api/v1/patients").send(body()).expect(401);
  });
});
describe("patient registration, search and account provisioning", () => {
  it("replays a registration without creating another patient or exposing credentials", async () => {
    const k = key(),
      input = body("Idempotent Patient");
    const calls = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post("/api/v1/patients")
          .auth(bearer("RECEPTIONIST"), { type: "bearer" })
          .set("Idempotency-Key", k)
          .send(input),
      ),
    );
    expect(calls.map((r) => r.status)).toEqual([201, 201]);
    expect(calls[0]!.body.data.id).toBe(calls[1]!.body.data.id);
    const p = await db
      .patients("alpha")
      .findOne({ _id: calls[0]!.body.data.id });
    expect(p!.userId).toBe("");
    expect(JSON.stringify(calls[0]!.body)).not.toMatch(
      /pinHash|passwordHash|access_token/,
    );
    await request(app)
      .post("/api/v1/patients")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", k)
      .send({ ...input, name: "Changed Patient" })
      .expect(409);
  });
  it("validates demographics, contact normalization, unknown fields and retry keys", async () => {
    const input = body();
    for (const patch of [
      { tenant_id: "beta" },
      { date_of_birth: "2020-02-31" },
      { date_of_birth: "2999-01-01" },
      { contact: { type: "MOBILE", value: "9876543210" } },
      { name: "x" },
    ])
      await request(app)
        .post("/api/v1/patients")
        .auth(bearer("RECEPTIONIST"), { type: "bearer" })
        .set("Idempotency-Key", key())
        .send({ ...input, ...patch })
        .expect(400);
    await request(app)
      .post("/api/v1/patients")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .send(input)
      .expect(400);
    const email = `UPPER-${randomUUID()}@PATIENT.TEST`;
    const r = await request(app)
      .post("/api/v1/patients")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send(body("Normalized", email))
      .expect(201);
    expect(r.body.data.contact.value).toBe(email.toLowerCase());
  });
  it("rejects duplicate contact inside one tenant but allows the same contact across facilities", async () => {
    const contact = `shared-${randomUUID()}@patient.test`;
    for (const [tenant, status] of [
      ["alpha", 201],
      ["alpha", 409],
      ["beta", 201],
    ] as const)
      await request(app)
        .post("/api/v1/patients")
        .auth(bearer("RECEPTIONIST", tenant), { type: "bearer" })
        .set("Idempotency-Key", key())
        .send(body("Separate identities", contact))
        .expect(status);
  });
  it("scopes search, escapes regex characters and paginates without repeating IDs", async () => {
    await register("Pagination Unique Patient");
    const foreign = await register("Foreign Only Name", "beta");
    const r = await request(app)
      .get("/api/v1/patients?q=Foreign%20Only%20Name")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .expect(200);
    expect(r.body.data.items).toHaveLength(0);
    const literal = await request(app)
      .get("/api/v1/patients?q=.*")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .expect(200);
    expect(literal.body.data.items).toHaveLength(0);
    const first = await request(app)
      .get("/api/v1/patients?limit=2")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .expect(200);
    expect(first.body.data.next_cursor).toBeTruthy();
    const second = await request(app)
      .get(`/api/v1/patients?limit=2&cursor=${first.body.data.next_cursor}`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .expect(200);
    const ids = new Set(first.body.data.items.map((p: { id: string }) => p.id));
    expect(
      second.body.data.items.every(
        (p: { id: string }) => !ids.has(p.id) && p.id !== foreign.id,
      ),
    ).toBe(true);
    await request(app)
      .get("/api/v1/patients?tenant_id=beta")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .expect(400);
  });
  it("limits owner projection and assigned-doctor / own-patient access", async () => {
    const p = await register("Scoped Profile"),
      v = await checkIn(p.id);
    const own = await db.patients("alpha").findOne({ _id: p.id });
    const patientUser = await db.users("alpha").findOne({ _id: own!.userId });
    await db
      .users("alpha")
      .update({ _id: patientUser!._id }, { $set: { contactVerified: true } });
    const patientSession = await identity.session({
      ...patientUser!,
      contactVerified: true,
    });
    const owner = await request(app)
      .get(`/api/v1/patients/${p.id}`)
      .auth(bearer("OWNER"), { type: "bearer" })
      .expect(200);
    expect(owner.body.data.contact).toBeUndefined();
    expect(owner.body.data.date_of_birth).toBeUndefined();
    await request(app)
      .get(`/api/v1/patients/${p.id}`)
      .auth(bearer("DOCTOR"), { type: "bearer" })
      .expect(404);
    await db
      .visits("alpha")
      .update(
        { _id: v.id },
        { $set: { doctorId: auth.get("alpha:DOCTOR")!.p.userId } },
      );
    await request(app)
      .get(`/api/v1/patients/${p.id}`)
      .auth(bearer("DOCTOR"), { type: "bearer" })
      .expect(200);
    await request(app)
      .get(`/api/v1/patients/${p.id}`)
      .auth(patientSession.access_token, { type: "bearer" })
      .expect(200);
    await request(app)
      .get(`/api/v1/patients/${p.id}`)
      .auth(bearer("PATIENT"), { type: "bearer" })
      .expect(404);
    await request(app)
      .get(`/api/v1/patients/${p.id}`)
      .auth(bearer("RECEPTIONIST", "beta"), { type: "bearer" })
      .expect(404);
  });
  it("uses optimistic demographic edits and rejects contact changes or cross-tenant writes", async () => {
    const p = await register();
    const uri = `/api/v1/patients/${p.id}`;
    await request(app)
      .patch(uri)
      .auth(bearer("RECEPTIONIST", "beta"), { type: "bearer" })
      .send({ name: "Cross tenant", expected_version: 0 })
      .expect(404);
    await request(app)
      .patch(uri)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .send({ name: "Updated Name", expected_version: 0 })
      .expect(200);
    await request(app)
      .patch(uri)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .send({ name: "Stale Write", expected_version: 0 })
      .expect(409);
    await request(app)
      .patch(uri)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .send({
        contact: { type: "EMAIL", value: "changed@test.test" },
        expected_version: 1,
      })
      .expect(400);
    const cleared = await request(app)
      .patch(uri)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .send({ date_of_birth: null, expected_version: 1 })
      .expect(200);
    expect(cleared.body.data.date_of_birth).toBeNull();
  });
});
describe("check-in transactions, queue and cancellation", () => {
  it("creates exactly one visit and dormant account under concurrent retries", async () => {
    const p = await register("Concurrent Check-in"),
      k = key(),
      input = { patient_id: p.id };
    const r = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post("/api/v1/visits")
          .auth(bearer("RECEPTIONIST"), { type: "bearer" })
          .set("Idempotency-Key", k)
          .send(input),
      ),
    );
    expect(r.map((v) => v.status)).toEqual([201, 201]);
    expect(r[0]!.body.data.id).toBe(r[1]!.body.data.id);
    expect(await db.visits("alpha").count({ patientId: p.id })).toBe(1);
    const profile = await db.patients("alpha").findOne({ _id: p.id });
    const user = await db.users("alpha").findOne({ _id: profile!.userId });
    expect(user!.role).toBe("PATIENT");
    expect(user!.contactVerified).toBe(false);
    expect(user!.pinHash).toMatch(/^\$2/);
    await request(app)
      .post("/api/v1/auth/login")
      .send({
        facility_subdomain: "alpha",
        login: p.contact.value,
        portal_pin: "1234",
      })
      .expect(401);
    await request(app)
      .post("/api/v1/visits")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send(input)
      .expect(409);
  });
  it("rolls back provisioning when contact belongs to an existing staff account", async () => {
    const p = await request(app)
      .post("/api/v1/patients")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send(body("Staff Patient", "doctor@alpha.test"))
      .expect(201);
    await request(app)
      .post("/api/v1/visits")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ patient_id: p.body.data.id })
      .expect(409);
    const patient = await db.patients("alpha").findOne({ _id: p.body.data.id });
    expect(patient!.userId).toBe("");
    expect(await db.visits("alpha").count({ patientId: patient!._id })).toBe(0);
  });
  it("rejects foreign patient check-in and queue scope injection", async () => {
    const p = await register("Foreign Checkin", "beta");
    await request(app)
      .post("/api/v1/visits")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ patient_id: p.id })
      .expect(404);
    await request(app)
      .get("/api/v1/queue?tenant_id=beta")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .expect(400);
  });
  it("orders queue tickets monotonically and strips demographics from doctor queue", async () => {
    const p = await register("Queue first"),
      q = await register("Queue second");
    const visits = await Promise.all([checkIn(p.id), checkIn(q.id)]);
    expect(visits[0]!.queue_number).not.toBe(visits[1]!.queue_number);
    const r = await request(app)
      .get("/api/v1/queue")
      .auth(bearer("DOCTOR"), { type: "bearer" })
      .expect(200);
    const numbers = r.body.data.items.map(
      (v: { queue_number: number }) => v.queue_number,
    );
    expect(numbers).toEqual([...numbers].sort((a: number, b: number) => a - b));
    expect(r.body.data.items.every((v: object) => !("patient_name" in v))).toBe(
      true,
    );
  });
  it("cancels queued visits with version checks and safely replays cancellation", async () => {
    const p = await register(),
      v = await checkIn(p.id),
      k = key(),
      input = { expected_version: 0, reason: "Patient requested cancellation" };
    await request(app)
      .post(`/api/v1/visits/${v.id}/cancel`)
      .auth(bearer("OWNER", "beta"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send(input)
      .expect(404);
    await request(app)
      .post(`/api/v1/visits/${v.id}/cancel`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", k)
      .send(input)
      .expect(200);
    await request(app)
      .post(`/api/v1/visits/${v.id}/cancel`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", k)
      .send(input)
      .expect(200);
    const r = await request(app)
      .get("/api/v1/queue")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .expect(200);
    expect(
      r.body.data.items.some((row: { id: string }) => row.id === v.id),
    ).toBe(false);
    const next = await checkIn(p.id);
    expect(next.id).not.toBe(v.id);
    expect(next.queue_number).toBeGreaterThan(v.queue_number);
  });
  it("allows one active visit under distinct simultaneous requests", async () => {
    const p = await register();
    const r = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post("/api/v1/visits")
          .auth(bearer("RECEPTIONIST"), { type: "bearer" })
          .set("Idempotency-Key", key())
          .send({ patient_id: p.id }),
      ),
    );
    expect(r.map((v) => v.status).sort()).toEqual([201, 409]);
  });
});
describe("vitals validation, privacy and lifecycle", () => {
  it("records typed units idempotently and retains prior measurements", async () => {
    const p = await register(),
      v = await checkIn(p.id),
      k = key();
    for (let i = 0; i < 2; i++)
      await request(app)
        .post(`/api/v1/visits/${v.id}/vitals`)
        .auth(bearer("RECEPTIONIST"), { type: "bearer" })
        .set("Idempotency-Key", k)
        .send(vitals)
        .expect(201);
    const r = await request(app)
      .get(`/api/v1/visits/${v.id}/vitals`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .expect(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].observations).toEqual(vitals.observations);
  });
  it("rejects wrong units, duplicate codes, incomplete pressure pairs and invalid percentages", async () => {
    const p = await register(),
      v = await checkIn(p.id);
    for (const observations of [
      [{ code: "TEMPERATURE", value: 98, unit: "°F" }],
      [vitals.observations[0], vitals.observations[0]],
      [{ code: "SYSTOLIC_BP", value: 120, unit: "mmHg" }],
      [{ code: "SPO2", value: 101, unit: "%" }],
    ])
      await request(app)
        .post(`/api/v1/visits/${v.id}/vitals`)
        .auth(bearer("RECEPTIONIST"), { type: "bearer" })
        .set("Idempotency-Key", key())
        .send({ observations })
        .expect(400);
  });
  it("denies foreign visits, owner clinical reads and unassigned doctors", async () => {
    const p = await register(),
      v = await checkIn(p.id);
    await request(app)
      .get(`/api/v1/visits/${v.id}/vitals`)
      .auth(bearer("RECEPTIONIST", "beta"), { type: "bearer" })
      .expect(404);
    await request(app)
      .get(`/api/v1/visits/${v.id}/vitals`)
      .auth(bearer("OWNER"), { type: "bearer" })
      .expect(403);
    await request(app)
      .get(`/api/v1/visits/${v.id}/vitals`)
      .auth(bearer("DOCTOR"), { type: "bearer" })
      .expect(404);
    await request(app)
      .post(`/api/v1/visits/${v.id}/vitals`)
      .auth(bearer("DOCTOR"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send(vitals)
      .expect(403);
  });
  it("blocks writes to cancelled visits and stale cancellation after a vitals update", async () => {
    const p = await register(),
      v = await checkIn(p.id);
    await request(app)
      .post(`/api/v1/visits/${v.id}/vitals`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send(vitals)
      .expect(201);
    await request(app)
      .post(`/api/v1/visits/${v.id}/cancel`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ expected_version: 0, reason: "Stale cancellation" })
      .expect(409);
    await request(app)
      .post(`/api/v1/visits/${v.id}/cancel`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send({ expected_version: 1, reason: "Patient cancelled" })
      .expect(200);
    await request(app)
      .post(`/api/v1/visits/${v.id}/vitals`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send(vitals)
      .expect(409);
  });
});
describe("opening cash floats and financial deferral", () => {
  it("records exact INR minor units and deduplicates opening requests", async () => {
    const k = key(),
      input = { opening_float: "1000.29", currency: "INR" };
    const r = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post("/api/v1/cash/sessions")
          .auth(bearer("RECEPTIONIST"), { type: "bearer" })
          .set("Idempotency-Key", k)
          .send(input),
      ),
    );
    expect(r.map((v) => v.status)).toEqual([201, 201]);
    expect(r[0]!.body.data.opening_float_minor).toBe(100029);
    expect(r[0]!.body.data.id).toBe(r[1]!.body.data.id);
    expect(r[0]!.body.data.reconciliation_available).toBe(false);
    await request(app)
      .post("/api/v1/cash/sessions")
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .set("Idempotency-Key", key())
      .send(input)
      .expect(409);
  });
  it("rejects excess precision, negative amounts, floating-point bodies and other currencies", async () => {
    for (const input of [
      { opening_float: "1.001", currency: "INR" },
      { opening_float: "-1", currency: "INR" },
      { opening_float: 1.1, currency: "INR" },
      { opening_float: "10", currency: "USD" },
    ])
      await request(app)
        .post("/api/v1/cash/sessions")
        .auth(bearer("RECEPTIONIST", "beta"), { type: "bearer" })
        .set("Idempotency-Key", key())
        .send(input)
        .expect(400);
  });
  it("scopes shifts to receptionist and tenant and has no premature close endpoint", async () => {
    const beta = await request(app)
      .get("/api/v1/cash/sessions")
      .auth(bearer("OWNER", "beta"), { type: "bearer" })
      .expect(200);
    expect(beta.body.data).toHaveLength(0);
    const alpha = await request(app)
      .get("/api/v1/cash/sessions")
      .auth(bearer("OWNER"), { type: "bearer" })
      .expect(200);
    expect(alpha.body.data).toHaveLength(1);
    await request(app)
      .post(`/api/v1/cash/sessions/${alpha.body.data[0].id}/close`)
      .auth(bearer("RECEPTIONIST"), { type: "bearer" })
      .send({})
      .expect(404);
  });
  it("keeps patient payloads out of retry ledgers and audit events", async () => {
    const records = await db.operations("alpha").find();
    const audits = await db.audits("alpha").find();
    expect(records.length).toBeGreaterThan(0);
    expect(audits.length).toBeGreaterThan(0);
    const encoded = JSON.stringify({ records, audits });
    expect(encoded).not.toMatch(
      /date_of_birth|observations|patient\.test|patient_name|Cancellation reason/,
    );
  });
});
function socket(role: Role, tenant = "alpha", raw = bearer(role, tenant)) {
  return io(url, {
    auth: { token: raw },
    extraHeaders: { Origin: config.origin },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
}
async function connected(s: Socket) {
  await new Promise<void>((resolve, reject) => {
    s.once("connect", () => resolve());
    s.once("connect_error", reject);
  });
}
describe("live queue authentication and isolation", () => {
  it("rejects anonymous, patient and invalid JWT subscriptions", async () => {
    for (const token of ["", bearer("PATIENT"), "invalid"]) {
      const s = socket("RECEPTIONIST", "alpha", token);
      await new Promise<void>((resolve, reject) => {
        s.once("connect", () =>
          reject(new Error("Unauthorized socket connected")),
        );
        s.once("connect_error", () => resolve());
      });
      s.disconnect();
    }
  });
  it("publishes only committed, minimal updates to the correct tenant", async () => {
    const a = socket("RECEPTIONIST"),
      b = socket("RECEPTIONIST", "beta");
    try {
      await Promise.all([connected(a), connected(b)]);
      const received: unknown[] = [];
      b.on("queue.updated", (v) => received.push(v));
      const update = new Promise<{
        visit_id: string;
        state: string;
        version: number;
      }>((resolve) => a.once("queue.updated", resolve));
      const p = await register("Private Name Not In Event"),
        v = await checkIn(p.id);
      const event = await update;
      expect(event).toEqual({ visit_id: v.id, state: "QUEUED", version: 0 });
      expect(JSON.stringify(event)).not.toContain(p.name);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(received).toHaveLength(0);
    } finally {
      a.disconnect();
      b.disconnect();
    }
  });
  it("revalidates a session before emitting and disconnects revoked subscribers", async () => {
    const user = await db.users("alpha").create({
      name: "Socket Test",
      login: "socket-test@alpha.test",
      role: "RECEPTIONIST",
      passwordHash: await passwordHash(password),
      contactVerified: true,
    });
    const session = await identity.session(user);
    const s = socket("RECEPTIONIST", "alpha", session.access_token);
    try {
      await connected(s);
      await db
        .sessions("alpha")
        .updateMany({ userId: user._id }, { $set: { revokedAt: new Date() } });
      const disconnected = new Promise<void>((resolve) =>
        s.once("disconnect", () => resolve()),
      );
      events.publish({
        tenantId: "alpha",
        visitId: randomUUID(),
        state: "QUEUED",
        version: 0,
      });
      await disconnected;
      expect(s.connected).toBe(false);
    } finally {
      s.disconnect();
    }
  });
});
describe("transactional operation rollback", () => {
  it("does not retain an idempotency record or audit after a failing callback", async () => {
    const p = auth.get("alpha:RECEPTIONIST")!.p,
      k = key(),
      ops = new Operations(db);
    await expect(
      ops.execute(p, "rollback-test", k, {}, async (s) => {
        await db.audits("alpha").create(
          {
            actorId: p.userId,
            action: "ROLLBACK_ONLY",
            resourceId: "fake",
            outcome: "SUCCESS",
            requestId: key(),
          },
          s,
        );
        throw new Error("test rollback");
      }),
    ).rejects.toThrow("test rollback");
    expect(
      await db.operations("alpha").findOne({ operation: "rollback-test" }),
    ).toBeNull();
    expect(
      await db.audits("alpha").findOne({ action: "ROLLBACK_ONLY" }),
    ).toBeNull();
  });
});
