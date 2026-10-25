import { cashView } from "../billing/cash-view.js";
import { randomInt } from "node:crypto";
import type { FilterQuery } from "mongoose";
import { digest } from "../../crypto.js";
import type { Identity } from "../../auth.js";
import { check, type Principal } from "../../types.js";
import type { Patient, Visit, CashSession } from "./models.js";
import type { PatientInput, PatientPatch, VitalsInput } from "./contracts.js";
import { Operations } from "./operations.js";
import { minorAmount } from "./money.js";
export interface QueueNotice {
  tenantId: string;
  visitId: string;
  state: string;
  version: number;
}
export type QueuePublisher = (notice: QueueNotice) => void;
export class Reception {
  private operations: Operations;
  constructor(
    private identity: Identity,
    private publish: QueuePublisher = () => {},
  ) {
    this.operations = new Operations(identity.db);
  }
  private get db() {
    return this.identity.db;
  }
  private authorize(p: Principal, ...roles: Principal["role"][]) {
    check(p.purpose === "access" && roles.includes(p.role), 403, "FORBIDDEN");
  }
  private patientView(p: Principal, patient: Patient) {
    return {
      id: patient._id,
      name: patient.name,
      version: patient.version,
      ...(p.role !== "OWNER"
        ? {
            contact: { type: patient.contactType, value: patient.contactValue },
            date_of_birth: patient.dateOfBirth || null,
            portal_status: patient.userId
              ? "PENDING_VERIFICATION"
              : "NOT_PROVISIONED",
          }
        : {}),
    };
  }
  async search(
    p: Principal,
    query: { q: string; cursor?: string; limit: number },
  ) {
    this.authorize(p, "RECEPTIONIST", "OWNER");
    const escaped = query.q
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter: FilterQuery<Patient> = {
      ...(query.cursor ? { _id: { $lt: query.cursor } } : {}),
      ...(escaped
        ? {
            $or: [
              { searchName: { $regex: escaped } },
              { contactValue: { $regex: escaped } },
            ],
          }
        : {}),
    };
    const found = await this.db
      .patients(p.tenantId)
      .list(filter, { sort: { _id: -1 }, limit: query.limit + 1 });
    const rows = found.slice(0, query.limit);
    return {
      items: rows.map((v) => this.patientView(p, v)),
      next_cursor: found.length > query.limit ? rows.at(-1)!._id : null,
    };
  }
  async patient(p: Principal, id: string) {
    this.authorize(p, "RECEPTIONIST", "OWNER", "DOCTOR", "PATIENT");
    const patient = await this.db.patients(p.tenantId).findOne({ _id: id });
    check(patient, 404, "NOT_FOUND");
    if (p.role === "DOCTOR")
      check(
        await this.db
          .visits(p.tenantId)
          .findOne({ patientId: id, doctorId: p.userId }),
        404,
        "NOT_FOUND",
      );
    if (p.role === "PATIENT")
      check(patient.userId === p.userId, 404, "NOT_FOUND");
    return this.patientView(p, patient);
  }
  async register(
    p: Principal,
    input: PatientInput,
    key: string,
    requestId: string,
  ) {
    this.authorize(p, "RECEPTIONIST");
    const id = await this.operations.execute(
      p,
      "patient.register",
      key,
      input,
      async (s) => {
        const patient = await this.db.patients(p.tenantId).create(
          {
            name: input.name,
            searchName: input.name.normalize("NFKC").toLowerCase(),
            contactType: input.contact.type,
            contactValue: input.contact.value,
            dateOfBirth: input.date_of_birth ?? "",
            userId: "",
            version: 0,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "PATIENT_REGISTERED",
          patient._id,
          requestId,
          s,
        );
        return patient._id;
      },
    );
    return this.patient(p, id);
  }
  async update(
    p: Principal,
    id: string,
    input: PatientPatch,
    requestId: string,
  ) {
    this.authorize(p, "RECEPTIONIST");
    return this.db.transaction(async (s) => {
      const patient = await this.db
        .patients(p.tenantId)
        .findOne({ _id: id }, s);
      check(patient, 404, "NOT_FOUND");
      const next = await this.db.patients(p.tenantId).update(
        { _id: id, version: input.expected_version },
        {
          $set: {
            ...(input.name
              ? {
                  name: input.name,
                  searchName: input.name.normalize("NFKC").toLowerCase(),
                }
              : {}),
            ...(input.date_of_birth !== undefined
              ? { dateOfBirth: input.date_of_birth ?? "" }
              : {}),
          },
          $inc: { version: 1 },
        },
        s,
      );
      check(
        next,
        409,
        "CONFLICT",
        "This patient was updated elsewhere. Reload before editing.",
      );
      // Keep the account display name consistent without changing its contact or credential proof.
      if (patient.userId && input.name)
        await this.db
          .users(p.tenantId)
          .update(
            { _id: patient.userId, role: "PATIENT" },
            { $set: { name: input.name } },
            s,
          );
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "PATIENT_UPDATED",
        id,
        requestId,
        s,
      );
      return this.patientView(p, next);
    });
  }
  private visitView(v: Visit) {
    return {
      id: v._id,
      patient_id: v.patientId,
      state: v.state,
      queue_number: v.queueNumber,
      queued_at: v.queuedAt,
      version: v.version,
    };
  }
  async checkIn(
    p: Principal,
    patientId: string,
    key: string,
    requestId: string,
  ) {
    this.authorize(p, "RECEPTIONIST");
    const pinHash = await this.identity.hashPin(
      String(randomInt(10000)).padStart(4, "0"),
    );
    const operationKey = digest(`${p.userId}:${key}`),
      requestHash = digest(JSON.stringify({ patient_id: patientId }));
    const existing = await this.db
      .visits(p.tenantId)
      .findOne({ checkInKey: operationKey });
    if (existing) {
      check(existing.requestHash === requestHash, 409, "CONFLICT");
      return this.visitView(existing);
    }
    const id = await this.operations.execute(
      p,
      "visit.check-in",
      key,
      { patient_id: patientId },
      async (s) => {
        const patient = await this.db
          .patients(p.tenantId)
          .findOne({ _id: patientId }, s);
        check(patient, 404, "NOT_FOUND");
        check(
          !(await this.db
            .visits(p.tenantId)
            .findOne(
              { patientId, state: { $in: ["QUEUED", "IN_CONSULTATION"] } },
              s,
            )),
          409,
          "CONFLICT",
          "This patient already has an active visit.",
        );
        if (!patient.userId) {
          check(
            !(await this.db
              .users(p.tenantId)
              .findOne({ login: patient.contactValue }, s)),
            409,
            "CONFLICT",
            "This contact is already used by another account. Use a separate contact for portal access.",
          );
          const user = await this.db.users(p.tenantId).create(
            {
              name: patient.name,
              login: patient.contactValue,
              role: "PATIENT",
              pinHash,
              contactVerified: false,
              passwordHash: "",
            },
            s,
          );
          await this.db
            .patients(p.tenantId)
            .update(
              { _id: patientId, userId: "" },
              { $set: { userId: user._id }, $inc: { version: 1 } },
              s,
            );
        }
        const tenant = await this.db.tenants(p.tenantId).update(
          {
            _id: p.tenantId,
            $or: [
              { queueSequence: { $exists: false } },
              { queueSequence: { $lt: Number.MAX_SAFE_INTEGER } },
            ],
          },
          { $inc: { queueSequence: 1 } },
          s,
        );
        check(tenant, 409, "CONFLICT");
        const visit = await this.db.visits(p.tenantId).create(
          {
            patientId,
            queueNumber: tenant.queueSequence,
            state: "QUEUED",
            queuedAt: new Date(),
            version: 0,
            checkInKey: operationKey,
            requestHash,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "VISIT_CHECKED_IN",
          visit._id,
          requestId,
          s,
        );
        return visit._id;
      },
    );
    const visit = await this.db.visits(p.tenantId).findOne({ _id: id });
    check(visit, 404, "NOT_FOUND");
    this.publish({
      tenantId: p.tenantId,
      visitId: id,
      state: visit.state,
      version: visit.version,
    });
    return this.visitView(visit);
  }
  async queue(p: Principal) {
    this.authorize(p, "RECEPTIONIST", "OWNER", "DOCTOR");
    const visits = await this.db
      .visits(p.tenantId)
      .list(
        { state: { $in: ["QUEUED", "IN_CONSULTATION"] } },
        { sort: { queueNumber: 1 }, limit: 100 },
      );
    const counts = await Promise.all([
      this.db.visits(p.tenantId).count({ state: "QUEUED" }),
      this.db.visits(p.tenantId).count({ state: "IN_CONSULTATION" }),
    ]);
    const items = await Promise.all(
      visits.map(async (v) => {
        const base = this.visitView(v);
        if (p.role === "DOCTOR") return base;
        const patient = await this.db
          .patients(p.tenantId)
          .findOne({ _id: v.patientId });
        return {
          ...base,
          patient_name: patient?.name ?? "Unavailable patient",
        };
      }),
    );
    return {
      items,
      queued_count: counts[0],
      in_consultation_count: counts[1],
      limit: 100,
    };
  }
  async cancel(
    p: Principal,
    id: string,
    input: { expected_version: number; reason: string },
    key: string,
    requestId: string,
  ) {
    this.authorize(p, "RECEPTIONIST", "OWNER");
    const visitId = await this.operations.execute(
      p,
      "visit.cancel",
      key,
      { id, ...input },
      async (s) => {
        const visit = await this.db.visits(p.tenantId).findOne({ _id: id }, s);
        check(visit, 404, "NOT_FOUND");
        const next = await this.db.visits(p.tenantId).update(
          { _id: id, state: "QUEUED", version: input.expected_version },
          {
            $set: {
              state: "CANCELLED",
              cancelledBy: p.userId,
              cancellationReason: input.reason,
            },
            $inc: { version: 1 },
          },
          s,
        );
        check(
          next,
          409,
          "CONFLICT",
          "Only a queued visit with the latest version can be cancelled.",
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "VISIT_CANCELLED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    const visit = await this.db.visits(p.tenantId).findOne({ _id: visitId });
    check(visit, 404, "NOT_FOUND");
    this.publish({
      tenantId: p.tenantId,
      visitId: visit._id,
      state: visit.state,
      version: visit.version,
    });
    return this.visitView(visit);
  }
  async recordVitals(
    p: Principal,
    visitId: string,
    input: VitalsInput,
    key: string,
    requestId: string,
  ) {
    this.authorize(p, "RECEPTIONIST");
    const id = await this.operations.execute(
      p,
      "vitals.record",
      key,
      { visitId, ...input },
      async (s) => {
        const visit = await this.db
          .visits(p.tenantId)
          .findOne({ _id: visitId }, s);
        check(visit, 404, "NOT_FOUND");
        check(
          visit.state === "QUEUED",
          409,
          "CONFLICT",
          "Vitals entry is restricted to queued visits.",
        );
        // Serialize recording with cancellation and later claim-next transitions.
        check(
          await this.db
            .visits(p.tenantId)
            .update(
              { _id: visitId, state: "QUEUED", version: visit.version },
              { $inc: { version: 1 } },
              s,
            ),
          409,
          "CONFLICT",
        );
        const entry = await this.db.vitals(p.tenantId).create(
          {
            visitId,
            patientId: visit.patientId,
            observations: input.observations,
            recordedBy: p.userId,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "VITALS_RECORDED",
          entry._id,
          requestId,
          s,
        );
        return entry._id;
      },
    );
    const entry = await this.db.vitals(p.tenantId).findOne({ _id: id });
    check(entry, 404, "NOT_FOUND");
    const latest = await this.db.visits(p.tenantId).findOne({ _id: visitId });
    if (latest)
      this.publish({
        tenantId: p.tenantId,
        visitId,
        state: latest.state,
        version: latest.version,
      });
    return {
      id: entry._id,
      visit_id: entry.visitId,
      observations: entry.observations,
      recorded_at: entry.createdAt,
    };
  }
  async vitals(p: Principal, visitId: string) {
    this.authorize(p, "RECEPTIONIST", "DOCTOR");
    const visit = await this.db.visits(p.tenantId).findOne({ _id: visitId });
    check(visit, 404, "NOT_FOUND");
    if (p.role === "DOCTOR")
      check(visit.doctorId === p.userId, 404, "NOT_FOUND");
    return (
      await this.db
        .vitals(p.tenantId)
        .list({ visitId }, { sort: { createdAt: -1, _id: -1 }, limit: 100 })
    ).map((v) => ({
      id: v._id,
      visit_id: v.visitId,
      observations: v.observations,
      recorded_at: v.createdAt,
    }));
  }
  async openCash(
    p: Principal,
    input: { opening_float: string; currency: "INR" },
    key: string,
    requestId: string,
  ) {
    this.authorize(p, "RECEPTIONIST");
    const openingFloatMinor = minorAmount(input.opening_float, 2),
      operationKey = digest(`${p.userId}:${key}`),
      requestHash = digest(JSON.stringify(input));
    const old = await this.db
      .cashSessions(p.tenantId)
      .findOne({ operationKey });
    if (old) {
      check(old.requestHash === requestHash, 409, "CONFLICT");
      return this.cashView(old);
    }
    const id = await this.operations.execute(
      p,
      "cash.open",
      key,
      input,
      async (s) => {
        check(
          !(await this.db
            .cashSessions(p.tenantId)
            .findOne({ receptionistId: p.userId, state: "OPEN" }, s)),
          409,
          "CONFLICT",
          "An opening float is already recorded for your open shift.",
        );
        const entry = await this.db.cashSessions(p.tenantId).create(
          {
            receptionistId: p.userId,
            currency: "INR",
            openingFloatMinor,
            state: "OPEN",
            openedAt: new Date(),
            operationKey,
            requestHash,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "CASH_FLOAT_OPENED",
          entry._id,
          requestId,
          s,
        );
        return entry._id;
      },
    );
    const entry = await this.db.cashSessions(p.tenantId).findOne({ _id: id });
    check(entry, 404, "NOT_FOUND");
    return this.cashView(entry);
  }
  private cashView(c: CashSession) {
    return cashView(c);
  }
  async cash(p: Principal) {
    this.authorize(p, "RECEPTIONIST", "OWNER");
    return (
      await this.db.cashSessions(p.tenantId).list(
        {
          ...(p.role === "RECEPTIONIST" ? { receptionistId: p.userId } : {}),
        },
        { sort: { openedAt: -1 }, limit: 100 },
      )
    ).map((c) => this.cashView(c));
  }
}
