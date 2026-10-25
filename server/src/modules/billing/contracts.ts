import { z } from "zod";
const amount = z.string().min(1).max(20);
export const invoiceInput = z
  .object({
    patient_id: z.string().uuid(),
    lines: z
      .array(
        z
          .object({
            description: z.string().trim().min(2).max(240),
            quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            unit_price: amount,
            tax_percent: amount,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const invoicePatch = invoiceInput
  .omit({ patient_id: true })
  .extend({ expected_version: z.number().int().nonnegative() })
  .strict();
export const version = z
  .object({ expected_version: z.number().int().nonnegative() })
  .strict();
export const voidInput = version
  .extend({
    reason: z.string().trim().min(3).max(500),
    mfa_proof: z.string().min(1).max(1024),
  })
  .strict();
export const paymentInput = z
  .object({
    amount,
    method: z.enum(["CASH", "UPI", "CARD"]),
    external_reference: z.string().trim().max(160).default(""),
  })
  .strict()
  .refine(
    (v) =>
      v.method === "CASH"
        ? v.external_reference === ""
        : v.external_reference.length >= 3,
    "Noncash receipts need a transaction reference; cash receipts must not include one.",
  );
export const closeInput = version
  .extend({
    counted_cash: amount,
    variance_reason: z.string().trim().max(500).default(""),
  })
  .strict();
export const reviewInput = version
  .extend({
    review_note: z.string().trim().min(3).max(500),
    mfa_proof: z.string().min(1).max(1024),
  })
  .strict();
