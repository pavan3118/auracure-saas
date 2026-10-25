import { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import type { Row } from "../../db.js";
export interface Note extends Row {
  visitId: string;
  patientId: string;
  doctorId: string;
  complaint: string;
  assessment: string;
  plan: string;
  version: number;
  state: "DRAFT" | "FINAL";
  finalizedAt: Date | null;
}
export interface Amendment extends Row {
  visitId: string;
  noteId: string;
  doctorId: string;
  complaint: string;
  assessment: string;
  plan: string;
  reason: string;
  operationKey: string;
}
export interface PrescriptionItem {
  medicine: string;
  strength: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity?: number;
  instructions?: string;
}
export interface Prescription extends Row {
  visitId: string;
  patientId: string;
  authorId: string;
  revision: number;
  state: "DRAFT" | "SIGNED" | "DISCARDED";
  items: PrescriptionItem[];
  notes: string;
  version: number;
  leaseUserId: string;
  leaseSessionId: string;
  leaseExpiresAt: Date | null;
  signedAt: Date | null;
  signedBy: string;
  contentHash: string;
  sourceId: string;
  revisionReason: string;
  discardReason: string;
  operationKey: string;
}
export interface LabOrder extends Row {
  visitId: string;
  patientId: string;
  doctorId: string;
  tests: { name: string; instructions?: string }[];
  state: "ORDERED";
  operationKey: string;
}
export interface ServiceOrder extends Row {
  visitId: string;
  patientId: string;
  doctorId: string;
  name: string;
  instructions: string;
  state: "ORDERED";
  operationKey: string;
}
export interface UsageEvent extends Row {
  meter: "COMPLETED_CONSULTATION";
  sourceId: string;
  quantity: number;
  unit: "encounter";
  effectiveAt: Date;
}
const base = {
  _id: { type: String, default: randomUUID },
  tenant_id: { type: String, required: true, index: true },
};
const make = (fields: Record<string, unknown>) =>
  new Schema({ ...base, ...fields }, { strict: "throw", timestamps: true });
export const noteSchema = make({
  visitId: { type: String, required: true },
  patientId: { type: String, required: true },
  doctorId: { type: String, required: true },
  complaint: { type: String, default: "" },
  assessment: { type: String, default: "" },
  plan: { type: String, default: "" },
  version: { type: Number, default: 0 },
  state: { type: String, enum: ["DRAFT", "FINAL"], default: "DRAFT" },
  finalizedAt: { type: Date, default: null },
});
noteSchema.index({ tenant_id: 1, visitId: 1 }, { unique: true });
export const amendmentSchema = make({
  visitId: String,
  noteId: String,
  doctorId: String,
  complaint: String,
  assessment: String,
  plan: String,
  reason: String,
  operationKey: { type: String, required: true },
});
amendmentSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
amendmentSchema.index({ tenant_id: 1, visitId: 1, createdAt: 1 });
const item = new Schema(
  {
    medicine: { type: String, required: true },
    strength: { type: String, required: true },
    dose: { type: String, required: true },
    route: { type: String, required: true },
    frequency: { type: String, required: true },
    duration: { type: String, required: true },
    quantity: { type: Number, min: 1 },
    instructions: String,
  },
  { _id: false, strict: "throw" },
);
export const prescriptionSchema = make({
  visitId: { type: String, required: true },
  patientId: { type: String, required: true },
  authorId: { type: String, required: true },
  revision: { type: Number, required: true },
  state: {
    type: String,
    enum: ["DRAFT", "SIGNED", "DISCARDED"],
    default: "DRAFT",
  },
  items: { type: [item], default: [] },
  notes: { type: String, default: "" },
  version: { type: Number, default: 0 },
  leaseUserId: { type: String, default: "" },
  leaseSessionId: { type: String, default: "" },
  leaseExpiresAt: { type: Date, default: null },
  signedAt: { type: Date, default: null },
  signedBy: { type: String, default: "" },
  contentHash: { type: String, default: "" },
  sourceId: { type: String, default: "" },
  revisionReason: { type: String, default: "" },
  discardReason: { type: String, default: "" },
  operationKey: { type: String, required: true },
});
prescriptionSchema.index(
  { tenant_id: 1, visitId: 1, revision: 1 },
  { unique: true },
);
prescriptionSchema.index(
  { tenant_id: 1, visitId: 1 },
  { unique: true, partialFilterExpression: { state: "DRAFT" } },
);
prescriptionSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
prescriptionSchema.index({ tenant_id: 1, patientId: 1, state: 1 });
export const labOrderSchema = make({
  visitId: String,
  patientId: String,
  doctorId: String,
  tests: {
    type: [
      new Schema(
        { name: { type: String, required: true }, instructions: String },
        { _id: false, strict: "throw" },
      ),
    ],
    required: true,
  },
  state: { type: String, enum: ["ORDERED"], default: "ORDERED" },
  operationKey: { type: String, required: true },
});
labOrderSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
labOrderSchema.index({ tenant_id: 1, visitId: 1 });
export const serviceOrderSchema = make({
  visitId: String,
  patientId: String,
  doctorId: String,
  name: { type: String, required: true },
  instructions: { type: String, default: "" },
  state: { type: String, enum: ["ORDERED"], default: "ORDERED" },
  operationKey: { type: String, required: true },
});
serviceOrderSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
serviceOrderSchema.index({ tenant_id: 1, visitId: 1 });
export const usageSchema = make({
  meter: { type: String, enum: ["COMPLETED_CONSULTATION"], required: true },
  sourceId: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, max: 1 },
  unit: { type: String, enum: ["encounter"], required: true },
  effectiveAt: { type: Date, required: true },
});
usageSchema.index({ tenant_id: 1, meter: 1, sourceId: 1 }, { unique: true });
usageSchema.index({ tenant_id: 1, effectiveAt: 1 });
