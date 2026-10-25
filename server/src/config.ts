import { readFile } from "node:fs/promises";
import { z } from "zod";
export interface Config {
  mongoUri: string;
  origin: string;
  port: number;
  production: boolean;
  privateKey: string;
  publicKey: string;
  encryptionKey: Buffer;
  pinPepper: Buffer;
  issuer: string;
  audience: string;
  mailDir: string;
  smtpUrl?: string;
  mailFrom: string;
  documentsDir?: string;
  sandboxWebhookSecret?: string;
  frontendDir?: string;
  prices?: {
    version: string;
    seatMinor: number;
    slabMinor: number;
    gbMinor: number;
  };
}
export async function loadConfig(): Promise<Config> {
  const e = z
    .object({
      MONGODB_URI: z.string().min(1),
      APP_ORIGIN: z.url(),
      PORT: z.coerce.number().int().min(1).default(3000),
      JWT_PRIVATE_KEY_FILE: z.string().min(1),
      JWT_PUBLIC_KEY_FILE: z.string().min(1),
      MFA_ENCRYPTION_KEY_FILE: z.string().min(1),
      PIN_PEPPER_FILE: z.string().min(1),
      JWT_ISSUER: z.string().default("auracare"),
      JWT_AUDIENCE: z.string().default("auracare-tenant"),
      MAIL_DIR: z.string().default(".local/mail"),
      SMTP_URL: z.string().optional(),
      MAIL_FROM: z.email().default("no-reply@auracare.local"),
    })
    .parse(process.env);
  const production = process.env.NODE_ENV === "production";
  if (production && (!e.SMTP_URL || !e.APP_ORIGIN.startsWith("https://")))
    throw new Error("Production requires SMTP_URL and HTTPS APP_ORIGIN");
  const encryptionKey = await readFile(e.MFA_ENCRYPTION_KEY_FILE);
  if (encryptionKey.length !== 32) throw new Error("MFA key must be 32 bytes");
  const pinPepper = await readFile(e.PIN_PEPPER_FILE);
  if (pinPepper.length !== 32) throw new Error("PIN pepper must be 32 bytes");
  return {
    pinPepper,
    mongoUri: e.MONGODB_URI,
    origin: e.APP_ORIGIN,
    port: e.PORT,
    production,
    privateKey: await readFile(e.JWT_PRIVATE_KEY_FILE, "utf8"),
    publicKey: await readFile(e.JWT_PUBLIC_KEY_FILE, "utf8"),
    encryptionKey,
    issuer: e.JWT_ISSUER,
    audience: e.JWT_AUDIENCE,
    mailDir: e.MAIL_DIR,
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM,
    documentsDir: process.env.DOCUMENTS_DIR || ".local/documents",
    frontendDir: process.env.FRONTEND_DIR,
    sandboxWebhookSecret: production
      ? undefined
      : process.env.SANDBOX_WEBHOOK_SECRET,
    prices:
      process.env.RATE_VERSION &&
      ["RATE_SEAT_MINOR", "RATE_SLAB_MINOR", "RATE_GB_MINOR"].every(
        (k) =>
          /^(0|[1-9]\d*)$/.test(process.env[k] ?? "") &&
          Number.isSafeInteger(Number(process.env[k])),
      )
        ? {
            version: process.env.RATE_VERSION,
            seatMinor: Number(process.env.RATE_SEAT_MINOR),
            slabMinor: Number(process.env.RATE_SLAB_MINOR),
            gbMinor: Number(process.env.RATE_GB_MINOR),
          }
        : undefined,
  };
}
