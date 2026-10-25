import { createHmac, timingSafeEqual } from "node:crypto";
import { check } from "../../types.js";
export interface MessagingProvider {
  send(input: {
    reference: string;
    channel: "SMS" | "WHATSAPP";
    recipient: string;
    body: string;
  }): Promise<{ reference: string; state: "ACCEPTED" }>;
}
export interface BillingProvider {
  preview(input: {
    reference: string;
    amountMinor: number;
    currency: "INR";
  }): Promise<{ reference: string; state: "PREVIEW" }>;
}
/** Deterministic local fixtures only. No vendor network calls or delivery claims. */
export const sandboxMessaging: MessagingProvider = {
  send: async (i) => ({ reference: i.reference, state: "ACCEPTED" }),
};
export const sandboxBilling: BillingProvider = {
  preview: async (i) => ({ reference: i.reference, state: "PREVIEW" }),
};
export function verifySandboxCallback(
  secret: string | undefined,
  header: string | undefined,
  raw: Buffer,
  now = Date.now(),
) {
  check(secret && secret.length >= 32, 503, "PROVIDER_UNAVAILABLE");
  check(header, 401, "SIGNATURE_INVALID");
  const parts = /^t=(\d{10}),v1=([a-f0-9]{64})$/.exec(header);
  check(parts, 401, "SIGNATURE_INVALID");
  check(
    Math.abs(now / 1000 - Number(parts[1])) <= 300,
    401,
    "SIGNATURE_EXPIRED",
  );
  const expected = createHmac("sha256", secret)
    .update(`${parts[1]}.`)
    .update(raw)
    .digest();
  check(
    timingSafeEqual(expected, Buffer.from(parts[2]!, "hex")),
    401,
    "SIGNATURE_INVALID",
  );
}
