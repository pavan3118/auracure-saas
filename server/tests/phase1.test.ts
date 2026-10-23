import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Config } from "../src/config.js";
import { connect, type Database, type User } from "../src/db.js";
import { Identity, passwordHash } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { deliverOutbox, type Mailer } from "../src/mail.js";
import {
  makeTotp,
  newSecret,
  seal,
  digest,
  token,
  signer,
} from "../src/crypto.js";
import { roles, type Role } from "../src/types.js";
let db: Database, identity: Identity, app: Express, config: Config;
const letters: { to: string; subject: string; body: string }[] = [];
const mail: Mailer = {
  send: async (to, subject, body) => {
    letters.push({ to, subject, body });
  },
};
const password = "a safe test password 123!";
interface Fixture {
  tenantId: string;
  ownerId: string;
  access: string;
  enroll: string;
  secret: string;
  recovery: string[];
  cookie: string;
  email: string;
  subdomain: string;
}
let alpha: Fixture, beta: Fixture;
const staff = new Map<Role, { user: User; access: string }>();
function sent(to: string, subject: string) {
  const l = letters.filter((x) => x.to === to && x.subject === subject).at(-1);
  expect(l).toBeDefined();
  return l!.body;
}
function linkToken(body: string) {
  const value = /token=([\w-]+)/.exec(body)?.[1];
  expect(value).toBeTruthy();
  return value!;
}
async function contact(email: string, subdomain: string) {
  const c = await identity.contact(email, subdomain);
  const proof = sent(email, "Verify your AuraCare contact")
    .split("Verification code: ")[1]!
    .split("\n")[0]!;
  return identity.verifyContact(c.challenge_id, proof);
}
async function fixture(subdomain: string): Promise<Fixture> {
  const email = `owner@${subdomain}.test`,
    grant = await contact(email, subdomain);
  const r = await identity.register(
    {
      facility: {
        name: `${subdomain} clinic`,
        type: "CLINIC",
        subdomain,
        capacity: 5,
      },
      owner: { name: "Test Owner", email, password },
      ...grant,
    },
    "test",
    randomUUID(),
  );
  const enrollment = await request(app)
    .post("/api/v1/auth/mfa/enroll")
    .auth(r.access_token, { type: "bearer" })
    .send({})
    .expect(200);
  const secret = enrollment.body.data.secret as string;
  const confirmed = await request(app)
    .post("/api/v1/auth/mfa/confirm")
    .auth(r.access_token, { type: "bearer" })
    .send({ proof: makeTotp(secret, "test").generate() })
    .expect(200);
  return {
    tenantId: r.tenant.id,
    ownerId: r.user.id,
    access: confirmed.body.data.access_token,
    enroll: r.access_token,
    secret,
    recovery: confirmed.body.data.recovery_codes,
    cookie: confirmed.headers["set-cookie"][0] as string,
    email,
    subdomain,
  };
}
const freshProof = (f: Fixture) => f.recovery.pop()!;
beforeAll(async () => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const uri = new URL(
    process.env.TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017/?replicaSet=rs0",
  );
  uri.pathname = `/auracare_test_${randomUUID().replaceAll("-", "")}`;
  config = {
    mongoUri: uri.toString(),
    origin: "http://localhost:5173",
    port: 3000,
    production: false,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    encryptionKey: randomBytes(32),
    pinPepper: randomBytes(32),
    issuer: "auracare-test",
    audience: "auracare-tenant",
    mailDir: ".local/test-mail",
    mailFrom: "test@auracare.test",
  };
  db = await connect(config.mongoUri);
  identity = await Identity.create(db, config, mail);
  app = await createApp(identity);
  alpha = await fixture("alpha");
  beta = await fixture("beta");
  for (const role of roles) {
    const u = await db.users(alpha.tenantId).create({
      name: `${role} user`,
      login: `${role.toLowerCase()}-fixture@alpha.test`,
      role,
      passwordHash: await passwordHash(password),
      pinHash: role === "PATIENT" ? await identity.hashPin("1234") : "",
      contactVerified: true,
      mfaEnabled: role === "OWNER",
      mfaSecret:
        role === "OWNER" ? seal(newSecret(), config.encryptionKey) : "",
    });
    const result = await identity.session(u);
    staff.set(role, { user: u, access: result.access_token });
  }
}, 180000);
beforeEach(async () => {
  await db.connection.collection("ratebuckets").deleteMany({});
});
afterAll(async () => {
  if (db) {
    expect(db.connection.name).toMatch(/^auracare_test_/);
    await db.connection.dropDatabase();
    await db.connection.close();
  }
});
describe("onboarding transaction and verified contacts", () => {
  it("requires verified contact, a strong password and an idempotency key", async () => {
    const body = {
      facility: {
        name: "Test",
        type: "CLINIC",
        subdomain: "test-facility",
        capacity: 5,
      },
      owner: { name: "Test Owner", email: "test@contact.test", password },
      verification_grant: token(),
    };
    await request(app)
      .post("/api/v1/onboarding/register")
      .send(body)
      .expect(400);
    const r = await request(app)
      .post("/api/v1/onboarding/register")
      .set("Idempotency-Key", randomUUID())
      .send(body)
      .expect(400);
    expect(r.body.error.code).toBe("CONTACT_UNVERIFIED");
    await request(app)
      .post("/api/v1/onboarding/register")
      .set("Idempotency-Key", randomUUID())
      .send({ ...body, owner: { ...body.owner, password: "weak" } })
      .expect(400);
    expect(await db.resolveSubdomain("test-facility")).toBeNull();
  });
  it("verifies proof once and limits guesses", async () => {
    const c = await identity.contact("proof@test.test", "proof-test");
    for (let i = 0; i < 5; i++)
      await expect(
        identity.verifyContact(c.challenge_id, "wrong"),
      ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
    const proof = sent("proof@test.test", "Verify your AuraCare contact")
      .split("Verification code: ")[1]!
      .split("\n")[0]!;
    await expect(
      identity.verifyContact(c.challenge_id, proof),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
  });
  it("creates one tenant and owner, returns enrollment only, and supports retry without duplicate creation", async () => {
    const subdomain = "idempotent-test",
      email = "owner@idempotent.test",
      grant = await contact(email, subdomain),
      key = randomUUID();
    const body = {
      facility: {
        name: "Retry Clinic",
        type: "CLINIC",
        subdomain,
        capacity: 3,
      },
      owner: { name: "Retry Owner", email, password },
      ...grant,
    };
    const a = await request(app)
      .post("/api/v1/onboarding/register")
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const b = await request(app)
      .post("/api/v1/onboarding/register")
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    expect(a.body.data.tenant.id).toBe(b.body.data.tenant.id);
    expect(a.body.data.user.id).toBe(b.body.data.user.id);
    await request(app)
      .get("/api/v1/me")
      .auth(a.body.data.access_token, { type: "bearer" })
      .expect(403);
    await request(app)
      .post("/api/v1/onboarding/register")
      .set("Idempotency-Key", key)
      .send({ ...body, facility: { ...body.facility, name: "Changed" } })
      .expect(409);
    expect((await db.users(a.body.data.tenant.id).find()).length).toBe(1);
  });
  it("rolls back tenant and proof consumption if owner creation fails", async () => {
    const subdomain = "rollback-test",
      email = "owner@rollback.test",
      grant = await contact(email, subdomain);
    const body = {
      facility: { name: "Rollback", type: "CLINIC", subdomain, capacity: 1 },
      owner: { name: "", email, password },
      ...grant,
    };
    await expect(
      identity.register(body, "test", randomUUID()),
    ).rejects.toBeDefined();
    expect(await db.resolveSubdomain(subdomain)).toBeNull();
    const r = await identity.register(
      { ...body, owner: { ...body.owner, name: "Valid Owner" } },
      "test",
      randomUUID(),
    );
    expect(r.tenant.id).toBeTruthy();
  });
  it("uses a unique index to settle concurrent subdomain registrations", async () => {
    const subdomain = "race-test";
    const emails = ["race1@test.test", "race2@test.test"];
    const grants = await Promise.all(emails.map((e) => contact(e, subdomain)));
    const results = await Promise.allSettled(
      emails.map((email, i) =>
        identity.register(
          {
            facility: {
              name: "Race Clinic",
              type: "CLINIC",
              subdomain,
              capacity: 2,
            },
            owner: { name: "Race Owner", email, password },
            ...grants[i]!,
          },
          "test",
          randomUUID(),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("rejects tenant injection, unknown fields, invalid subdomains and excessive UTF-8 password length", async () => {
    const base = {
      facility: {
        name: "Test",
        type: "CLINIC",
        subdomain: "bad space",
        capacity: 2,
      },
      owner: { name: "Owner", email: "x@y.test", password },
      verification_grant: "x",
    };
    await request(app)
      .post("/api/v1/onboarding/register")
      .set("Idempotency-Key", randomUUID())
      .send({ ...base, tenant_id: alpha.tenantId })
      .expect(400);
    await request(app)
      .post("/api/v1/onboarding/register")
      .set("Idempotency-Key", randomUUID())
      .send({ ...base, facility: { ...base.facility, subdomain: "api" } })
      .expect(400);
    await request(app)
      .post("/api/v1/onboarding/register")
      .set("Idempotency-Key", randomUUID())
      .send({ ...base, owner: { ...base.owner, password: "💙".repeat(25) } })
      .expect(400);
  });
});
describe("JWT authentication and MFA", () => {
  it("denies unauthenticated, tampered and expired tokens", async () => {
    await request(app).get("/api/v1/me").expect(401);
    await request(app)
      .get("/api/v1/me")
      .auth(alpha.access + "bad", { type: "bearer" })
      .expect(401);
    const { SignJWT, importPKCS8 } = await import("jose");
    const key = await importPKCS8(config.privateKey, "RS256");
    const expired = await new SignJWT({
      tenant_id: alpha.tenantId,
      role: "OWNER",
      purpose: "access",
      version: 1,
    })
      .setSubject(alpha.ownerId)
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setProtectedHeader({ alg: "RS256" })
      .setExpirationTime("0s")
      .sign(key);
    await request(app)
      .get("/api/v1/me")
      .auth(expired, { type: "bearer" })
      .expect(401);
  });
  it("rejects operator-audience tokens on tenant routes", async () => {
    const other = await signer({ ...config, audience: "auracare-platform" });
    const raw = await other.issue({
      userId: alpha.ownerId,
      tenantId: alpha.tenantId,
      role: "OWNER",
      version: 1,
      purpose: "access",
    });
    await request(app)
      .get("/api/v1/me")
      .auth(raw, { type: "bearer" })
      .expect(401);
  });
  it("invalidates the enrollment token after confirmation and hides secrets from me", async () => {
    await request(app)
      .post("/api/v1/auth/mfa/enroll")
      .auth(alpha.enroll, { type: "bearer" })
      .send({})
      .expect(401);
    const r = await request(app)
      .get("/api/v1/me")
      .auth(alpha.access, { type: "bearer" })
      .expect(200);
    expect(r.body.data.user).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(r.body)).not.toContain(alpha.secret);
    expect(r.body.data.user.mfa_enabled).toBe(true);
  });
  it("requires MFA on owner login and rejects replayed TOTP", async () => {
    const r = await request(app)
      .post("/api/v1/auth/login")
      .send({
        facility_subdomain: alpha.subdomain,
        login: alpha.email,
        password,
      })
      .expect(200);
    expect(r.body.data.purpose).toBe("mfa-challenge");
    await request(app)
      .get("/api/v1/staff")
      .auth(r.body.data.access_token, { type: "bearer" })
      .expect(403);
    const replay = await request(app)
      .post("/api/v1/auth/mfa/verify")
      .auth(r.body.data.access_token, { type: "bearer" })
      .send({ proof: makeTotp(alpha.secret, "test").generate() });
    expect([200, 401]).toContain(replay.status);
    if (replay.status === 200)
      await request(app)
        .post("/api/v1/auth/mfa/verify")
        .auth(r.body.data.access_token, { type: "bearer" })
        .send({ proof: makeTotp(alpha.secret, "test").generate() })
        .expect(401);
    const code = freshProof(alpha);
    await request(app)
      .post("/api/v1/auth/mfa/verify")
      .auth(r.body.data.access_token, { type: "bearer" })
      .send({ proof: code })
      .expect(200);
    await request(app)
      .post("/api/v1/auth/mfa/verify")
      .auth(r.body.data.access_token, { type: "bearer" })
      .send({ proof: code })
      .expect(401);
  });
  it("rotates refresh cookies, checks Origin, and revokes the family on reuse", async () => {
    const u = staff.get("DOCTOR")!.user;
    const s = await identity.session(u);
    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", `auracare_refresh=${s.refresh}`)
      .send({})
      .expect(403);
    const r = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.origin)
      .set("Cookie", `auracare_refresh=${s.refresh}`)
      .send({})
      .expect(200);
    expect(r.body.data.refresh).toBeUndefined();
    expect(r.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(r.headers["set-cookie"][0]).toContain("SameSite=Lax");
    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.origin)
      .set("Cookie", `auracare_refresh=${s.refresh}`)
      .send({})
      .expect(401);
    await request(app)
      .get("/api/v1/me")
      .auth(r.body.data.access_token, { type: "bearer" })
      .expect(401);
  });
  it("enforces password change for temporary credentials before access", async () => {
    const u = await db.users(alpha.tenantId).create({
      name: "Temporary Doctor",
      login: "temp@alpha.test",
      role: "DOCTOR",
      passwordHash: await passwordHash(password),
      mustChangePassword: true,
      contactVerified: true,
    });
    const r = await request(app)
      .post("/api/v1/auth/login")
      .send({ facility_subdomain: alpha.subdomain, login: u.login, password })
      .expect(200);
    expect(r.body.data.purpose).toBe("password-change");
    await request(app)
      .get("/api/v1/me")
      .auth(r.body.data.access_token, { type: "bearer" })
      .expect(403);
    const changed = await request(app)
      .post("/api/v1/auth/password/change")
      .auth(r.body.data.access_token, { type: "bearer" })
      .send({ current: password, new_password: password + "new" })
      .expect(200);
    expect(changed.body.data.purpose).toBe("access");
    await request(app)
      .get("/api/v1/me")
      .auth(r.body.data.access_token, { type: "bearer" })
      .expect(401);
  });
  it("rate-limits bad login guesses using shared database counters", async () => {
    for (let i = 0; i < 5; i++)
      await request(app)
        .post("/api/v1/auth/login")
        .send({
          facility_subdomain: "alpha",
          login: "unknown@test.test",
          password: "wrong",
        })
        .expect(401);
    await request(app)
      .post("/api/v1/auth/login")
      .send({
        facility_subdomain: "alpha",
        login: "unknown@test.test",
        password: "wrong",
      })
      .expect(429);
  });
  it("rejects cross-origin mutations", async () => {
    await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "https://attacker.test")
      .send({})
      .expect(403);
  });
});
describe("six-role permissions and tenant isolation", () => {
  for (const role of roles)
    it(`${role} can see own identity; only OWNER can list staff/audit`, async () => {
      const { access, user } = staff.get(role)!;
      const r = await request(app)
        .get("/api/v1/me")
        .auth(access, { type: "bearer" })
        .expect(200);
      expect(r.body.data.user.id).toBe(user._id);
      await request(app)
        .get("/api/v1/staff")
        .auth(access, { type: "bearer" })
        .expect(role === "OWNER" ? 200 : 403);
      await request(app)
        .get("/api/v1/audit-events")
        .auth(access, { type: "bearer" })
        .expect(role === "OWNER" ? 200 : 403);
    });
  it("does not list other tenants, return hashes or permit query scope injection", async () => {
    const r = await request(app)
      .get("/api/v1/staff")
      .auth(alpha.access, { type: "bearer" })
      .expect(200);
    expect(r.body.data.some((u: { id: string }) => u.id === beta.ownerId)).toBe(
      false,
    );
    expect(JSON.stringify(r.body)).not.toMatch(
      /passwordHash|mfaSecret|recoveryHashes|pinHash/,
    );
    await request(app)
      .get(`/api/v1/staff?tenant_id=${beta.tenantId}`)
      .auth(alpha.access, { type: "bearer" })
      .expect(400);
  });
  it("central scoped repositories protect reads, writes and nested query operators", async () => {
    expect(
      await db.users(alpha.tenantId).findOne({ _id: beta.ownerId }),
    ).toBeNull();
    expect(
      await db
        .users(alpha.tenantId)
        .update({ _id: beta.ownerId }, { $set: { status: "DISABLED" } }),
    ).toBeNull();
    expect(
      await db.users(alpha.tenantId).findOne({
        $or: [{ tenant_id: beta.tenantId }, { _id: beta.ownerId }],
      }),
    ).toBeNull();
    expect(
      (await db.users(beta.tenantId).findOne({ _id: beta.ownerId }))!.status,
    ).toBe("ACTIVE");
    expect(() => db.users("")).toThrow("SCOPE_REQUIRED");
    expect(() =>
      db
        .users(alpha.tenantId)
        .update({ _id: alpha.ownerId }, { $set: { tenant_id: beta.tenantId } }),
    ).toThrow("SCOPE_IMMUTABLE");
  });
  it("rejects clinical role self-escalation and patient invitations", async () => {
    await request(app)
      .post("/api/v1/staff/invitations")
      .auth(staff.get("DOCTOR")!.access, { type: "bearer" })
      .send({ login: "bad@test.test", role: "OWNER" })
      .expect(403);
    await request(app)
      .post("/api/v1/staff/invitations")
      .auth(staff.get("PHARMACIST")!.access, { type: "bearer" })
      .send({ login: "bad@test.test", role: "OWNER" })
      .expect(403);
    await request(app)
      .post("/api/v1/staff/invitations")
      .auth(alpha.access, { type: "bearer" })
      .send({ login: "patient@test.test", role: "PATIENT" })
      .expect(400);
    await request(app)
      .post("/api/v1/staff/invitations")
      .auth(alpha.access, { type: "bearer" })
      .send({ login: "operator@test.test", role: "SYSTEM_ADMIN" })
      .expect(400);
  });
});
describe("staff lifecycle and invitations", () => {
  it("invites, accepts once and records sanitized audit events", async () => {
    const login = "invited-doctor@test.test";
    await request(app)
      .post("/api/v1/staff/invitations")
      .auth(alpha.access, { type: "bearer" })
      .send({ login, role: "DOCTOR" })
      .expect(201);
    await deliverOutbox(db, config, mail);
    const raw = linkToken(sent(login, "Join your AuraCare facility"));
    const result = await request(app)
      .post("/api/v1/auth/invitations/accept")
      .send({ token: raw, name: "Invited Doctor", password })
      .expect(201);
    expect(result.body.data.user.role).toBe("DOCTOR");
    await request(app)
      .post("/api/v1/auth/invitations/accept")
      .send({ token: raw, name: "Invited Doctor", password })
      .expect(400);
    expect(
      (
        await db
          .audits(alpha.tenantId)
          .find({ action: "STAFF_INVITE_ACCEPTED" })
      ).length,
    ).toBeGreaterThan(0);
  });
  it("requires owner approval for pharmacist/lab same-role invitation requests", async () => {
    const login = "requested-pharmacist@test.test";
    const r = await request(app)
      .post("/api/v1/staff/invitations")
      .auth(staff.get("PHARMACIST")!.access, { type: "bearer" })
      .send({ login, role: "PHARMACIST" })
      .expect(201);
    expect(r.body.data.approved).toBe(false);
    await deliverOutbox(db, config, mail);
    expect(letters.some((x) => x.to === login)).toBe(false);
    await request(app)
      .post(`/api/v1/staff/invitations/${r.body.data.id}/approve`)
      .auth(beta.access, { type: "bearer" })
      .send({})
      .expect(404);
    await request(app)
      .post(`/api/v1/staff/invitations/${r.body.data.id}/approve`)
      .auth(alpha.access, { type: "bearer" })
      .send({})
      .expect(200);
    await deliverOutbox(db, config, mail);
    expect(sent(login, "Join your AuraCare facility")).toContain(
      "/invite?token=",
    );
  });
  it("requires and hashes a separate lab sign-off PIN on provisioning", async () => {
    const login = "lab-new@test.test";
    await identity.invite(
      {
        userId: alpha.ownerId,
        tenantId: alpha.tenantId,
        role: "OWNER",
        purpose: "access",
        version: 1,
      },
      login,
      "LAB",
      "test",
    );
    await deliverOutbox(db, config, mail);
    const raw = linkToken(sent(login, "Join your AuraCare facility"));
    await request(app)
      .post("/api/v1/auth/invitations/accept")
      .send({ token: raw, name: "Lab Test", password })
      .expect(400);
    const r = await request(app)
      .post("/api/v1/auth/invitations/accept")
      .send({ token: raw, name: "Lab Test", password, signoff_pin: "123456" })
      .expect(201);
    const u = await db
      .users(alpha.tenantId)
      .findOne({ _id: r.body.data.user.id });
    expect(u!.signoffPinHash).toMatch(/^\$2/);
    expect(JSON.stringify(r.body)).not.toContain("123456");
  });
  it("rejects expired invitations", async () => {
    const raw = token();
    await db.challenges(alpha.tenantId).create({
      purpose: "INVITE",
      login: "expired@test.test",
      role: "DOCTOR",
      hash: digest(raw),
      approved: true,
      expiresAt: new Date(Date.now() - 1),
    });
    await request(app)
      .post("/api/v1/auth/invitations/accept")
      .send({ token: raw, name: "Expired", password })
      .expect(400);
  });
  it("rejects cross-tenant staff updates even with a valid owner reauthentication code", async () => {
    await request(app)
      .patch(`/api/v1/staff/${beta.ownerId}`)
      .auth(alpha.access, { type: "bearer" })
      .send({ status: "DISABLED", mfa_proof: freshProof(alpha) })
      .expect(404);
    expect(
      (await db.users(beta.tenantId).findOne({ _id: beta.ownerId }))!.status,
    ).toBe("ACTIVE");
  });
  it("protects the final active owner", async () => {
    await request(app)
      .patch(`/api/v1/staff/${beta.ownerId}`)
      .auth(beta.access, { type: "bearer" })
      .send({ status: "DISABLED", mfa_proof: freshProof(beta) })
      .expect(409);
  });
  it("records licence verification and rejects different-tenant licence updates", async () => {
    const pharmacist = staff.get("PHARMACIST")!.user;
    await request(app)
      .post(`/api/v1/staff/${pharmacist._id}/licence-verification`)
      .auth(beta.access, { type: "bearer" })
      .send({ evidence_ref: "licence-check-123", mfa_proof: freshProof(beta) })
      .expect(404);
    await request(app)
      .post(`/api/v1/staff/${pharmacist._id}/licence-verification`)
      .auth(alpha.access, { type: "bearer" })
      .send({ evidence_ref: "licence-check-123", mfa_proof: freshProof(alpha) })
      .expect(200);
    expect(
      (await db.users(alpha.tenantId).findOne({ _id: pharmacist._id }))!
        .licenceStatus,
    ).toBe("VERIFIED");
  });
  it("disabling staff revokes their existing access and refresh sessions", async () => {
    const u = await db.users(alpha.tenantId).create({
      name: "Disable Test",
      login: "disable@test.test",
      role: "DOCTOR",
      passwordHash: await passwordHash(password),
      contactVerified: true,
    });
    const session = await identity.session(u);
    await request(app)
      .patch(`/api/v1/staff/${u._id}`)
      .auth(alpha.access, { type: "bearer" })
      .send({ status: "DISABLED", mfa_proof: freshProof(alpha) })
      .expect(200);
    await request(app)
      .get("/api/v1/me")
      .auth(session.access_token, { type: "bearer" })
      .expect(401);
    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Origin", config.origin)
      .set("Cookie", `auracare_refresh=${session.refresh}`)
      .send({})
      .expect(401);
  });
});
describe("recovery and patient identity", () => {
  it("returns generic recovery responses for unknown accounts", async () => {
    const known = await request(app)
      .post("/api/v1/auth/recovery/request")
      .send({ facility_subdomain: "alpha", login: alpha.email })
      .expect(202);
    const unknown = await request(app)
      .post("/api/v1/auth/recovery/request")
      .send({ facility_subdomain: "alpha", login: "missing@test.test" })
      .expect(202);
    expect(known.body.data).toEqual(unknown.body.data);
  });
  it("enforces 15-minute expiry and single use, rejects weak staff passwords and revokes sessions", async () => {
    const u = staff.get("RECEPTIONIST")!.user;
    await identity.recovery("alpha", u.login);
    const c = (
      await db
        .challenges(alpha.tenantId)
        .find({ userId: u._id, purpose: "RECOVERY" })
    )[0]!;
    expect(c.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60000);
    expect(c.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60000);
    await deliverOutbox(db, config, mail);
    const raw = linkToken(sent(u.login, "Reset your AuraCare password"));
    await request(app)
      .post("/api/v1/auth/recovery/complete")
      .send({ token: raw, new_password: "1234" })
      .expect(400);
    await request(app)
      .post("/api/v1/auth/recovery/complete")
      .send({ token: raw, new_password: password + "reset" })
      .expect(200);
    await request(app)
      .post("/api/v1/auth/recovery/complete")
      .send({ token: raw, new_password: password + "again" })
      .expect(400);
    await request(app)
      .get("/api/v1/me")
      .auth(staff.get("RECEPTIONIST")!.access, { type: "bearer" })
      .expect(401);
    const expired = token();
    await db.challenges(alpha.tenantId).create({
      purpose: "RECOVERY",
      userId: u._id,
      login: u.login,
      role: u.role,
      hash: digest(expired),
      approved: true,
      expiresAt: new Date(Date.now() - 1),
    });
    await request(app)
      .post("/api/v1/auth/recovery/complete")
      .send({ token: expired, new_password: password })
      .expect(400);
  });
  it("does not bypass owner MFA during password recovery", async () => {
    await identity.recovery("beta", beta.email);
    await deliverOutbox(db, config, mail);
    const raw = linkToken(sent(beta.email, "Reset your AuraCare password"));
    await request(app)
      .post("/api/v1/auth/recovery/complete")
      .send({ token: raw, new_password: password + "reset" })
      .expect(403);
    const c = await db.resolveChallenge(digest(raw), "RECOVERY");
    expect(c).not.toBeNull();
  });
  it("accepts only the patient PIN credential mode and exchanges OTP once in the original tenant", async () => {
    const u = staff.get("PATIENT")!.user;
    const r = await request(app)
      .post("/api/v1/auth/login")
      .send({ facility_subdomain: "alpha", login: u.login, portal_pin: "1234" })
      .expect(200);
    expect(r.body.data.user.role).toBe("PATIENT");
    await request(app)
      .post("/api/v1/auth/login")
      .send({ facility_subdomain: "alpha", login: u.login, password })
      .expect(401);
    await identity.requestOtp("alpha", u.login);
    await deliverOutbox(db, config, mail);
    const raw = linkToken(sent(u.login, "AuraCare patient sign-in"));
    const exchanged = await request(app)
      .post("/api/v1/auth/otp-exchange")
      .send({ code: raw })
      .expect(200);
    const me = await request(app)
      .get("/api/v1/me")
      .auth(exchanged.body.data.access_token, { type: "bearer" })
      .expect(200);
    expect(me.body.data.tenant.id).toBe(alpha.tenantId);
    await request(app)
      .post("/api/v1/auth/otp-exchange")
      .send({ code: raw })
      .expect(400);
  });
  it("retains encrypted outbox jobs after provider failure and retries delivery", async () => {
    const user = staff.get("LAB")!.user;
    await identity.recovery("alpha", user.login);
    const before = await db
      .outbox(alpha.tenantId)
      .find({ recipient: user.login, status: "PENDING" });
    expect(before.length).toBeGreaterThan(0);
    expect(before[0]!.encryptedBody).not.toContain("/recover");
    await deliverOutbox(db, config, {
      send: async () => {
        throw new Error("Provider unavailable");
      },
    });
    expect(
      (
        await db
          .outbox(alpha.tenantId)
          .find({ recipient: user.login, status: "PENDING" })
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("security review regressions", () => {
  it("deduplicates simultaneous retries of one registration", async () => {
    const subdomain = "same-key-race",
      email = "same-key@test.test",
      grant = await contact(email, subdomain),
      key = randomUUID();
    const body = {
      facility: {
        name: "Same key clinic",
        type: "CLINIC",
        subdomain,
        capacity: 2,
      },
      owner: { name: "Retry Owner", email, password },
      ...grant,
    };
    const responses = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post("/api/v1/onboarding/register")
          .set("Idempotency-Key", key)
          .send(body),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0]!.body.data.tenant.id).toBe(
      responses[1]!.body.data.tenant.id,
    );
  });
  it("does not allow same-role invitation requests to invalidate an owner-approved invitation", async () => {
    const login = "protected-invite@test.test";
    await request(app)
      .post("/api/v1/staff/invitations")
      .auth(alpha.access, { type: "bearer" })
      .send({ login, role: "OWNER" })
      .expect(201);
    await request(app)
      .post("/api/v1/staff/invitations")
      .auth(staff.get("PHARMACIST")!.access, { type: "bearer" })
      .send({ login, role: "PHARMACIST" })
      .expect(409);
    const c = await db
      .challenges(alpha.tenantId)
      .findOne({ login, purpose: "INVITE", consumedAt: null });
    expect(c!.role).toBe("OWNER");
    expect(c!.approved).toBe(true);
  });
  it("leaves one valid recovery grant when requests race", async () => {
    const u = staff.get("DOCTOR")!.user;
    await Promise.all([
      identity.recovery("alpha", u.login),
      identity.recovery("alpha", u.login),
    ]);
    const grants = await db
      .challenges(alpha.tenantId)
      .find({ userId: u._id, purpose: "RECOVERY", consumedAt: null });
    expect(grants).toHaveLength(1);
  });
  it("serializes concurrent owner demotions so the facility retains an active owner", async () => {
    const t = await fixture("owner-race");
    const secret = newSecret(),
      recoveryCode = token();
    const u = await db.users(t.tenantId).create({
      name: "Second Owner",
      login: "second-owner@race.test",
      role: "OWNER",
      passwordHash: await passwordHash(password),
      contactVerified: true,
      mfaEnabled: true,
      mfaSecret: seal(secret, config.encryptionKey),
      recoveryHashes: [digest(recoveryCode)],
    });
    const session = await identity.session(u);
    const responses = await Promise.all([
      request(app)
        .patch(`/api/v1/staff/${t.ownerId}`)
        .auth(t.access, { type: "bearer" })
        .send({ role: "DOCTOR", mfa_proof: freshProof(t) }),
      request(app)
        .patch(`/api/v1/staff/${u._id}`)
        .auth(session.access_token, { type: "bearer" })
        .send({ role: "DOCTOR", mfa_proof: recoveryCode }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.users(t.tenantId).find({ role: "OWNER", status: "ACTIVE" }),
    ).toHaveLength(1);
  });
  it("expires verified onboarding grants before any tenant creation", async () => {
    const subdomain = "expired-grant",
      email = "expired-grant@test.test",
      grant = await contact(email, subdomain);
    await db.connection
      .collection("bootstraps")
      .updateOne(
        { grantHash: digest(grant.verification_grant) },
        { $set: { expiresAt: new Date(Date.now() - 1) } },
      );
    await expect(
      identity.register(
        {
          facility: {
            name: "Expired Clinic",
            type: "CLINIC",
            subdomain,
            capacity: 1,
          },
          owner: { name: "Owner", email, password },
          ...grant,
        },
        "test",
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONTACT_UNVERIFIED" });
    expect(await db.resolveSubdomain(subdomain)).toBeNull();
  });
  it("clears a restricted enrollment session without granting business access", async () => {
    const grant = await contact("limited-logout@test.test", "limited-logout");
    const r = await identity.register(
      {
        facility: {
          name: "Limited Clinic",
          type: "CLINIC",
          subdomain: "limited-logout",
          capacity: 1,
        },
        owner: { name: "Owner", email: "limited-logout@test.test", password },
        ...grant,
      },
      "test",
      randomUUID(),
    );
    await request(app)
      .post("/api/v1/auth/logout")
      .auth(r.access_token, { type: "bearer" })
      .send({})
      .expect(204);
  });
});

describe("request envelope and payload protection", () => {
  it("assigns correlation IDs to invalid JSON and rejects oversized payloads", async () => {
    const invalid = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{invalid json")
      .expect(400);
    expect(invalid.body.meta.request_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(invalid.headers["cache-control"]).toBe("no-store");
    const large = await request(app)
      .post("/api/v1/auth/login")
      .send({ login: "x".repeat(40000) })
      .expect(413);
    expect(large.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(large.body.meta.request_id).toBeTruthy();
  });
});
