import { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import type { Row } from "../../db.js";
import type { InvoiceLine } from "./money.js";
export interface Invoice extends Row {
  patientId: string;
  createdBy: string;
  number: string;
  state: "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "VOID";
  currency: "INR";
  lines: InvoiceLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  version: number;
  issuedAt: Date | null;
  voidReason: string;
  operationKey: string;
  requestHash: string;
}
export interface Payment extends Row {
  invoiceId: string;
  patientId: string;
  actorId: string;
  amountMinor: number;
  method: "CASH" | "UPI" | "CARD";
  externalReference: string;
  cashSessionId: string;
  operationKey: string;
  requestHash: string;
}
export interface CashMovement extends Row {
  cashSessionId: string;
  paymentId: string;
  actorId: string;
  amountMinor: number;
  kind: "RECEIPT";
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
const line = new Schema(
  {
    description: String,
    quantity: Number,
    unitPriceMinor: Number,
    taxBasisPoints: Number,
    subtotalMinor: Number,
    taxMinor: Number,
    totalMinor: Number,
  },
  { _id: false, strict: "throw" },
);
export const invoiceSchema = make({
  patientId: { type: String, required: true },
  createdBy: String,
  number: { type: String, default: "" },
  state: {
    type: String,
    enum: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "VOID"],
    default: "DRAFT",
  },
  currency: { type: String, enum: ["INR"], default: "INR" },
  lines: { type: [line], required: true },
  subtotalMinor: Number,
  taxMinor: Number,
  totalMinor: Number,
  paidMinor: { type: Number, default: 0 },
  version: { type: Number, default: 0 },
  issuedAt: { type: Date, default: null },
  voidReason: { type: String, default: "" },
  operationKey: { type: String, required: true },
  requestHash: { type: String, required: true },
});
invoiceSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
invoiceSchema.index(
  { tenant_id: 1, number: 1 },
  { unique: true, partialFilterExpression: { number: { $gt: "" } } },
);
invoiceSchema.index({ tenant_id: 1, patientId: 1, createdAt: -1 });
export const paymentSchema = make({
  invoiceId: { type: String, required: true },
  patientId: String,
  actorId: String,
  amountMinor: {
    type: Number,
    required: true,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  },
  method: { type: String, enum: ["CASH", "UPI", "CARD"], required: true },
  externalReference: { type: String, default: "" },
  cashSessionId: { type: String, default: "" },
  operationKey: { type: String, required: true },
  requestHash: { type: String, required: true },
});
paymentSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
paymentSchema.index(
  { tenant_id: 1, method: 1, externalReference: 1 },
  { unique: true, partialFilterExpression: { externalReference: { $gt: "" } } },
);
paymentSchema.index({ tenant_id: 1, invoiceId: 1 });
export const cashMovementSchema = make({
  cashSessionId: { type: String, required: true },
  paymentId: { type: String, required: true },
  actorId: String,
  amountMinor: { type: Number, required: true, min: 1 },
  kind: { type: String, enum: ["RECEIPT"], required: true },
});
cashMovementSchema.index({ tenant_id: 1, paymentId: 1 }, { unique: true });
cashMovementSchema.index({ tenant_id: 1, cashSessionId: 1 });
