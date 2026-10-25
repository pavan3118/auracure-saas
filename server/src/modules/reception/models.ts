import { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import type { Row } from "../../db.js";
export interface Patient extends Row {
  name: string;
  searchName: string;
  contactType: "EMAIL" | "MOBILE";
  contactValue: string;
  dateOfBirth: string;
  userId: string;
  version: number;
}
export type VisitState =
  | "QUEUED"
  | "IN_CONSULTATION"
  | "COMPLETED"
  | "CANCELLED";
export interface Visit extends Row {
  patientId: string;
  doctorId: string;
  state: VisitState;
  queueNumber: number;
  queuedAt: Date;
  version: number;
  checkInKey: string;
  requestHash: string;
  claimedAt: Date | null;
  completedAt: Date | null;
  claimKey: string;
  completionKey: string;
  completionRequestHash: string;
  cancelledBy: string;
  cancellationReason: string;
}
export interface Observation {
  code:
    | "TEMPERATURE"
    | "SYSTOLIC_BP"
    | "DIASTOLIC_BP"
    | "PULSE"
    | "SPO2"
    | "WEIGHT"
    | "HEIGHT";
  value: number;
  unit: string;
}
export interface Vitals extends Row {
  visitId: string;
  patientId: string;
  observations: Observation[];
  recordedBy: string;
}
export interface CashSession extends Row {
  receptionistId: string;
  openingFloatMinor: number;
  currency: "INR";
  state: "OPEN";
  openedAt: Date;
  operationKey: string;
  requestHash: string;
}
const base = {
  _id: { type: String, default: randomUUID },
  tenant_id: { type: String, required: true, index: true },
};
const make = (fields: Record<string, unknown>) =>
  new Schema({ ...base, ...fields }, { strict: "throw", timestamps: true });
export const patientSchema = make({
  name: { type: String, required: true },
  searchName: { type: String, required: true },
  contactType: { type: String, enum: ["EMAIL", "MOBILE"], required: true },
  contactValue: { type: String, required: true },
  dateOfBirth: { type: String, default: "" },
  userId: { type: String, default: "" },
  version: { type: Number, default: 0 },
});
patientSchema.index({ tenant_id: 1, contactValue: 1 }, { unique: true });
patientSchema.index(
  { tenant_id: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $gt: "" } } },
);
patientSchema.index({ tenant_id: 1, searchName: 1 });
export const visitSchema = make({
  patientId: { type: String, required: true },
  doctorId: { type: String, default: "" },
  state: {
    type: String,
    enum: ["QUEUED", "IN_CONSULTATION", "COMPLETED", "CANCELLED"],
    default: "QUEUED",
  },
  queueNumber: { type: Number, required: true },
  queuedAt: { type: Date, default: Date.now },
  version: { type: Number, default: 0 },
  checkInKey: { type: String, required: true },
  requestHash: { type: String, required: true },
  claimedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  claimKey: { type: String },
  completionKey: { type: String },
  completionRequestHash: { type: String },
  cancelledBy: { type: String, default: "" },
  cancellationReason: { type: String, default: "" },
});
visitSchema.index({ tenant_id: 1, queueNumber: 1 }, { unique: true });
visitSchema.index({ tenant_id: 1, state: 1, queueNumber: 1 });
visitSchema.index({ tenant_id: 1, checkInKey: 1 }, { unique: true });
visitSchema.index(
  { tenant_id: 1, patientId: 1 },
  {
    unique: true,
    partialFilterExpression: { state: { $in: ["QUEUED", "IN_CONSULTATION"] } },
  },
);
visitSchema.index(
  { tenant_id: 1, doctorId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      state: "IN_CONSULTATION",
      doctorId: { $gt: "" },
    },
  },
);
visitSchema.index(
  { tenant_id: 1, claimKey: 1 },
  { unique: true, partialFilterExpression: { claimKey: { $type: "string" } } },
);
export const vitalsSchema = make({
  visitId: { type: String, required: true },
  patientId: { type: String, required: true },
  observations: {
    type: [
      new Schema(
        {
          code: {
            type: String,
            required: true,
            enum: [
              "TEMPERATURE",
              "SYSTOLIC_BP",
              "DIASTOLIC_BP",
              "PULSE",
              "SPO2",
              "WEIGHT",
              "HEIGHT",
            ],
          },
          value: { type: Number, required: true },
          unit: { type: String, required: true },
        },
        { _id: false, strict: "throw" },
      ),
    ],
    required: true,
  },
  recordedBy: { type: String, required: true },
});
vitalsSchema.index({ tenant_id: 1, visitId: 1, createdAt: -1 });
export const cashSessionSchema = make({
  receptionistId: { type: String, required: true },
  openingFloatMinor: {
    type: Number,
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  },
  currency: { type: String, enum: ["INR"], required: true },
  state: { type: String, enum: ["OPEN"], default: "OPEN" },
  openedAt: { type: Date, default: Date.now },
  operationKey: { type: String, required: true },
  requestHash: { type: String, required: true },
});
cashSessionSchema.index(
  { tenant_id: 1, receptionistId: 1 },
  { unique: true, partialFilterExpression: { state: "OPEN" } },
);
cashSessionSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
