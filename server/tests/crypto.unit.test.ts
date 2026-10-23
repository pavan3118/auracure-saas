import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { seal, open, signer, totpStep } from "../src/crypto.js";
import type { Config } from "../src/config.js";
let config: Config;
beforeAll(() => {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  config = {
    mongoUri: "mongodb://unused",
    origin: "http://localhost:5173",
    port: 3000,
    production: false,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    encryptionKey: randomBytes(32),
    pinPepper: randomBytes(32),
    issuer: "unit-issuer",
    audience: "unit-tenant",
    mailDir: ".local/unit-mail",
    mailFrom: "unit@test.test",
  };
});
afterEach(() => vi.useRealTimers());
describe("credential encryption and token trust boundaries", () => {
  it("encrypts with unique nonces and authenticates the full ciphertext", () => {
    const key = randomBytes(32),
      text = "private-totp-seed",
      a = seal(text, key),
      b = seal(text, key);
    expect(a).not.toBe(b);
    expect(a).not.toContain(text);
    expect(open(a, key)).toBe(text);
    const tampered = Buffer.from(a, "base64url");
    tampered[tampered.length - 1]! ^= 1;
    expect(() => open(tampered.toString("base64url"), key)).toThrow();
  });
  it("rejects the wrong encryption key and truncated encrypted data", () => {
    const key = randomBytes(32),
      cipher = seal("private-seed", key);
    expect(() => open(cipher, randomBytes(32))).toThrow();
    expect(() => open(cipher.slice(0, 10), key)).toThrow();
  });
  it("binds a valid token to its tenant, purpose, audience and issuer", async () => {
    const jwt = await signer(config);
    const p = {
      userId: "user",
      tenantId: "tenant",
      role: "OWNER" as const,
      purpose: "mfa-enroll" as const,
      version: 0,
    };
    const raw = await jwt.issue(p);
    expect(await jwt.verify(raw)).toEqual(p);
    await expect(
      (await signer({ ...config, audience: "platform" })).verify(raw),
    ).rejects.toThrow();
    await expect(
      (await signer({ ...config, issuer: "attacker" })).verify(raw),
    ).rejects.toThrow();
  });
  it("rejects HMAC algorithm confusion even if the public key is used as a signing secret", async () => {
    const raw = await new SignJWT({
      tenant_id: "tenant",
      role: "OWNER",
      purpose: "access",
      version: 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user")
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(config.publicKey));
    await expect((await signer(config)).verify(raw)).rejects.toThrow();
  });
  it("rejects expired enrollment tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const jwt = await signer(config),
      raw = await jwt.issue({
        userId: "u",
        tenantId: "t",
        role: "OWNER",
        purpose: "mfa-enroll",
        version: 0,
      });
    vi.setSystemTime(new Date("2026-01-01T00:05:01Z"));
    await expect(jwt.verify(raw)).rejects.toThrow();
  });
  it("validates a known TOTP vector and rejects expired or malformed codes", () => {
    vi.useFakeTimers();
    const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    vi.setSystemTime(new Date(59000));
    expect(totpStep(seed, "287082")).toBe(1);
    expect(totpStep(seed, "not-a-code")).toBeNull();
    vi.setSystemTime(new Date(240000));
    expect(totpStep(seed, "287082")).toBeNull();
  });
});
