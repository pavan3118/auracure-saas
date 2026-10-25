import { z } from "zod";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value <= new Date().toISOString().slice(0, 10)
    );
  }, "Use a valid date of birth that is not in the future.");
export const contact = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("EMAIL"),
      value: z
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
    })
    .strict(),
  z
    .object({
      type: z.literal("MOBILE"),
      value: z
        .string()
        .regex(
          /^\+[1-9]\d{7,14}$/,
          "Use an international mobile number including + and country code.",
        ),
    })
    .strict(),
]);
export const patientInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    contact,
    date_of_birth: date.optional(),
  })
  .strict();
// Contact changes require a separate ownership-verification workflow, not a demographic edit.
export const patientPatch = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    date_of_birth: date.nullable().optional(),
    expected_version: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (v) => v.name !== undefined || v.date_of_birth !== undefined,
    "No changes supplied.",
  );
const observation = z.discriminatedUnion("code", [
  z
    .object({
      code: z.literal("TEMPERATURE"),
      value: z.number().finite(),
      unit: z.literal("°C"),
    })
    .strict(),
  z
    .object({
      code: z.literal("SYSTOLIC_BP"),
      value: z.number().finite().nonnegative(),
      unit: z.literal("mmHg"),
    })
    .strict(),
  z
    .object({
      code: z.literal("DIASTOLIC_BP"),
      value: z.number().finite().nonnegative(),
      unit: z.literal("mmHg"),
    })
    .strict(),
  z
    .object({
      code: z.literal("PULSE"),
      value: z.number().finite().nonnegative(),
      unit: z.literal("bpm"),
    })
    .strict(),
  z
    .object({
      code: z.literal("SPO2"),
      value: z.number().finite().min(0).max(100),
      unit: z.literal("%"),
    })
    .strict(),
  z
    .object({
      code: z.literal("WEIGHT"),
      value: z.number().finite().nonnegative(),
      unit: z.literal("kg"),
    })
    .strict(),
  z
    .object({
      code: z.literal("HEIGHT"),
      value: z.number().finite().nonnegative(),
      unit: z.literal("cm"),
    })
    .strict(),
]);
export const vitalsInput = z
  .object({ observations: z.array(observation).min(1).max(7) })
  .strict()
  .superRefine((data, ctx) => {
    const codes = data.observations.map((v) => v.code);
    if (new Set(codes).size !== codes.length)
      ctx.addIssue({
        code: "custom",
        message: "Record each vital once per entry.",
      });
    if (codes.includes("SYSTOLIC_BP") !== codes.includes("DIASTOLIC_BP"))
      ctx.addIssue({
        code: "custom",
        message: "Record systolic and diastolic pressure together.",
      });
  });
export const listPatients = z
  .object({
    q: z.string().trim().max(80).default(""),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const checkInInput = z
  .object({ patient_id: z.string().uuid() })
  .strict();
export const cancelInput = z
  .object({
    expected_version: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(240),
  })
  .strict();
export const cashInput = z
  .object({ opening_float: z.string().max(20), currency: z.literal("INR") })
  .strict();
export type PatientInput = z.infer<typeof patientInput>;
export type PatientPatch = z.infer<typeof patientPatch>;
export type VitalsInput = z.infer<typeof vitalsInput>;
