import type { Observation } from "./reception-api";
export interface DoctorVisit {
  id: string;
  patient_id: string;
  state: "QUEUED" | "IN_CONSULTATION" | "COMPLETED" | "CANCELLED";
  queue_number: number;
  queued_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  version: number;
}
export interface Consultation {
  id: string;
  complaint: string;
  assessment: string;
  plan: string;
  version: number;
  state: "DRAFT" | "FINAL";
  finalized_at: string | null;
}
export interface Medicine {
  medicine: string;
  strength: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity?: number;
  instructions?: string;
}
export interface Prescription {
  id: string;
  visit_id: string;
  patient_id: string;
  revision: number;
  state: "DRAFT" | "SIGNED" | "DISCARDED";
  items: Medicine[];
  notes: string;
  version: number;
  lease_expires_at: string | null;
  lease_owned: boolean;
  signed_at: string | null;
  signed_by: string;
  content_hash: string;
  source_id: string | null;
  revision_reason: string;
  discard_reason?: string;
}
export interface DoctorDetail {
  visit: DoctorVisit;
  patient: {
    id: string;
    name: string;
    date_of_birth: string | null;
    contact: { type: string; value: string };
  };
  consultation: Consultation | null;
  prescriptions: Prescription[];
  vitals: { id: string; observations: Observation[]; recorded_at: string }[];
  lab_orders: {
    id: string;
    tests: { name: string; instructions?: string }[];
    state: string;
  }[];
  service_orders: {
    id: string;
    name: string;
    instructions: string;
    state: string;
  }[];
  amendments: {
    id: string;
    complaint: string;
    assessment: string;
    plan: string;
    reason: string;
    recorded_at: string;
  }[];
}
export interface DoctorWorkspace {
  active: DoctorDetail | null;
  queued_count: number;
}
