import { z } from "zod";
const text = z.string().trim().max(4000);
export const noteInput = z
  .object({
    complaint: text,
    assessment: text,
    plan: text.default(""),
    expected_version: z.number().int().nonnegative(),
  })
  .strict();
export const prescriptionItem = z
  .object({
    medicine: z.string().trim().min(1).max(160),
    strength: z.string().trim().min(1).max(100),
    dose: z.string().trim().min(1).max(100),
    route: z.string().trim().min(1).max(100),
    frequency: z.string().trim().min(1).max(160),
    duration: z.string().trim().min(1).max(160),
    quantity: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    instructions: z.string().trim().max(1000).optional(),
  })
  .strict();
export const prescriptionInput = z
  .object({
    expected_version: z.number().int().nonnegative(),
    items: z.array(prescriptionItem).max(20),
    notes: text.default(""),
  })
  .strict();
export const versionInput = z
  .object({ expected_version: z.number().int().nonnegative() })
  .strict();
export const signInput = versionInput
  .extend({ password: z.string().min(1).max(1024) })
  .strict();
export const revisionInput = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
const test = z
  .object({
    name: z.string().trim().min(2).max(160),
    instructions: z.string().trim().max(1000).optional(),
  })
  .strict();
export const labInput = z
  .object({ visit_id: z.string().uuid(), tests: z.array(test).min(1).max(20) })
  .strict();
export const serviceInput = test;
export const amendmentInput = z
  .object({
    complaint: text.min(1),
    assessment: text.min(1),
    plan: text.default(""),
    reason: z.string().trim().min(3).max(500),
    password: z.string().min(1).max(1024),
  })
  .strict();
export const empty = z.object({}).strict();
export type NoteInput = z.infer<typeof noteInput>;
export type PrescriptionInput = z.infer<typeof prescriptionInput>;
