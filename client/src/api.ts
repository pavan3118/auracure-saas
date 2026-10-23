import axios from "axios";
export type Role =
  | "OWNER"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "PHARMACIST"
  | "LAB"
  | "PATIENT";
export interface User {
  id: string;
  name: string;
  login: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  mfa_enabled: boolean;
  licence_status: "PENDING" | "VERIFIED";
}
export interface AuthResult {
  user: User;
  purpose: "access" | "mfa-enroll" | "mfa-challenge" | "password-change";
  access_token: string;
  recovery_codes?: string[];
}
export interface Me {
  user: User;
  tenant: { id: string; name: string; subdomain: string; type: string };
}
export interface Invitation {
  id: string;
  login: string;
  role: Role;
  approved: boolean;
  expires_at: string;
}
export interface AuditEvent {
  id: string;
  action: string;
  resource_id: string;
  outcome: string;
  created_at: string;
}
const http = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  timeout: 20000,
});
let accessToken = "";
export function setToken(t: string) {
  accessToken = t;
}
export async function api<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  extra?: Record<string, string>,
): Promise<T> {
  const r = await http.request<{ data: T }>({
    method,
    url: path,
    data: body,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...extra,
    },
  });
  return r.data.data;
}
export function errorMessage(err: unknown) {
  if (axios.isAxiosError(err)) {
    const v = err.response?.data as
      | {
          error?: {
            message?: string;
            fields?: { path: string; message: string }[];
          };
        }
      | undefined;
    return (
      v?.error?.fields?.map((f) => `${f.path}: ${f.message}`).join(" · ") ||
      v?.error?.message ||
      "Could not reach the service. Please try again."
    );
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
