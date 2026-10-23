import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from "jose";
import * as OTPAuth from "otpauth";
import { z } from "zod";
import type { Config } from "./config.js";
import { roles, type Principal } from "./types.js";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export function seal(text: string, key: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const b = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), b]).toString("base64url");
}
export function open(text: string, key: Buffer) {
  const b = Buffer.from(text, "base64url");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
export const makeTotp = (secret: string, label: string) =>
  new OTPAuth.TOTP({
    issuer: "AuraCare",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
export const newSecret = () => new OTPAuth.Secret({ size: 20 }).base32;
export function totpStep(secret: string, proof: string) {
  if (!/^\d{6}$/.test(proof)) return null;
  const delta = makeTotp(secret, "").validate({ token: proof, window: 1 });
  return delta === null ? null : Math.floor(Date.now() / 30000) + delta;
}
const claims = z.object({
  sub: z.string(),
  tenant_id: z.string(),
  role: z.enum(roles),
  purpose: z.enum(["access", "mfa-enroll", "mfa-challenge", "password-change"]),
  version: z.number().int(),
  sid: z.string().optional(),
});
export async function signer(config: Config) {
  const privateKey = await importPKCS8(config.privateKey, "RS256"),
    publicKey = await importSPKI(config.publicKey, "RS256");
  return {
    issue: async (p: Principal) =>
      new SignJWT({
        tenant_id: p.tenantId,
        role: p.role,
        purpose: p.purpose,
        version: p.version,
        ...(p.sessionId ? { sid: p.sessionId } : {}),
      })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setSubject(p.userId)
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setIssuedAt()
        .setExpirationTime(p.purpose === "access" ? "15m" : "5m")
        .sign(privateKey),
    verify: async (t: string): Promise<Principal> => {
      const { payload } = await jwtVerify(t, publicKey, {
        algorithms: ["RS256"],
        issuer: config.issuer,
        audience: config.audience,
      });
      const c = claims.parse(payload);
      return {
        userId: c.sub,
        tenantId: c.tenant_id,
        role: c.role,
        purpose: c.purpose,
        version: c.version,
        ...(c.sid ? { sessionId: c.sid } : {}),
      };
    },
  };
}
