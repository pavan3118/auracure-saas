import bcrypt from "bcryptjs";
import type { ClientSession } from "mongoose";
import type { Identity } from "../../auth.js";
import { check, type Principal } from "../../types.js";
export class Proofs {
  constructor(private identity: Identity) {}
  async verify(
    p: Principal,
    proof: string,
    kind: "password" | "pin",
    requestId: string,
  ) {
    const db = this.identity.db,
      key = `phase4-proof:${p.tenantId}:${p.userId}:${kind}`;
    await db.checkLimit(key, 5, 15 * 60000);
    const u = await db.users(p.tenantId).findOne({
      _id: p.userId,
      status: "ACTIVE",
      role: p.role,
      credentialVersion: p.version,
    });
    const hash = kind === "pin" ? u?.signoffPinHash : u?.passwordHash;
    const value = kind === "pin" ? this.identity.pinValue(proof) : proof;
    if (
      !u ||
      !hash ||
      (kind === "password" && Buffer.byteLength(proof) > 72) ||
      !(await bcrypt.compare(value, hash))
    ) {
      await db.limit(key, 5, 15 * 60000);
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "SENSITIVE_PROOF_FAILED",
        p.userId,
        requestId,
        undefined,
        "DENIED",
      );
      check(
        false,
        401,
        "AUTH_INVALID",
        "Current credential verification failed.",
      );
    }
    return async (s: ClientSession) => {
      check(
        await db.users(p.tenantId).update(
          {
            _id: p.userId,
            status: "ACTIVE",
            role: p.role,
            credentialVersion: p.version,
            ...(kind === "pin"
              ? { signoffPinHash: hash }
              : { passwordHash: hash }),
          },
          { $inc: { challengeVersion: 1 } },
          s,
        ),
        401,
        "AUTH_INVALID",
      );
    };
  }
  async owner(p: Principal, proof: string, s: ClientSession) {
    check(p.role === "OWNER", 403, "FORBIDDEN");
    const u = await this.identity.db.users(p.tenantId).findOne(
      {
        _id: p.userId,
        role: "OWNER",
        status: "ACTIVE",
        credentialVersion: p.version,
      },
      s,
    );
    check(u && u.mfaEnabled, 403, "MFA_REQUIRED");
    await this.identity.consumeMfa(u, proof, s);
  }
}
