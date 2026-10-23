import "./config/dns.js";
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
}
export interface Challenge extends Row {
  purpose: "INVITE" | "RECOVERY" | "OTP";
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
const base = {
  _id: { type: String, default: randomUUID },
  tenant_id: { type: String, required: true, index: true },
};
const schema = (fields: Record<string, unknown>) =>
  new Schema({ ...base, ...fields }, { timestamps: true, strict: "throw" });
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
  async create(v: Partial<T>, session?: ClientSession) {
    const [d] = await this.model.create([{ ...v, tenant_id: this.tenantId }], {
      session,
    });
    return d!.toObject();
  }
  update(q: FilterQuery<T>, u: UpdateQuery<T>, session?: ClientSession) {
    // Tenant identity is immutable, including through operator updates.
    check(!JSON.stringify(u).includes("tenant_id"), 500, "SCOPE_IMMUTABLE");
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
    check(!JSON.stringify(u).includes("tenant_id"), 500, "SCOPE_IMMUTABLE");
    return this.model.updateMany(this.filter(q), u, { session }).exec();
  }
}
export class Database {
  private usersModel;
  private tenantsModel;
  private challengesModel;
  private sessionsModel;
  private auditModel;
  private outboxModel;
  private bootstrapModel;
  private rates;
  constructor(public connection: Connection) {
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
