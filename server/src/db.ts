import {
  documentSchema,
  dailySchema,
  walletSchema,
  walletEntrySchema,
  messageSchema,
  eventSchema,
  platformBillSchema,
  type DocumentRecord,
  type DailyUsage,
  type Wallet,
  type WalletEntry,
  type MessageJob,
  type ProviderEvent,
  type PlatformBill,
} from "./modules/platform/models.js";
import {
  invoiceSchema,
  paymentSchema,
  cashMovementSchema,
  type Invoice,
  type Payment,
  type CashMovement,
} from "./modules/billing/models.js";
import {
  batchSchema,
  stockAdjustmentSchema,
  substitutionSchema,
  dispenseSchema,
  type Batch,
  type StockAdjustment,
  type Substitution,
  type Dispense,
} from "./modules/pharmacy/models.js";
import { resultSchema, type LabResult } from "./modules/laboratory/models.js";
import {
  noteSchema,
  amendmentSchema,
  prescriptionSchema,
  labOrderSchema,
  serviceOrderSchema,
  usageSchema,
  type Note,
  type Amendment,
  type Prescription,
  type LabOrder,
  type ServiceOrder,
  type UsageEvent,
} from "./modules/doctor/models.js";
import "./config/dns.js";
import {
  patientSchema,
  visitSchema,
  vitalsSchema,
  cashSessionSchema,
  type Patient,
  type Visit,
  type Vitals,
  type CashSession,
} from "./modules/reception/models.js";
import mongoose, {
  Schema,
  type Connection,
  type ClientSession,
  type FilterQuery,
  type UpdateQuery,
} from "mongoose";
import { randomUUID } from "node:crypto";
import type { Role } from "./types.js";
import { roles, check } from "./types.js";
export interface Row {
  _id: string;
  tenant_id: string;
  createdAt?: Date;
  updatedAt?: Date;
}
export interface User extends Row {
  name: string;
  login: string;
  role: Role;
  passwordHash: string;
  pinHash: string;
  signoffPinHash: string;
  status: "ACTIVE" | "DISABLED";
  credentialVersion: number;
  challengeVersion: number;
  mustChangePassword: boolean;
  mfaSecret: string;
  mfaEnabled: boolean;
  lastTotpStep: number;
  recoveryHashes: string[];
  licenceStatus: "PENDING" | "VERIFIED";
  licenceEvidence: string;
  contactVerified: boolean;
}
export interface Tenant extends Row {
  name: string;
  type: string;
  subdomain: string;
  capacity: number;
  status: "ACTIVE" | "SUSPENDED";
  ownerId: string;
  governanceVersion: number;
  queueSequence: number;
  invoiceSequence: number;
}
export interface Challenge extends Row {
  purpose: "INVITE" | "RECOVERY" | "OTP" | "PATIENT_ACTIVATE";
  userId: string;
  login: string;
  role: Role;
  hash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  approved: boolean;
  invitedBy: string;
}
export interface Session extends Row {
  userId: string;
  hash: string;
  family: string;
  expiresAt: Date;
  revokedAt: Date | null;
  credentialVersion: number;
  used: boolean;
}
export interface Audit extends Row {
  actorId: string;
  action: string;
  resourceId: string;
  outcome: string;
  requestId: string;
}
export interface Outbox extends Row {
  recipient: string;
  subject: string;
  encryptedBody: string;
  status: "PENDING" | "SENT";
  attempts: number;
  nextAttempt: Date;
}
export interface Operation extends Row {
  actorId: string;
  operation: string;
  keyHash: string;
  requestHash: string;
  resourceId: string;
  expiresAt: Date;
}
const base = {
  _id: { type: String, default: randomUUID },
  tenant_id: { type: String, required: true, index: true },
};
const schema = (fields: Record<string, unknown>) =>
  new Schema({ ...base, ...fields }, { timestamps: true, strict: "throw" });
const operationSchema = schema({
  actorId: { type: String, required: true },
  operation: { type: String, required: true },
  keyHash: { type: String, required: true },
  requestHash: { type: String, required: true },
  resourceId: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});
operationSchema.index(
  { tenant_id: 1, actorId: 1, operation: 1, keyHash: 1 },
  { unique: true },
);
operationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const userSchema = schema({
  name: { type: String, required: true },
  login: { type: String, required: true },
  role: { type: String, enum: roles, required: true },
  passwordHash: { type: String, default: "" },
  pinHash: { type: String, default: "" },
  signoffPinHash: { type: String, default: "" },
  status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE" },
  credentialVersion: { type: Number, default: 0 },
  challengeVersion: { type: Number, default: 0 },
  mustChangePassword: { type: Boolean, default: false },
  mfaSecret: { type: String, default: "" },
  mfaEnabled: { type: Boolean, default: false },
  lastTotpStep: { type: Number, default: -1 },
  recoveryHashes: { type: [String], default: [] },
  licenceStatus: {
    type: String,
    enum: ["PENDING", "VERIFIED"],
    default: "PENDING",
  },
  licenceEvidence: { type: String, default: "" },
  contactVerified: { type: Boolean, default: false },
});
userSchema.index({ tenant_id: 1, login: 1 }, { unique: true });
const tenantSchema = schema({
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ["CLINIC", "POLYCLINIC", "DIAGNOSTIC_CENTER"],
    required: true,
  },
  subdomain: { type: String, required: true, unique: true },
  capacity: { type: Number, required: true },
  status: { type: String, default: "ACTIVE" },
  ownerId: { type: String, required: true },
  governanceVersion: { type: Number, default: 0 },
  queueSequence: { type: Number, default: 0 },
  invoiceSequence: { type: Number, default: 0 },
});
const challengeSchema = schema({
  purpose: String,
  userId: { type: String, default: "" },
  login: String,
  role: { type: String, enum: roles },
  hash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  approved: { type: Boolean, default: true },
  invitedBy: { type: String, default: "" },
});
challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const sessionSchema = schema({
  userId: String,
  hash: { type: String, unique: true },
  family: String,
  expiresAt: Date,
  revokedAt: { type: Date, default: null },
  credentialVersion: Number,
  used: { type: Boolean, default: false },
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const auditSchema = schema({
  actorId: String,
  action: String,
  resourceId: String,
  outcome: String,
  requestId: String,
});
auditSchema.index({ tenant_id: 1, createdAt: -1 });
const outboxSchema = schema({
  recipient: String,
  subject: String,
  encryptedBody: String,
  status: { type: String, default: "PENDING" },
  attempts: { type: Number, default: 0 },
  nextAttempt: { type: Date, default: Date.now },
});
interface Bootstrap {
  _id: string;
  email: string;
  subdomain: string;
  proofHash: string;
  grantHash: string;
  verified: boolean;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  registrationKeyHash?: string;
  requestHash?: string;
  tenantId?: string;
  ownerId?: string;
}
const bootstrapSchema = new Schema<Bootstrap>(
  {
    _id: { type: String, default: randomUUID },
    email: String,
    subdomain: String,
    proofHash: String,
    grantHash: String,
    verified: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    expiresAt: Date,
    consumedAt: { type: Date, default: null },
    registrationKeyHash: { type: String },
    requestHash: String,
    tenantId: String,
    ownerId: String,
  },
  { strict: "throw" },
);
bootstrapSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
bootstrapSchema.index(
  { registrationKeyHash: 1 },
  { unique: true, sparse: true },
);
// Raw models never leave this module. Normal domain access always receives immutable tenant scope.
class Scoped<T extends Row> {
  constructor(
    private model: mongoose.Model<T>,
    private tenantId: string,
  ) {
    check(tenantId, 500, "SCOPE_REQUIRED");
  }
  private filter(q: FilterQuery<T>) {
    return { $and: [{ tenant_id: this.tenantId }, q] } as FilterQuery<T>;
  }
  findOne(q: FilterQuery<T>, session?: ClientSession) {
    return this.model.findOne(this.filter(q), null, { session }).lean().exec();
  }
  find(q: FilterQuery<T> = {}) {
    return this.model
      .find(this.filter(q))
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
      .exec();
  }
  list(
    q: FilterQuery<T>,
    options: { sort: Record<string, 1 | -1>; limit: number },
    session?: ClientSession,
  ) {
    check(
      Number.isInteger(options.limit) &&
        options.limit >= 1 &&
        options.limit <= 101,
      500,
      "INVALID_PAGE_LIMIT",
    );
    return this.model
      .find(this.filter(q), null, { session })
      .sort(options.sort)
      .limit(options.limit)
      .lean()
      .exec();
  }
  count(q: FilterQuery<T>, session?: ClientSession) {
    return this.model
      .countDocuments(this.filter(q))
      .session(session ?? null)
      .exec();
  }
  async sum(q: FilterQuery<T>, field: string, session?: ClientSession) {
    check(/^[A-Za-z][A-Za-z0-9]*$/.test(field), 500, "INVALID_FIELD");
    const rows = await this.model
      .aggregate<{ total: number }>([
        { $match: this.filter(q) },
        { $group: { _id: null, total: { $sum: `$${field}` } } },
      ])
      .session(session ?? null)
      .exec();
    const total = rows[0]?.total ?? 0;
    check(Number.isSafeInteger(total), 500, "METER_OVERFLOW");
    return total;
  }
  async create(v: Partial<T>, session?: ClientSession) {
    const [d] = await this.model.create([{ ...v, tenant_id: this.tenantId }], {
      session,
    });
    return d!.toObject();
  }
  private protectScope(update: UpdateQuery<T>) {
    check(!Array.isArray(update), 500, "SCOPE_IMMUTABLE");
    const protectedPath = (path: string) =>
      path.split(".").includes("tenant_id");
    for (const [operator, value] of Object.entries(update)) {
      if (!operator.startsWith("$")) {
        check(!protectedPath(operator), 500, "SCOPE_IMMUTABLE");
        continue;
      }
      if (value && typeof value === "object")
        for (const [field, target] of Object.entries(value)) {
          check(!protectedPath(field), 500, "SCOPE_IMMUTABLE");
          if (operator === "$rename" && typeof target === "string")
            check(!protectedPath(target), 500, "SCOPE_IMMUTABLE");
        }
    }
  }
  update(q: FilterQuery<T>, u: UpdateQuery<T>, session?: ClientSession) {
    // Tenant identity is immutable, including through operator updates.
    this.protectScope(u);
    return this.model
      .findOneAndUpdate(this.filter(q), u, {
        new: true,
        runValidators: true,
        session,
      })
      .lean()
      .exec();
  }
  updateMany(q: FilterQuery<T>, u: UpdateQuery<T>, session?: ClientSession) {
    this.protectScope(u);
    return this.model.updateMany(this.filter(q), u, { session }).exec();
  }
}
export class Database {
  private documentsModel;
  private dailyModel;
  private walletsModel;
  private walletEntriesModel;
  private messagesModel;
  private providerEventsModel;
  private platformBillsModel;
  private invoicesModel;
  private paymentsModel;
  private cashMovementsModel;
  private batchesModel;
  private adjustmentsModel;
  private substitutionsModel;
  private dispensesModel;
  private labResultsModel;
  private notesModel;
  private amendmentsModel;
  private prescriptionsModel;
  private labOrdersModel;
  private serviceOrdersModel;
  private usageModel;
  private patientsModel;
  private visitsModel;
  private vitalsModel;
  private cashSessionsModel;
  private operationsModel;
  private usersModel;
  private tenantsModel;
  private challengesModel;
  private sessionsModel;
  private auditModel;
  private outboxModel;
  private bootstrapModel;
  private rates;
  constructor(public connection: Connection) {
    this.operationsModel = connection.model<Operation>(
      "Operation",
      operationSchema,
    );
    this.documentsModel = connection.model<DocumentRecord>(
      "DocumentRecord",
      documentSchema,
    );
    this.dailyModel = connection.model<DailyUsage>("DailyUsage", dailySchema);
    this.walletsModel = connection.model<Wallet>("Wallet", walletSchema);
    this.walletEntriesModel = connection.model<WalletEntry>(
      "WalletEntry",
      walletEntrySchema,
    );
    this.messagesModel = connection.model<MessageJob>(
      "MessageJob",
      messageSchema,
    );
    this.providerEventsModel = connection.model<ProviderEvent>(
      "ProviderEvent",
      eventSchema,
    );
    this.platformBillsModel = connection.model<PlatformBill>(
      "PlatformBill",
      platformBillSchema,
    );
    this.invoicesModel = connection.model<Invoice>("Invoice", invoiceSchema);
    this.paymentsModel = connection.model<Payment>("Payment", paymentSchema);
    this.cashMovementsModel = connection.model<CashMovement>(
      "CashMovement",
      cashMovementSchema,
    );
    this.batchesModel = connection.model<Batch>("StockBatch", batchSchema);
    this.adjustmentsModel = connection.model<StockAdjustment>(
      "StockAdjustment",
      stockAdjustmentSchema,
    );
    this.substitutionsModel = connection.model<Substitution>(
      "Substitution",
      substitutionSchema,
    );
    this.dispensesModel = connection.model<Dispense>(
      "Dispense",
      dispenseSchema,
    );
    this.labResultsModel = connection.model<LabResult>(
      "LabResult",
      resultSchema,
    );
    this.notesModel = connection.model<Note>("ConsultationNote", noteSchema);
    this.amendmentsModel = connection.model<Amendment>(
      "NoteAmendment",
      amendmentSchema,
    );
    this.prescriptionsModel = connection.model<Prescription>(
      "Prescription",
      prescriptionSchema,
    );
    this.labOrdersModel = connection.model<LabOrder>(
      "LabOrder",
      labOrderSchema,
    );
    this.serviceOrdersModel = connection.model<ServiceOrder>(
      "ServiceOrder",
      serviceOrderSchema,
    );
    this.usageModel = connection.model<UsageEvent>("UsageEvent", usageSchema);
    this.patientsModel = connection.model<Patient>("Patient", patientSchema);
    this.visitsModel = connection.model<Visit>("Visit", visitSchema);
    this.vitalsModel = connection.model<Vitals>("Vitals", vitalsSchema);
    this.cashSessionsModel = connection.model<CashSession>(
      "CashSession",
      cashSessionSchema,
    );
    this.usersModel = connection.model<User>("User", userSchema);
    this.tenantsModel = connection.model<Tenant>("Tenant", tenantSchema);
    this.challengesModel = connection.model<Challenge>(
      "Challenge",
      challengeSchema,
    );
    this.sessionsModel = connection.model<Session>("Session", sessionSchema);
    this.auditModel = connection.model<Audit>("Audit", auditSchema);
    this.outboxModel = connection.model<Outbox>("Outbox", outboxSchema);
    this.bootstrapModel = connection.model<Bootstrap>(
      "Bootstrap",
      bootstrapSchema,
    );
    this.rates = connection.model(
      "RateBucket",
      new Schema(
        { _id: String, count: Number, expiresAt: Date },
        { strict: "throw" },
      ),
    );
    this.rates.schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  documents(t: string) {
    return new Scoped(this.documentsModel, t);
  }
  dailyUsage(t: string) {
    return new Scoped(this.dailyModel, t);
  }
  wallets(t: string) {
    return new Scoped(this.walletsModel, t);
  }
  walletEntries(t: string) {
    return new Scoped(this.walletEntriesModel, t);
  }
  messages(t: string) {
    return new Scoped(this.messagesModel, t);
  }
  providerEvents(t: string) {
    return new Scoped(this.providerEventsModel, t);
  }
  platformBills(t: string) {
    return new Scoped(this.platformBillsModel, t);
  }
  // Narrow worker/provider boundaries return only opaque references and tenant scope.
  async activeTenantRefs() {
    return this.tenantsModel
      .find({ status: "ACTIVE" }, { _id: 1 })
      .lean()
      .cursor();
  }
  async pendingMessageRefs() {
    return this.messagesModel
      .find(
        {
          state: "QUEUED",
          $or: [
            { nextAttempt: { $lte: new Date() } },
            { nextAttempt: { $exists: false } },
          ],
        },
        { _id: 1, tenant_id: 1 },
      )
      .sort({ nextAttempt: 1, _id: 1 })
      .limit(100)
      .lean()
      .exec();
  }
  async resolveProviderReference(reference: string, kind: "MESSAGE" | "BILL") {
    return kind === "MESSAGE"
      ? this.messagesModel
          .findOne({ providerRef: reference }, { _id: 1, tenant_id: 1 })
          .lean()
          .exec()
      : this.platformBillsModel
          .findOne({ providerRef: reference }, { _id: 1, tenant_id: 1 })
          .lean()
          .exec();
  }
  invoices(t: string) {
    return new Scoped(this.invoicesModel, t);
  }
  payments(t: string) {
    return new Scoped(this.paymentsModel, t);
  }
  cashMovements(t: string) {
    return new Scoped(this.cashMovementsModel, t);
  }
  batches(t: string) {
    return new Scoped(this.batchesModel, t);
  }
  adjustments(t: string) {
    return new Scoped(this.adjustmentsModel, t);
  }
  substitutions(t: string) {
    return new Scoped(this.substitutionsModel, t);
  }
  dispenses(t: string) {
    return new Scoped(this.dispensesModel, t);
  }
  labResults(t: string) {
    return new Scoped(this.labResultsModel, t);
  }
  notes(t: string) {
    return new Scoped(this.notesModel, t);
  }
  amendments(t: string) {
    return new Scoped(this.amendmentsModel, t);
  }
  prescriptions(t: string) {
    return new Scoped(this.prescriptionsModel, t);
  }
  labOrders(t: string) {
    return new Scoped(this.labOrdersModel, t);
  }
  serviceOrders(t: string) {
    return new Scoped(this.serviceOrdersModel, t);
  }
  usage(t: string) {
    return new Scoped(this.usageModel, t);
  }
  patients(t: string) {
    return new Scoped(this.patientsModel, t);
  }
  visits(t: string) {
    return new Scoped(this.visitsModel, t);
  }
  vitals(t: string) {
    return new Scoped(this.vitalsModel, t);
  }
  cashSessions(t: string) {
    return new Scoped(this.cashSessionsModel, t);
  }
  operations(t: string) {
    return new Scoped(this.operationsModel, t);
  }
  users(t: string) {
    return new Scoped(this.usersModel, t);
  }
  tenants(t: string) {
    return new Scoped(this.tenantsModel, t);
  }
  challenges(t: string) {
    return new Scoped(this.challengesModel, t);
  }
  sessions(t: string) {
    return new Scoped(this.sessionsModel, t);
  }
  audits(t: string) {
    return new Scoped(this.auditModel, t);
  }
  outbox(t: string) {
    return new Scoped(this.outboxModel, t);
  }
  async indexes() {
    await Promise.all(
      Object.values(this.connection.models).map((m) => m.createIndexes()),
    );
  }
  async transaction<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const s = await this.connection.startSession();
    try {
      return (await s.withTransaction(() => fn(s))) as T;
    } finally {
      await s.endSession();
    }
  }
  // Narrow authentication/bootstrap resolvers: no arbitrary unscoped query interface.
  resolveSubdomain(subdomain: string) {
    return this.tenantsModel
      .findOne({ subdomain, status: "ACTIVE" })
      .lean()
      .exec();
  }
  resolveChallenge(hash: string, purpose: Challenge["purpose"]) {
    return this.challengesModel
      .findOne({
        hash,
        purpose,
        approved: true,
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .lean()
      .exec();
  }
  resolveSession(hash: string) {
    return this.sessionsModel.findOne({ hash }).lean().exec();
  }
  createBootstrap(v: Partial<Bootstrap>) {
    return this.bootstrapModel.create(v);
  }
  getBootstrap(id: string) {
    return this.bootstrapModel
      .findOne({ _id: id, expiresAt: { $gt: new Date() }, consumedAt: null })
      .lean()
      .exec();
  }
  attemptBootstrap(id: string) {
    return this.bootstrapModel
      .findOneAndUpdate(
        {
          _id: id,
          attempts: { $lt: 5 },
          expiresAt: { $gt: new Date() },
          consumedAt: null,
        },
        { $inc: { attempts: 1 } },
        { new: true },
      )
      .lean()
      .exec();
  }
  verifyBootstrap(id: string, grantHash: string) {
    return this.bootstrapModel
      .findOneAndUpdate(
        { _id: id, verified: false, consumedAt: null },
        { $set: { verified: true, grantHash } },
        { new: true },
      )
      .lean()
      .exec();
  }
  consumeBootstrap(
    hash: string,
    email: string,
    subdomain: string,
    keyHash: string,
    requestHash: string,
    tenantId: string,
    ownerId: string,
    s: ClientSession,
  ) {
    return this.bootstrapModel
      .findOneAndUpdate(
        {
          grantHash: hash,
          email,
          subdomain,
          verified: true,
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            consumedAt: new Date(),
            registrationKeyHash: keyHash,
            requestHash,
            tenantId,
            ownerId,
          },
        },
        { session: s, new: true },
      )
      .lean()
      .exec();
  }
  registrationReplay(keyHash: string) {
    return this.bootstrapModel
      .findOne({ registrationKeyHash: keyHash })
      .lean()
      .exec();
  }
  async checkLimit(key: string, max: number, windowMs: number) {
    const bucket = Math.floor(Date.now() / windowMs);
    const entry = await this.rates.findOne({ _id: `${key}:${bucket}` }).lean();
    check(
      (entry?.count ?? 0) < max,
      429,
      "RATE_LIMITED",
      "Too many failed verification attempts. Try again later.",
    );
  }
  async limit(key: string, max: number, windowMs: number) {
    const bucket = Math.floor(Date.now() / windowMs);
    const _id = `${key}:${bucket}`;
    let d;
    try {
      d = await this.rates
        .findOneAndUpdate(
          { _id },
          {
            $inc: { count: 1 },
            $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) },
          },
          { upsert: true, new: true },
        )
        .lean();
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      d = await this.rates
        .findOneAndUpdate({ _id }, { $inc: { count: 1 } }, { new: true })
        .lean();
    }
    check(
      d && (d.count ?? 0) <= max,
      429,
      "RATE_LIMITED",
      "Too many attempts. Try again later.",
    );
  }
  // Worker claims only IDs and tenant scope, then uses the scoped outbox repository.
  pendingMail() {
    return this.outboxModel
      .find({ status: "PENDING", nextAttempt: { $lte: new Date() } })
      .select("_id tenant_id")
      .limit(20)
      .lean()
      .exec();
  }
}
export async function connect(uri: string) {
  const c = await mongoose
    .createConnection(uri, {
      serverSelectionTimeoutMS: 10000,
      autoIndex: false,
    })
    .asPromise();
  const db = new Database(c);
  await db.indexes();
  return db;
}
