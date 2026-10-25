import { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import type { Row } from "../../db.js";
export interface LabObservation {
  name: string;
  value: string;
  unit: string;
  referenceInterval: string;
  comments: string;
}
export interface LabResult extends Row {
  orderId: string;
  visitId: string;
  patientId: string;
  doctorId: string;
  revision: number;
  state: "RESULT_DRAFT" | "TECH_SIGNED" | "DOCTOR_VERIFIED" | "RELEASED";
  observations: LabObservation[];
  comments: string;
  correctionReason: string;
  version: number;
  contentHash: string;
  signedBy: string;
  signedAt: Date | null;
  verifiedBy: string;
  verifiedAt: Date | null;
  releasedBy: string;
  releasedAt: Date | null;
  operationKey: string;
}
const observation = new Schema(
  {
    name: String,
    value: String,
    unit: String,
    referenceInterval: String,
    comments: String,
  },
  { _id: false, strict: "throw" },
);
export const resultSchema = new Schema(
  {
    _id: { type: String, default: randomUUID },
    tenant_id: { type: String, required: true, index: true },
    orderId: { type: String, required: true },
    visitId: String,
    patientId: String,
    doctorId: String,
    revision: { type: Number, required: true },
    state: {
      type: String,
      enum: ["RESULT_DRAFT", "TECH_SIGNED", "DOCTOR_VERIFIED", "RELEASED"],
      default: "RESULT_DRAFT",
    },
    observations: { type: [observation], required: true },
    comments: { type: String, default: "" },
    correctionReason: { type: String, default: "" },
    version: { type: Number, default: 0 },
    contentHash: { type: String, default: "" },
    signedBy: { type: String, default: "" },
    signedAt: { type: Date, default: null },
    verifiedBy: { type: String, default: "" },
    verifiedAt: { type: Date, default: null },
    releasedBy: { type: String, default: "" },
    releasedAt: { type: Date, default: null },
    operationKey: { type: String, required: true },
  },
  { strict: "throw", timestamps: true },
);
resultSchema.index({ tenant_id: 1, orderId: 1, revision: 1 }, { unique: true });
resultSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
