import { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import type { Row } from "../../db.js";
const make = (fields: Record<string, unknown>) =>
  new Schema(
    {
      _id: { type: String, default: randomUUID },
      tenant_id: { type: String, required: true },
      ...fields,
    },
    { timestamps: true, strict: "throw" },
  );
export interface DocumentRecord extends Row {
  patientId: string;
  kind: "PRESCRIPTION" | "LAB_RESULT" | "INVOICE";
  sourceId: string;
  sourceHash: string;
  storageKey: string;
  checksum: string;
  sizeBytes: number;
}
export const documentSchema = make({
  patientId: { type: String, required: true },
  kind: {
    type: String,
    enum: ["PRESCRIPTION", "LAB_RESULT", "INVOICE"],
    required: true,
  },
  sourceId: { type: String, required: true },
  sourceHash: { type: String, required: true },
  storageKey: { type: String, required: true },
  checksum: { type: String, required: true },
  sizeBytes: { type: Number, required: true, min: 1, max: 10000000 },
});
documentSchema.index(
  { tenant_id: 1, kind: 1, sourceId: 1, sourceHash: 1 },
  { unique: true },
);
documentSchema.index({ tenant_id: 1, patientId: 1, createdAt: -1 });
export interface DailyUsage extends Row {
  day: string;
  observedAt: Date;
  clinicians: number;
  pdfBytes: number;
}
export const dailySchema = make({
  day: { type: String, required: true },
  observedAt: { type: Date, required: true },
  clinicians: { type: Number, min: 0, required: true },
  pdfBytes: { type: Number, min: 0, required: true },
});
dailySchema.index({ tenant_id: 1, day: 1 }, { unique: true });
export interface Wallet extends Row {
  balance: number;
  held: number;
  version: number;
}
export const walletSchema = make({
  balance: { type: Number, min: 0, default: 0 },
  held: { type: Number, min: 0, default: 0 },
  version: { type: Number, default: 0 },
});
walletSchema.index({ tenant_id: 1 }, { unique: true });
export interface WalletEntry extends Row {
  source: string;
  kind: "TEST_CREDIT" | "DEBIT" | "REFUND";
  units: number;
  actorId: string;
}
export const walletEntrySchema = make({
  source: { type: String, required: true },
  kind: {
    type: String,
    enum: ["TEST_CREDIT", "DEBIT", "REFUND"],
    required: true,
  },
  units: { type: Number, required: true },
  actorId: String,
});
walletEntrySchema.index({ tenant_id: 1, source: 1 }, { unique: true });
export interface MessageJob extends Row {
  attempts: number;
  nextAttempt: Date;
  patientId: string;
  recipient: string;
  channel: "SMS" | "WHATSAPP";
  template: "PORTAL_ACCESS";
  encryptedBody: string;
  providerRef: string;
  state: "QUEUED" | "ACCEPTED" | "DELIVERED" | "FAILED";
  cost: number;
  operationKey: string;
  requestHash: string;
  acceptedAt: Date | null;
  completedAt: Date | null;
}
export const messageSchema = make({
  attempts: { type: Number, default: 0 },
  nextAttempt: { type: Date, default: Date.now },
  patientId: { type: String, required: true },
  recipient: { type: String, required: true },
  channel: { type: String, enum: ["SMS", "WHATSAPP"], required: true },
  template: { type: String, enum: ["PORTAL_ACCESS"], required: true },
  encryptedBody: { type: String, default: "" },
  providerRef: { type: String, required: true },
  state: {
    type: String,
    enum: ["QUEUED", "ACCEPTED", "DELIVERED", "FAILED"],
    default: "QUEUED",
  },
  cost: { type: Number, required: true, min: 0 },
  operationKey: { type: String, required: true },
  requestHash: { type: String, required: true },
  acceptedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
});
messageSchema.index({ providerRef: 1 }, { unique: true });
messageSchema.index({ state: 1, nextAttempt: 1 });
messageSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
export interface ProviderEvent extends Row {
  eventId: string;
  reference: string;
  payloadHash: string;
  status: string;
}
export const eventSchema = make({
  eventId: { type: String, required: true },
  reference: { type: String, required: true },
  payloadHash: { type: String, required: true },
  status: { type: String, required: true },
});
eventSchema.index({ eventId: 1 }, { unique: true });
export interface PlatformBill extends Row {
  month: string;
  providerRef: string;
  quoteHash: string;
  state: "PREVIEW" | "PAID" | "FAILED";
  amountMinor: number;
  rateVersion: string;
  operationKey: string;
}
export const platformBillSchema = make({
  month: { type: String, required: true },
  providerRef: { type: String, required: true },
  quoteHash: { type: String, required: true },
  state: {
    type: String,
    enum: ["PREVIEW", "PAID", "FAILED"],
    default: "PREVIEW",
  },
  amountMinor: { type: Number, min: 0, required: true },
  rateVersion: { type: String, required: true },
  operationKey: { type: String, required: true },
});
platformBillSchema.index({ providerRef: 1 }, { unique: true });
platformBillSchema.index(
  { tenant_id: 1, month: 1, rateVersion: 1 },
  { unique: true },
);
platformBillSchema.index({ tenant_id: 1, operationKey: 1 }, { unique: true });
