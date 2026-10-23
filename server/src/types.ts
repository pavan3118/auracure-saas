export const roles = [
  "OWNER",
  "DOCTOR",
  "RECEPTIONIST",
  "PHARMACIST",
  "LAB",
  "PATIENT",
] as const;
export type Role = (typeof roles)[number];
export type Purpose =
  | "access"
  | "mfa-enroll"
  | "mfa-challenge"
  | "password-change";
export interface Principal {
  userId: string;
  tenantId: string;
  role: Role;
  purpose: Purpose;
  version: number;
  sessionId?: string;
}
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
export function check(
  condition: unknown,
  status: number,
  code: string,
  message?: string,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
