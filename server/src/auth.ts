import { createHmac, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { ClientSession } from "mongoose";
import type { Config } from "./config.js";
import { type Database, type User } from "./db.js";
import {
  digest,
  token,
  signer,
  seal,
  open,
  newSecret,
  makeTotp,
  totpStep,
} from "./crypto.js";
import { queueMail, type Mailer } from "./mail.js";
import { check, type Principal, type Purpose, type Role } from "./types.js";
export const passwordHash = (p: string) => bcrypt.hash(p, 12);
export const publicUser = (u: User) => ({
  id: u._id,
  name: u.name,
  login: u.login,
  role: u.role,
  status: u.status,
  mfa_enabled: u.mfaEnabled,
  licence_status: u.licenceStatus,
});
export class Identity {
  private constructor(
    public db: Database,
    public config: Config,
    private mail: Mailer,
    private jwt: Awaited<ReturnType<typeof signer>>,
  ) {}
  static async create(db: Database, c: Config, m: Mailer) {
    return new Identity(db, c, m, await signer(c));
  }
  async audit(
    t: string,
    actor: string,
    action: string,
    resource: string,
    requestId: string,
    s?: ClientSession,
    outcome = "SUCCESS",
  ) {
    await this.db
      .audits(t)
      .create(
        { actorId: actor, action, resourceId: resource, outcome, requestId },
        s,
      );
  }
  private principal(u: User, purpose: Purpose, sessionId?: string): Principal {
    return {
      userId: u._id,
      tenantId: u.tenant_id,
      role: u.role,
      purpose,
      version: u.credentialVersion,
      ...(sessionId ? { sessionId } : {}),
    };
  }
  async authenticate(raw: string) {
    let p: Principal;
    try {
      p = await this.jwt.verify(raw);
    } catch {
      check(false, 401, "AUTH_INVALID");
    }
    const u = await this.db.users(p.tenantId).findOne({
      _id: p.userId,
      status: "ACTIVE",
      credentialVersion: p.version,
      role: p.role,
    });
    check(u, 401, "AUTH_INVALID");
    const tenant = await this.db
      .tenants(p.tenantId)
      .findOne({ _id: p.tenantId, status: "ACTIVE" });
    check(tenant, 401, "AUTH_INVALID");
    if (p.purpose === "access") {
      check(p.sessionId, 401, "AUTH_INVALID");
      const s = await this.db.sessions(p.tenantId).findOne({
        _id: p.sessionId,
        userId: p.userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      check(s, 401, "AUTH_INVALID");
      check(
        !u.mustChangePassword && (u.role !== "OWNER" || u.mfaEnabled),
        403,
        "MFA_REQUIRED",
      );
    }
    return { principal: p, user: u };
  }
  async contact(email: string, subdomain: string) {
    const proof = token();
    const c = await this.db.createBootstrap({
      email,
      subdomain,
      proofHash: digest(proof),
      grantHash: "",
      verified: false,
      attempts: 0,
      expiresAt: new Date(Date.now() + 15 * 60000),
      consumedAt: null,
    });
    await this.mail.send(
      email,
      "Verify your AuraCare contact",
      `Verification code: ${proof}\nExpires in 15 minutes. Only enter this code at AuraCare.`,
    );
    return { challenge_id: c._id };
  }
  async verifyContact(id: string, proof: string) {
    const c = await this.db.attemptBootstrap(id);
    check(
      c && !c.verified && c.proofHash === digest(proof),
      400,
      "CHALLENGE_INVALID",
    );
    const grant = token();
    const v = await this.db.verifyBootstrap(id, digest(grant));
    check(v, 400, "CHALLENGE_INVALID");
    return { verification_grant: grant };
  }
  async register(
    input: {
      facility: {
        name: string;
        type: string;
        subdomain: string;
        capacity: number;
      };
      owner: { name: string; email: string; password: string };
      verification_grant: string;
    },
    requestId: string,
    idempotencyKey: string,
  ) {
    const keyHash = digest(idempotencyKey),
      requestHash = digest(JSON.stringify(input));
    const replay = await this.db.registrationReplay(keyHash);
    if (replay) {
      check(
        replay.requestHash === requestHash,
        409,
        "CONFLICT",
        "Idempotency key was used for a different request.",
      );
      check(replay.tenantId && replay.ownerId, 409, "CONFLICT");
      const u = await this.db
        .users(replay.tenantId)
        .findOne({ _id: replay.ownerId, status: "ACTIVE", mfaEnabled: false });
      check(
        u,
        409,
        "CONFLICT",
        "Facility already registered. Sign in to continue.",
      );
      return {
        user: publicUser(u),
        tenant: {
          id: replay.tenantId,
          name: input.facility.name,
          subdomain: input.facility.subdomain,
        },
        purpose: "mfa-enroll",
        access_token: await this.jwt.issue(this.principal(u, "mfa-enroll")),
      };
    }
    const tenantId = randomUUID(),
      ownerId = randomUUID(),
      hash = await passwordHash(input.owner.password);
    const u = await this.db
      .transaction(async (s) => {
        const c = await this.db.consumeBootstrap(
          digest(input.verification_grant),
          input.owner.email,
          input.facility.subdomain,
          keyHash,
          requestHash,
          tenantId,
          ownerId,
          s,
        );
        check(c, 400, "CONTACT_UNVERIFIED");
        await this.db.tenants(tenantId).create(
          {
            _id: tenantId,
            name: input.facility.name,
            type: input.facility.type,
            subdomain: input.facility.subdomain,
            capacity: input.facility.capacity,
            status: "ACTIVE",
            ownerId,
          },
          s,
        );
        const user = await this.db.users(tenantId).create(
          {
            _id: ownerId,
            name: input.owner.name,
            login: input.owner.email,
            role: "OWNER",
            passwordHash: hash,
            contactVerified: true,
          },
          s,
        );
        await this.audit(
          tenantId,
          ownerId,
          "TENANT_REGISTERED",
          tenantId,
          requestId,
          s,
        );
        return user;
      })
      .catch(async (error) => {
        const prior = await this.db.registrationReplay(keyHash);
        if (
          prior?.requestHash === requestHash &&
          prior.tenantId &&
          prior.ownerId
        ) {
          const existing = await this.db.users(prior.tenantId).findOne({
            _id: prior.ownerId,
            status: "ACTIVE",
            mfaEnabled: false,
          });
          if (existing) return existing;
        }
        throw error;
      });
    return {
      user: publicUser(u),
      tenant: {
        id: u.tenant_id,
        name: input.facility.name,
        subdomain: input.facility.subdomain,
      },
      purpose: "mfa-enroll",
      access_token: await this.jwt.issue(this.principal(u, "mfa-enroll")),
    };
  }
  pinValue(pin: string) {
    return createHmac("sha256", this.config.pinPepper)
      .update(pin)
      .digest("hex");
  }
  async hashPin(pin: string) {
    return passwordHash(this.pinValue(pin));
  }
  async login(
    subdomain: string,
    login: string,
    password: string,
    requestId: string,
    portalPin = false,
  ) {
    const t = await this.db.resolveSubdomain(subdomain);
    const u = t
      ? await this.db.users(t._id).findOne({ login, status: "ACTIVE" })
      : null;
    // Perform a real hash comparison for unknown identities to reduce timing differences.
    const dummy =
      "$2b$12$Q1QJz9szG.bB7mQ3JR7SueV7G82gCaeSsIsWD5suE9/0xYe3cvvPu";
    const correctMode = u?.role === "PATIENT" ? portalPin : !portalPin;
    const hash = u ? (portalPin ? u.pinHash : u.passwordHash) : dummy;
    const ok = await bcrypt.compare(
      portalPin ? this.pinValue(password) : password,
      hash || dummy,
    );
    if (
      !u ||
      !ok ||
      !correctMode ||
      (u.role === "PATIENT" && !u.contactVerified)
    ) {
      if (t)
        await this.audit(
          t._id,
          u?._id ?? "unknown",
          "LOGIN_FAILED",
          u?._id ?? "unknown",
          requestId,
          undefined,
          "DENIED",
        );
      check(false, 401, "AUTH_INVALID", "Invalid credentials.");
    }
    await this.audit(u.tenant_id, u._id, "LOGIN_VERIFIED", u._id, requestId);
    if (u.mustChangePassword) return this.restricted(u, "password-change");
    if (u.role === "OWNER")
      return this.restricted(u, u.mfaEnabled ? "mfa-challenge" : "mfa-enroll");
    return this.session(u);
  }
  async restricted(u: User, purpose: Purpose) {
    return {
      user: publicUser(u),
      purpose,
      access_token: await this.jwt.issue(this.principal(u, purpose)),
    };
  }
  async session(u: User, family: string = randomUUID(), s?: ClientSession) {
    const refresh = token();
    const entry = await this.db.sessions(u.tenant_id).create(
      {
        userId: u._id,
        hash: digest(refresh),
        family,
        expiresAt: new Date(Date.now() + 7 * 86400000),
        revokedAt: null,
        credentialVersion: u.credentialVersion,
        used: false,
      },
      s,
    );
    return {
      user: publicUser(u),
      purpose: "access",
      access_token: await this.jwt.issue(
        this.principal(u, "access", entry._id),
      ),
      refresh,
    };
  }
  async enroll(p: Principal) {
    check(p.purpose === "mfa-enroll" && p.role === "OWNER", 403, "FORBIDDEN");
    const secret = newSecret();
    const u = await this.db.users(p.tenantId).update(
      { _id: p.userId, mfaEnabled: false, credentialVersion: p.version },
      {
        $set: {
          mfaSecret: seal(secret, this.config.encryptionKey),
          lastTotpStep: -1,
        },
      },
    );
    check(u, 409, "CONFLICT");
    return { secret, uri: makeTotp(secret, u.login).toString() };
  }
  async confirm(p: Principal, proof: string, requestId: string) {
    check(p.purpose === "mfa-enroll" && p.role === "OWNER", 403, "FORBIDDEN");
    const hashes = Array.from({ length: 10 }, () => token());
    const result = await this.db.transaction(async (s) => {
      const u = await this.db
        .users(p.tenantId)
        .findOne(
          { _id: p.userId, mfaEnabled: false, credentialVersion: p.version },
          s,
        );
      check(u && u.mfaSecret, 400, "CHALLENGE_INVALID");
      const step = totpStep(
        open(u.mfaSecret, this.config.encryptionKey),
        proof,
      );
      check(step !== null, 400, "CHALLENGE_INVALID");
      const next = await this.db.users(p.tenantId).update(
        { _id: u._id, mfaEnabled: false, credentialVersion: p.version },
        {
          $set: {
            mfaEnabled: true,
            lastTotpStep: step,
            recoveryHashes: hashes.map(digest),
          },
          $inc: { credentialVersion: 1 },
        },
        s,
      );
      check(next, 409, "CONFLICT");
      await this.audit(
        p.tenantId,
        p.userId,
        "MFA_ENROLLED",
        p.userId,
        requestId,
        s,
      );
      return this.session(next, randomUUID(), s);
    });
    return { ...result, recovery_codes: hashes };
  }
  async verifyMfa(p: Principal, proof: string, requestId: string) {
    check(
      p.purpose === "mfa-challenge" && p.role === "OWNER",
      403,
      "FORBIDDEN",
    );
    return this.db.transaction(async (s) => {
      const u = await this.db
        .users(p.tenantId)
        .findOne(
          { _id: p.userId, mfaEnabled: true, credentialVersion: p.version },
          s,
        );
      check(u, 401, "AUTH_INVALID");
      const next = await this.consumeMfa(u, proof, s);
      await this.audit(
        p.tenantId,
        p.userId,
        "MFA_VERIFIED",
        p.userId,
        requestId,
        s,
      );
      return this.session(next, randomUUID(), s);
    });
  }
  async consumeMfa(u: User, proof: string, s?: ClientSession) {
    const codeHash = digest(proof);
    if (u.recoveryHashes.includes(codeHash)) {
      const next = await this.db
        .users(u.tenant_id)
        .update(
          { _id: u._id, recoveryHashes: codeHash },
          { $pull: { recoveryHashes: codeHash } },
          s,
        );
      check(next, 401, "AUTH_INVALID");
      return next;
    }
    const step = totpStep(open(u.mfaSecret, this.config.encryptionKey), proof);
    check(
      step !== null && step > u.lastTotpStep,
      401,
      "AUTH_INVALID",
      "Invalid or already used authentication code.",
    );
    const next = await this.db
      .users(u.tenant_id)
      .update(
        { _id: u._id, lastTotpStep: { $lt: step } },
        { $set: { lastTotpStep: step } },
        s,
      );
    check(next, 401, "AUTH_INVALID");
    return next;
  }
  async refresh(raw: string) {
    const old = await this.db.resolveSession(digest(raw));
    check(old && old.expiresAt > new Date(), 401, "AUTH_INVALID");
    if (old.used || old.revokedAt) {
      await this.db
        .sessions(old.tenant_id)
        .updateMany(
          { family: old.family },
          { $set: { revokedAt: new Date() } },
        );
      check(false, 401, "AUTH_INVALID");
    }
    return this.db.transaction(async (s) => {
      const prev = await this.db
        .sessions(old.tenant_id)
        .update(
          { _id: old._id, used: false, revokedAt: null },
          { $set: { used: true } },
          s,
        );
      check(prev, 401, "AUTH_INVALID");
      const u = await this.db.users(old.tenant_id).findOne(
        {
          _id: old.userId,
          status: "ACTIVE",
          credentialVersion: old.credentialVersion,
        },
        s,
      );
      const t = await this.db
        .tenants(old.tenant_id)
        .findOne({ _id: old.tenant_id, status: "ACTIVE" }, s);
      check(
        u && t && !u.mustChangePassword && (u.role !== "OWNER" || u.mfaEnabled),
        401,
        "AUTH_INVALID",
      );
      return this.session(u, old.family, s);
    });
  }
  async logout(p: Principal) {
    if (p.sessionId) {
      const s = await this.db
        .sessions(p.tenantId)
        .findOne({ _id: p.sessionId });
      if (s)
        await this.db
          .sessions(p.tenantId)
          .updateMany(
            { family: s.family },
            { $set: { revokedAt: new Date() } },
          );
    }
  }
  async changePassword(
    p: Principal,
    current: string,
    nextPassword: string,
    requestId: string,
  ) {
    check(
      (p.purpose === "access" || p.purpose === "password-change") &&
        p.role !== "PATIENT",
      403,
      "FORBIDDEN",
    );
    const u = await this.db
      .users(p.tenantId)
      .findOne({ _id: p.userId, credentialVersion: p.version });
    check(
      u && (await bcrypt.compare(current, u.passwordHash)),
      401,
      "AUTH_INVALID",
    );
    const hash = await passwordHash(nextPassword);
    const next = await this.db.transaction(async (s) => {
      const next = await this.db.users(p.tenantId).update(
        { _id: u._id, credentialVersion: p.version },
        {
          $set: { passwordHash: hash, mustChangePassword: false },
          $inc: { credentialVersion: 1 },
        },
        s,
      );
      check(next, 409, "CONFLICT");
      await this.db
        .sessions(p.tenantId)
        .updateMany({ userId: u._id }, { $set: { revokedAt: new Date() } }, s);
      await this.audit(
        p.tenantId,
        p.userId,
        "PASSWORD_CHANGED",
        p.userId,
        requestId,
        s,
      );
      return next;
    });
    return next.role === "OWNER"
      ? this.restricted(next, next.mfaEnabled ? "mfa-challenge" : "mfa-enroll")
      : this.session(next);
  }
  async recovery(subdomain: string, login: string) {
    check(
      !this.config.production || login.includes("@"),
      503,
      "PROVIDER_UNAVAILABLE",
      "Mobile recovery delivery is not configured.",
    );
    const t = await this.db.resolveSubdomain(subdomain);
    const u = t
      ? await this.db
          .users(t._id)
          .findOne({ login, status: "ACTIVE", contactVerified: true })
      : null;
    if (!u) return;
    const raw = token();
    await this.db.transaction(async (s) => {
      await this.db
        .users(u.tenant_id)
        .update({ _id: u._id }, { $inc: { challengeVersion: 1 } }, s);
      await this.db
        .challenges(u.tenant_id)
        .updateMany(
          { userId: u._id, purpose: "RECOVERY", consumedAt: null },
          { $set: { consumedAt: new Date() } },
          s,
        );
      await this.db.challenges(u.tenant_id).create(
        {
          purpose: "RECOVERY",
          userId: u._id,
          login: u.login,
          role: u.role,
          hash: digest(raw),
          approved: true,
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
        s,
      );
      await queueMail(
        this.db,
        this.config,
        u.tenant_id,
        u.login,
        "Reset your AuraCare password",
        `Open ${this.config.origin}/recover?token=${raw}\nExpires in 15 minutes. This does not reset MFA.`,
        s,
      );
    });
  }
  async completeRecovery(
    raw: string,
    password: string,
    mfaProof: string | undefined,
    requestId: string,
  ) {
    const c = await this.db.resolveChallenge(digest(raw), "RECOVERY");
    check(c, 400, "CHALLENGE_INVALID");
    check(
      c.role === "PATIENT"
        ? /^\d{4}$/.test(password)
        : password.length >= 12 && Buffer.byteLength(password) <= 72,
      400,
      "VALIDATION_ERROR",
      "Patient recovery requires a four-digit portal PIN.",
    );
    const hash =
      c.role === "PATIENT"
        ? await this.hashPin(password)
        : await passwordHash(password);
    await this.db.transaction(async (s) => {
      const used = await this.db
        .challenges(c.tenant_id)
        .update(
          { _id: c._id, consumedAt: null, expiresAt: { $gt: new Date() } },
          { $set: { consumedAt: new Date() } },
          s,
        );
      check(used, 400, "CHALLENGE_INVALID");
      const u = await this.db
        .users(c.tenant_id)
        .findOne({ _id: c.userId, status: "ACTIVE" }, s);
      check(u, 400, "CHALLENGE_INVALID");
      if (u.role === "OWNER") {
        check(u.mfaEnabled && mfaProof, 403, "MFA_REQUIRED");
        await this.consumeMfa(u, mfaProof, s);
      }
      await this.db.users(c.tenant_id).update(
        { _id: u._id },
        {
          $set: {
            ...(u.role === "PATIENT"
              ? { pinHash: hash }
              : { passwordHash: hash }),
            mustChangePassword: false,
          },
          $inc: { credentialVersion: 1 },
        },
        s,
      );
      await this.db
        .sessions(c.tenant_id)
        .updateMany({ userId: u._id }, { $set: { revokedAt: new Date() } }, s);
      await this.db
        .challenges(c.tenant_id)
        .updateMany(
          { userId: u._id, consumedAt: null },
          { $set: { consumedAt: new Date() } },
          s,
        );
      await this.audit(
        c.tenant_id,
        u._id,
        "CREDENTIAL_RECOVERED",
        u._id,
        requestId,
        s,
      );
      await queueMail(
        this.db,
        this.config,
        c.tenant_id,
        u.login,
        "AuraCare password changed",
        "Your password was reset. Contact your facility if this was not you.",
        s,
      );
    });
  }
  async requestPatientActivation(subdomain: string, login: string) {
    check(
      !this.config.production || login.includes("@"),
      503,
      "PROVIDER_UNAVAILABLE",
      "Mobile delivery is not configured.",
    );
    const t = await this.db.resolveSubdomain(subdomain);
    const u = t
      ? await this.db.users(t._id).findOne({
          login,
          role: "PATIENT",
          status: "ACTIVE",
          contactVerified: false,
        })
      : null;
    if (!u || !(await this.db.patients(u.tenant_id).findOne({ userId: u._id })))
      return;
    const raw = token();
    await this.db.transaction(async (s) => {
      const current = await this.db.users(u.tenant_id).update(
        {
          _id: u._id,
          role: "PATIENT",
          status: "ACTIVE",
          contactVerified: false,
        },
        { $inc: { challengeVersion: 1 } },
        s,
      );
      if (!current) return;
      await this.db
        .challenges(u.tenant_id)
        .updateMany(
          { userId: u._id, purpose: "PATIENT_ACTIVATE", consumedAt: null },
          { $set: { consumedAt: new Date() } },
          s,
        );
      await this.db.challenges(u.tenant_id).create(
        {
          purpose: "PATIENT_ACTIVATE",
          userId: u._id,
          login: u.login,
          role: "PATIENT",
          hash: digest(raw),
          approved: true,
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
        s,
      );
      await queueMail(
        this.db,
        this.config,
        u.tenant_id,
        u.login,
        "Activate your AuraCare portal",
        `Open ${this.config.origin}/patient-activate?token=${raw}\nSingle use; expires in 15 minutes. Choose your own portal PIN.`,
        s,
      );
    });
  }
  async activatePatient(raw: string, pin: string, requestId: string) {
    check(/^\d{4}$/.test(pin), 400, "VALIDATION_ERROR");
    const c = await this.db.resolveChallenge(digest(raw), "PATIENT_ACTIVATE");
    check(c, 400, "CHALLENGE_INVALID");
    const hash = await this.hashPin(pin);
    await this.db.transaction(async (s) => {
      check(
        await this.db
          .tenants(c.tenant_id)
          .findOne({ _id: c.tenant_id, status: "ACTIVE" }, s),
        400,
        "CHALLENGE_INVALID",
      );
      check(
        await this.db.challenges(c.tenant_id).update(
          {
            _id: c._id,
            purpose: "PATIENT_ACTIVATE",
            consumedAt: null,
            expiresAt: { $gt: new Date() },
          },
          { $set: { consumedAt: new Date() } },
          s,
        ),
        400,
        "CHALLENGE_INVALID",
      );
      const u = await this.db.users(c.tenant_id).update(
        {
          _id: c.userId,
          role: "PATIENT",
          status: "ACTIVE",
          contactVerified: false,
          login: c.login,
        },
        {
          $set: { pinHash: hash, contactVerified: true },
          $inc: { credentialVersion: 1, challengeVersion: 1 },
        },
        s,
      );
      check(
        u &&
          (await this.db
            .patients(c.tenant_id)
            .findOne({ userId: c.userId }, s)),
        400,
        "CHALLENGE_INVALID",
      );
      await this.db
        .sessions(c.tenant_id)
        .updateMany(
          { userId: c.userId },
          { $set: { revokedAt: new Date() } },
          s,
        );
      await this.db
        .challenges(c.tenant_id)
        .updateMany(
          { userId: c.userId, consumedAt: null },
          { $set: { consumedAt: new Date() } },
          s,
        );
      await this.audit(
        c.tenant_id,
        c.userId,
        "PATIENT_PORTAL_ACTIVATED",
        c.userId,
        requestId,
        s,
      );
    });
  }
  async requestOtp(subdomain: string, contact: string) {
    check(
      !this.config.production,
      503,
      "PROVIDER_UNAVAILABLE",
      "WhatsApp delivery is not configured.",
    );
    const t = await this.db.resolveSubdomain(subdomain);
    const u = t
      ? await this.db.users(t._id).findOne({
          login: contact,
          role: "PATIENT",
          status: "ACTIVE",
          contactVerified: true,
        })
      : null;
    if (!u) return;
    const raw = token();
    await this.db.transaction(async (s) => {
      await this.db
        .users(u.tenant_id)
        .update({ _id: u._id }, { $inc: { challengeVersion: 1 } }, s);
      await this.db
        .challenges(u.tenant_id)
        .updateMany(
          { userId: u._id, purpose: "OTP", consumedAt: null },
          { $set: { consumedAt: new Date() } },
          s,
        );
      await this.db.challenges(u.tenant_id).create(
        {
          purpose: "OTP",
          userId: u._id,
          login: u.login,
          role: "PATIENT",
          hash: digest(raw),
          approved: true,
          expiresAt: new Date(Date.now() + 5 * 60000),
        },
        s,
      );
      await queueMail(
        this.db,
        this.config,
        u.tenant_id,
        u.login,
        "AuraCare patient sign-in",
        `Open ${this.config.origin}/patient-link?token=${raw}\nSingle use; expires in five minutes.`,
        s,
      );
    });
  }
  async exchangeOtp(raw: string) {
    const c = await this.db.resolveChallenge(digest(raw), "OTP");
    check(c, 400, "CHALLENGE_INVALID");
    return this.db.transaction(async (s) => {
      const used = await this.db.challenges(c.tenant_id).update(
        {
          _id: c._id,
          purpose: "OTP",
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { consumedAt: new Date() } },
        s,
      );
      check(used, 400, "CHALLENGE_INVALID");
      const u = await this.db.users(c.tenant_id).findOne(
        {
          _id: c.userId,
          role: "PATIENT",
          status: "ACTIVE",
          contactVerified: true,
        },
        s,
      );
      check(u, 401, "AUTH_INVALID");
      return this.session(u, randomUUID(), s);
    });
  }
  async invite(p: Principal, login: string, role: Role, requestId: string) {
    check(
      p.role === "OWNER" ||
        (p.role === "PHARMACIST" && role === "PHARMACIST") ||
        (p.role === "LAB" && role === "LAB"),
      403,
      "FORBIDDEN",
    );
    check(
      role !== "PATIENT",
      400,
      "VALIDATION_ERROR",
      "Patients are provisioned at check-in.",
    );
    const raw = token();
    return this.db.transaction(async (s) => {
      await this.db
        .tenants(p.tenantId)
        .update({ _id: p.tenantId }, { $inc: { governanceVersion: 1 } }, s);
      check(
        !(await this.db.users(p.tenantId).findOne({ login }, s)),
        409,
        "CONFLICT",
      );
      if (p.role !== "OWNER")
        check(
          !(await this.db.challenges(p.tenantId).findOne(
            {
              login,
              purpose: "INVITE",
              consumedAt: null,
              expiresAt: { $gt: new Date() },
            },
            s,
          )),
          409,
          "CONFLICT",
          "An invitation already exists.",
        );
      const approved = p.role === "OWNER";
      await this.db
        .challenges(p.tenantId)
        .updateMany(
          { login, purpose: "INVITE", consumedAt: null },
          { $set: { consumedAt: new Date() } },
          s,
        );
      const c = await this.db.challenges(p.tenantId).create(
        {
          purpose: "INVITE",
          login,
          role,
          hash: digest(raw),
          approved,
          invitedBy: p.userId,
          expiresAt: new Date(Date.now() + 86400000),
        },
        s,
      );
      if (approved)
        await queueMail(
          this.db,
          this.config,
          p.tenantId,
          login,
          "Join your AuraCare facility",
          `Open ${this.config.origin}/invite?token=${raw}\nExpires in 24 hours. Choose your own password.`,
          s,
        );
      await this.audit(
        p.tenantId,
        p.userId,
        approved ? "STAFF_INVITED" : "STAFF_INVITE_REQUESTED",
        c._id,
        requestId,
        s,
      );
      return { id: c._id, login, role, approved };
    });
  }
  async approveInvitation(p: Principal, id: string, requestId: string) {
    const raw = token();
    await this.db.transaction(async (s) => {
      const c = await this.db.challenges(p.tenantId).update(
        {
          _id: id,
          purpose: "INVITE",
          approved: false,
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            approved: true,
            hash: digest(raw),
            expiresAt: new Date(Date.now() + 86400000),
          },
        },
        s,
      );
      check(c, 404, "NOT_FOUND");
      await queueMail(
        this.db,
        this.config,
        p.tenantId,
        c.login,
        "Join your AuraCare facility",
        `Open ${this.config.origin}/invite?token=${raw}\nExpires in 24 hours.`,
        s,
      );
      await this.audit(
        p.tenantId,
        p.userId,
        "STAFF_INVITE_APPROVED",
        c._id,
        requestId,
        s,
      );
    });
  }
  async acceptInvite(
    raw: string,
    name: string,
    password: string,
    requestId: string,
    signoffPin?: string,
  ) {
    const c = await this.db.resolveChallenge(digest(raw), "INVITE");
    check(c, 400, "CHALLENGE_INVALID");
    check(
      c.role !== "LAB" || (signoffPin && /^\d{6}$/.test(signoffPin)),
      400,
      "VALIDATION_ERROR",
      "Laboratory staff require a six-digit sign-off PIN.",
    );
    const signoffPinHash = signoffPin ? await this.hashPin(signoffPin) : "";
    const hash = await passwordHash(password);
    const u = await this.db.transaction(async (s) => {
      const used = await this.db.challenges(c.tenant_id).update(
        {
          _id: c._id,
          approved: true,
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { consumedAt: new Date() } },
        s,
      );
      check(used, 400, "CHALLENGE_INVALID");
      const u = await this.db.users(c.tenant_id).create(
        {
          name,
          login: c.login,
          role: c.role,
          passwordHash: hash,
          signoffPinHash,
          contactVerified: true,
        },
        s,
      );
      await this.audit(
        c.tenant_id,
        u._id,
        "STAFF_INVITE_ACCEPTED",
        u._id,
        requestId,
        s,
      );
      return u;
    });
    return u.role === "OWNER"
      ? this.restricted(u, "mfa-enroll")
      : this.session(u);
  }
  async updateStaff(
    p: Principal,
    id: string,
    patch: { role?: Role; status?: "ACTIVE" | "DISABLED" },
    proof: string,
    requestId: string,
  ) {
    return this.db.transaction(async (s) => {
      const owner = await this.db
        .users(p.tenantId)
        .findOne(
          { _id: p.userId, status: "ACTIVE", credentialVersion: p.version },
          s,
        );
      check(owner && owner.role === "OWNER", 403, "FORBIDDEN");
      await this.consumeMfa(owner, proof, s);
      const u = await this.db.users(p.tenantId).findOne({ _id: id }, s);
      check(u && u.role !== "PATIENT", 404, "NOT_FOUND");
      check(patch.role !== "PATIENT", 400, "VALIDATION_ERROR");
      // Serialize governance changes through the tenant document to protect the final owner.
      await this.db
        .tenants(p.tenantId)
        .update({ _id: p.tenantId }, { $inc: { governanceVersion: 1 } }, s);
      if (
        u.role === "OWNER" &&
        ((patch.role && patch.role !== "OWNER") || patch.status === "DISABLED")
      ) {
        const another = await this.db
          .users(p.tenantId)
          .findOne({ _id: { $ne: id }, role: "OWNER", status: "ACTIVE" }, s);
        check(
          another,
          409,
          "CONFLICT",
          "The final active owner cannot be disabled or demoted.",
        );
      }
      const next = await this.db
        .users(p.tenantId)
        .update(
          { _id: id },
          { $set: { ...patch }, $inc: { credentialVersion: 1 } },
          s,
        );
      await this.db
        .sessions(p.tenantId)
        .updateMany({ userId: id }, { $set: { revokedAt: new Date() } }, s);
      await this.audit(p.tenantId, p.userId, "STAFF_UPDATED", id, requestId, s);
      check(next, 404, "NOT_FOUND");
      return publicUser(next);
    });
  }
  async verifyLicence(
    p: Principal,
    id: string,
    evidence: string,
    proof: string,
    requestId: string,
  ) {
    await this.db.transaction(async (s) => {
      const owner = await this.db
        .users(p.tenantId)
        .findOne({ _id: p.userId, role: "OWNER", status: "ACTIVE" }, s);
      check(owner, 403, "FORBIDDEN");
      await this.consumeMfa(owner, proof, s);
      const u = await this.db
        .users(p.tenantId)
        .update(
          { _id: id, role: "PHARMACIST" },
          { $set: { licenceStatus: "VERIFIED", licenceEvidence: evidence } },
          s,
        );
      check(u, 404, "NOT_FOUND");
      await this.audit(
        p.tenantId,
        p.userId,
        "LICENCE_VERIFIED",
        id,
        requestId,
        s,
      );
    });
  }
}
