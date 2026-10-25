export interface Patient {
  id: string;
  name: string;
  version: number;
  contact?: { type: "EMAIL" | "MOBILE"; value: string };
  date_of_birth?: string | null;
  portal_status?: string;
}
export interface PatientPage {
  items: Patient[];
  next_cursor: string | null;
}
export interface Visit {
  id: string;
  patient_id: string;
  patient_name?: string;
  state: "QUEUED" | "IN_CONSULTATION" | "CANCELLED" | "COMPLETED";
  queue_number: number;
  queued_at: string;
  version: number;
}
export interface Queue {
  items: Visit[];
  queued_count: number;
  in_consultation_count: number;
  limit: number;
}
export interface CashFloat {
  id: string;
  receptionist_id: string;
  opening_float_minor: number;
  currency: "INR";
  state: "OPEN" | "CLOSED" | "REVIEWED";
  version: number;
  expected_cash_minor: number;
  counted_cash_minor: number | null;
  variance_minor: number | null;
  variance_reason: string;
  review_note: string;
  opened_at: string;
  reconciliation_available: boolean;
}
export interface Observation {
  code: string;
  value: number;
  unit: string;
}
export interface VitalsEntry {
  id: string;
  visit_id: string;
  observations: Observation[];
  recorded_at: string;
}
export const vitalFields = [
  { code: "TEMPERATURE", label: "Temperature", unit: "°C" },
  { code: "SYSTOLIC_BP", label: "Systolic pressure", unit: "mmHg" },
  { code: "DIASTOLIC_BP", label: "Diastolic pressure", unit: "mmHg" },
  { code: "PULSE", label: "Pulse", unit: "bpm" },
  { code: "SPO2", label: "SpO₂", unit: "%" },
  { code: "WEIGHT", label: "Weight", unit: "kg" },
  { code: "HEIGHT", label: "Height", unit: "cm" },
] as const;
