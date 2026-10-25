import { z } from "zod";
export const product = z
  .object({
    medicine: z.string().trim().min(1).max(160),
    strength: z.string().trim().min(1).max(100),
    route: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(60),
  })
  .strict();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Use a valid expiry date.");
export const batchInput = product
  .extend({
    batch_number: z.string().trim().min(1).max(80),
    expiry_date: date,
    quantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const adjustmentInput = z
  .object({
    delta: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .refine((v) => v !== 0),
    reason: z.string().trim().min(3).max(500),
    expected_version: z.number().int().nonnegative(),
  })
  .strict();
export const substitutionInput = product
  .extend({
    line_index: z.number().int().min(0).max(19),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const approveInput = z
  .object({ password: z.string().min(1).max(1024) })
  .strict();
export const dispenseInput = z
  .object({
    line_units: z
      .array(
        z
          .object({
            line_index: z.number().int().min(0).max(19),
            unit: z.string().trim().min(1).max(60),
            substitution_id: z.string().uuid().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.line_units.map((l) => l.line_index)).size ===
      v.line_units.length,
    "Each prescription line must be allocated once.",
  );
