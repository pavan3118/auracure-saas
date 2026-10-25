import { z } from "zod";
export const version = z
  .object({ expected_version: z.number().int().nonnegative() })
  .strict();
export const collectInput = version
  .extend({ state: z.literal("COLLECTED") })
  .strict();
const observation = z
  .object({
    name: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(240),
    unit: z.string().trim().max(100).default(""),
    reference_interval: z.string().trim().max(240).default(""),
    comments: z.string().trim().max(1000).default(""),
  })
  .strict();
export const resultInput = z
  .object({
    observations: z.array(observation).min(1).max(50),
    comments: z.string().trim().max(4000).default(""),
    correction_reason: z.string().trim().max(500).default(""),
  })
  .strict();
export const resultPatch = resultInput
  .omit({ correction_reason: true })
  .extend({ expected_version: z.number().int().nonnegative() })
  .strict();
export const signInput = version
  .extend({ signoff_pin: z.string().regex(/^\d{6}$/) })
  .strict();
export const verifyInput = version
  .extend({ password: z.string().min(1).max(1024) })
  .strict();
