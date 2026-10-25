import { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import type { Row } from "../../db.js";
export interface Batch extends Row {
  medicine: string;
  strength: string;
  route: string;
  unit: string;
  productKey: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  version: number;
  operationKey: string;
  requestHash: string;
}
export interface StockAdjustment extends Row {
  batchId: string;
  actorId: string;
  delta: number;
  reason: string;
  operationKey: string;
}
export interface Substitution extends Row {
  prescriptionId: string;
  visitId: string;
  doctorId: string;
  lineIndex: number;
  medicine: string;
  strength: string;
  route: string;
  unit: string;
  productKey: string;
  reason: string;
  state: "REQUESTED" | "APPROVED";
  approvedAt: Date | null;
  approvedBy: string;
  operationKey: string;
}
export interface DispenseAllocation {
  batchId: string;
  lineIndex: number;
  quantity: number;
  medicine: string;
  strength: string;
  route: string;
  unit: string;
  batchNumber: string;
  expiryDate: string;
}
export interface Dispense extends Row {
  prescriptionId: string;
  visitId: string;
  patientId: string;
  pharmacistId: string;
  allocations: DispenseAllocation[];
  operationKey: string;
  requestHash: string;
}
const make = (fields: Record<string, unknown>) =>
  new Schema(
    {
      _id: { type: String, default: randomUUID },
      tenant_id: { type: String, required: true, index: true },
      ...fields,
    },
    { strict: "throw", timestamps: true },
  );
export const batchSchema = make({
  medicine: { type: String, required: true },
  strength: { type: String, required: true },
  route: { type: String, required: true },
  unit: { type: String, required: true },
  productKey: { type: String, required: true },
  batchNumber: { type: String, required: true },
  expiryDate: { type: String, required: true },
  quantity: {
    type: Number,
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  },
  version: { type: Number, default: 0 },
  operationKey: { type: String, required: true },
  requestHash: { type: String, required: true },
});
batchSchema.index(
  { tenant_id: 1, productKey: 1, batchNumber: 1 },
  { unique: true },
);
batchSchema.index({ tenant_id: 1, productKey: 1, expiryDate: 1, _id: 1 });
batchSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
export const stockAdjustmentSchema = make({
  batchId: String,
  actorId: String,
  delta: Number,
  reason: String,
  operationKey: { type: String, required: true },
});
stockAdjustmentSchema.index(
  { tenant_id: 1, operationKey: 1 },
  { unique: true },
);
export const substitutionSchema = make({
  prescriptionId: String,
  visitId: String,
  doctorId: String,
  lineIndex: Number,
  medicine: String,
  strength: String,
  route: String,
  unit: String,
  productKey: String,
  reason: String,
  state: {
    type: String,
    enum: ["REQUESTED", "APPROVED"],
    default: "REQUESTED",
  },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: String, default: "" },
  operationKey: { type: String, required: true },
});
substitutionSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
substitutionSchema.index(
  { tenant_id: 1, prescriptionId: 1, lineIndex: 1 },
  { unique: true },
);
const allocation = new Schema(
  {
    batchId: String,
    lineIndex: Number,
    quantity: Number,
    medicine: String,
    strength: String,
    route: String,
    unit: String,
    batchNumber: String,
    expiryDate: String,
  },
  { _id: false, strict: "throw" },
);
export const dispenseSchema = make({
  prescriptionId: String,
  visitId: { type: String, required: true },
  patientId: String,
  pharmacistId: String,
  allocations: { type: [allocation], required: true },
  operationKey: { type: String, required: true },
  requestHash: { type: String, required: true },
});
dispenseSchema.index({ tenant_id: 1, visitId: 1 }, { unique: true });
dispenseSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
