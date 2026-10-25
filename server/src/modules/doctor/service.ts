import bcrypt from "bcryptjs";
import type { ClientSession } from "mongoose";
import type { Identity } from "../../auth.js";
import { check, type Principal } from "../../types.js";
import { digest } from "../../crypto.js";
import type { Visit } from "../reception/models.js";
import type { QueuePublisher } from "../reception/service.js";
import { Operations } from "../reception/operations.js";
import type { NoteInput, PrescriptionInput } from "./contracts.js";
import type { Prescription } from "./models.js";
export class Doctor {
  private ops: Operations;
  constructor(
    private identity: Identity,
    private publish: QueuePublisher = () => {},
  ) {
    this.ops = new Operations(identity.db);
  }
  private get db() {
    return this.identity.db;
  }
  private doctor(p: Principal) {
    check(p.purpose === "access" && p.role === "DOCTOR", 403, "FORBIDDEN");
  }
  private operationKey(p: Principal, key: string) {
    check(
      key.length >= 16 && key.length <= 128,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required.",
    );
    return digest(`${p.userId}:${key}`);
  }
  private async assigned(
    p: Principal,
    id: string,
    s?: ClientSession,
    active = false,
  ) {
    this.doctor(p);
    const v = await this.db
      .visits(p.tenantId)
      .findOne({ _id: id, doctorId: p.userId }, s);
    check(v, 404, "NOT_FOUND");
    if (active)
      check(
        v.state === "IN_CONSULTATION",
        409,
        "CONFLICT",
        "This encounter is no longer active.",
      );
    return v;
  }
  private async touch(p: Principal, id: string, s: ClientSession) {
    const v = await this.assigned(p, id, s, true);
    const next = await this.db.visits(p.tenantId).update(
      {
        _id: id,
        doctorId: p.userId,
        state: "IN_CONSULTATION",
        version: v.version,
      },
      { $inc: { version: 1 } },
      s,
    );
    check(next, 409, "CONFLICT");
    return next;
  }
  private visitView(v: Visit) {
    return {
      id: v._id,
      patient_id: v.patientId,
      state: v.state,
      queue_number: v.queueNumber,
      queued_at: v.queuedAt,
      claimed_at: v.claimedAt,
      completed_at: v.completedAt,
      version: v.version,
    };
  }
  private noteView(n: {
    _id: string;
    complaint: string;
    assessment: string;
    plan: string;
    version: number;
    state: string;
    finalizedAt: Date | null;
  }) {
    return {
      id: n._id,
      complaint: n.complaint,
      assessment: n.assessment,
      plan: n.plan,
      version: n.version,
      state: n.state,
      finalized_at: n.finalizedAt,
    };
  }
  private prescriptionView(p: Principal, rx: Prescription) {
    const clinical = {
      id: rx._id,
      visit_id: rx.visitId,
      patient_id: rx.patientId,
      revision: rx.revision,
      state: rx.state,
      items: rx.items,
      notes: rx.notes,
      version: rx.version,
      signed_at: rx.signedAt,
      signed_by: rx.signedBy,
      content_hash: rx.contentHash,
      source_id: rx.sourceId || null,
      revision_reason: rx.revisionReason,
      discard_reason: rx.discardReason,
    };
    if (p.role === "DOCTOR")
      return {
        ...clinical,
        lease_expires_at: rx.leaseExpiresAt,
        lease_owned:
          rx.leaseSessionId === p.sessionId && rx.leaseUserId === p.userId,
      };
    return clinical;
  }
  async list(p: Principal) {
    this.doctor(p);
    return (
      await this.db
        .visits(p.tenantId)
        .list(
          { doctorId: p.userId },
          { sort: { claimedAt: -1, _id: -1 }, limit: 50 },
        )
    ).map((v) => this.visitView(v));
  }
  async workspace(p: Principal) {
    this.doctor(p);
    const active = await this.db
      .visits(p.tenantId)
      .findOne({ doctorId: p.userId, state: "IN_CONSULTATION" });
    return {
      active: active ? await this.detail(p, active._id) : null,
      queued_count: await this.db.visits(p.tenantId).count({ state: "QUEUED" }),
    };
  }
  async detail(p: Principal, id: string) {
    const v = await this.assigned(p, id),
      patient = await this.db
        .patients(p.tenantId)
        .findOne({ _id: v.patientId });
    check(patient, 404, "NOT_FOUND");
    const [note, rx, vitals, lab, services, amendments] = await Promise.all([
      this.db.notes(p.tenantId).findOne({ visitId: id }),
      this.db
        .prescriptions(p.tenantId)
        .list({ visitId: id }, { sort: { revision: -1 }, limit: 100 }),
      this.db
        .vitals(p.tenantId)
        .list({ visitId: id }, { sort: { createdAt: -1 }, limit: 100 }),
      this.db
        .labOrders(p.tenantId)
        .list({ visitId: id }, { sort: { createdAt: -1 }, limit: 100 }),
      this.db
        .serviceOrders(p.tenantId)
        .list({ visitId: id }, { sort: { createdAt: -1 }, limit: 100 }),
      this.db
        .amendments(p.tenantId)
        .list({ visitId: id }, { sort: { createdAt: 1 }, limit: 100 }),
    ]);
    return {
      visit: this.visitView(v),
      patient: {
        id: patient._id,
        name: patient.name,
        date_of_birth: patient.dateOfBirth || null,
        contact: { type: patient.contactType, value: patient.contactValue },
      },
      consultation: note ? this.noteView(note) : null,
      prescriptions: rx.map((r) => this.prescriptionView(p, r)),
      vitals: vitals.map((entry) => ({
        id: entry._id,
        observations: entry.observations,
        recorded_at: entry.createdAt,
      })),
      lab_orders: lab.map((o) => this.labView(o)),
      service_orders: services.map((o) => ({
        id: o._id,
        name: o.name,
        instructions: o.instructions,
        state: o.state,
      })),
      amendments: amendments.map((a) => ({
        id: a._id,
        complaint: a.complaint,
        assessment: a.assessment,
        plan: a.plan,
        reason: a.reason,
        recorded_at: a.createdAt,
      })),
    };
  }
  async claim(p: Principal, key: string, requestId: string) {
    this.doctor(p);
    const claimKey = this.operationKey(p, key);
    const previous = await this.db
      .visits(p.tenantId)
      .findOne({ claimKey, doctorId: p.userId });
    if (previous) return this.detail(p, previous._id);
    const id = await this.ops.execute(p, "doctor.claim", key, {}, async (s) => {
      check(
        !(await this.db
          .visits(p.tenantId)
          .findOne({ doctorId: p.userId, state: "IN_CONSULTATION" }, s)),
        409,
        "ACTIVE_ENCOUNTER",
        "Complete your current encounter before calling another patient.",
      );
      const [first] = await this.db
        .visits(p.tenantId)
        .list({ state: "QUEUED" }, { sort: { queueNumber: 1 }, limit: 1 }, s);
      check(first, 409, "QUEUE_EMPTY", "No patients are waiting.");
      const v = await this.db.visits(p.tenantId).update(
        { _id: first._id, state: "QUEUED", version: first.version },
        {
          $set: {
            state: "IN_CONSULTATION",
            doctorId: p.userId,
            claimedAt: new Date(),
            claimKey,
          },
          $inc: { version: 1 },
        },
        s,
      );
      check(v, 409, "CONFLICT");
      await this.db.notes(p.tenantId).create(
        {
          visitId: v._id,
          patientId: v.patientId,
          doctorId: p.userId,
          complaint: "",
          assessment: "",
          plan: "",
          version: 0,
          state: "DRAFT",
        },
        s,
      );
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "VISIT_CLAIMED",
        v._id,
        requestId,
        s,
      );
      return v._id;
    });
    const detail = await this.detail(p, id);
    this.publish({
      tenantId: p.tenantId,
      visitId: id,
      state: detail.visit.state,
      version: detail.visit.version,
    });
    return detail;
  }
  async saveNote(
    p: Principal,
    id: string,
    input: NoteInput,
    requestId: string,
  ) {
    return this.db.transaction(async (s) => {
      await this.touch(p, id, s);
      const n = await this.db.notes(p.tenantId).update(
        {
          visitId: id,
          doctorId: p.userId,
          state: "DRAFT",
          version: input.expected_version,
        },
        {
          $set: {
            complaint: input.complaint,
            assessment: input.assessment,
            plan: input.plan,
          },
          $inc: { version: 1 },
        },
        s,
      );
      check(
        n,
        409,
        "CONFLICT",
        "The consultation was updated elsewhere. Reload before saving.",
      );
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "CONSULTATION_SAVED",
        id,
        requestId,
        s,
      );
      return this.noteView(n);
    });
  }
  async note(p: Principal, id: string) {
    await this.assigned(p, id);
    const n = await this.db.notes(p.tenantId).findOne({ visitId: id });
    check(n, 404, "NOT_FOUND");
    return this.noteView(n);
  }
  async createPrescription(
    p: Principal,
    visitId: string,
    key: string,
    requestId: string,
    sourceId?: string,
    reason = "",
  ) {
    this.doctor(p);
    const operationKey = this.operationKey(p, key);
    const old = await this.db
      .prescriptions(p.tenantId)
      .findOne({ operationKey, authorId: p.userId });
    if (old) {
      check(
        old.visitId === visitId &&
          old.sourceId === (sourceId ?? "") &&
          old.revisionReason === reason,
        409,
        "CONFLICT",
      );
      return this.prescriptionView(p, old);
    }
    const id = await this.ops.execute(
      p,
      "prescription.create",
      key,
      { visitId, sourceId: sourceId ?? "", reason },
      async (s) => {
        await this.touch(p, visitId, s);
        check(
          !(await this.db
            .prescriptions(p.tenantId)
            .findOne({ visitId, state: "DRAFT" }, s)),
          409,
          "CONFLICT",
          "A prescription draft already exists.",
        );
        const [latest] = await this.db
          .prescriptions(p.tenantId)
          .list({ visitId }, { sort: { revision: -1 }, limit: 1 }, s);
        const [latestSigned] = await this.db
          .prescriptions(p.tenantId)
          .list(
            { visitId, state: "SIGNED" },
            { sort: { revision: -1 }, limit: 1 },
            s,
          );
        let source: Prescription | null = null;
        if (sourceId) {
          source = await this.db
            .prescriptions(p.tenantId)
            .findOne(
              { _id: sourceId, visitId, authorId: p.userId, state: "SIGNED" },
              s,
            );
          check(
            source && latestSigned?._id === sourceId,
            409,
            "CONFLICT",
            "Create a revision from the latest signed prescription.",
          );
        } else
          check(
            !latestSigned,
            409,
            "CONFLICT",
            "Use a signed prescription revision to create another draft.",
          );
        const v = await this.assigned(p, visitId, s, true);
        const rx = await this.db.prescriptions(p.tenantId).create(
          {
            visitId,
            patientId: v.patientId,
            authorId: p.userId,
            revision: (latest?.revision ?? 0) + 1,
            state: "DRAFT",
            items: source?.items ?? [],
            notes: source?.notes ?? "",
            version: 0,
            leaseUserId: "",
            leaseSessionId: "",
            leaseExpiresAt: null,
            operationKey,
            sourceId: sourceId ?? "",
            revisionReason: reason,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "PRESCRIPTION_DRAFT_CREATED",
          rx._id,
          requestId,
          s,
        );
        return rx._id;
      },
    );
    return this.prescription(p, id);
  }
  async prescription(p: Principal, id: string) {
    check(
      p.purpose === "access" &&
        ["DOCTOR", "PHARMACIST", "PATIENT"].includes(p.role),
      403,
      "FORBIDDEN",
    );
    const rx = await this.db.prescriptions(p.tenantId).findOne({ _id: id });
    check(rx, 404, "NOT_FOUND");
    if (p.role === "DOCTOR") await this.assigned(p, rx.visitId);
    else {
      check(rx.state === "SIGNED", 404, "NOT_FOUND");
      if (p.role === "PATIENT")
        check(
          await this.db
            .patients(p.tenantId)
            .findOne({ _id: rx.patientId, userId: p.userId }),
          404,
          "NOT_FOUND",
        );
    }
    return this.prescriptionView(p, rx);
  }
  async revision(
    p: Principal,
    id: string,
    reason: string,
    key: string,
    requestId: string,
  ) {
    this.doctor(p);
    const source = await this.db
      .prescriptions(p.tenantId)
      .findOne({ _id: id, authorId: p.userId });
    check(source, 404, "NOT_FOUND");
    return this.createPrescription(
      p,
      source.visitId,
      key,
      requestId,
      id,
      reason,
    );
  }
  async lease(p: Principal, id: string, version: number, renew: boolean) {
    this.doctor(p);
    check(p.sessionId, 401, "AUTH_INVALID");
    return this.db.transaction(async (s) => {
      const rx = await this.db
        .prescriptions(p.tenantId)
        .findOne({ _id: id, authorId: p.userId }, s);
      check(rx, 404, "NOT_FOUND");
      await this.touch(p, rx.visitId, s);
      const now = new Date();
      const permitted = renew
        ? {
            leaseUserId: p.userId,
            leaseSessionId: p.sessionId,
            leaseExpiresAt: { $gt: now },
          }
        : {
            $or: [
              { leaseExpiresAt: null },
              { leaseExpiresAt: { $lte: now } },
              { leaseUserId: p.userId, leaseSessionId: p.sessionId },
            ],
          };
      const next = await this.db.prescriptions(p.tenantId).update(
        { _id: id, state: "DRAFT", version, ...permitted },
        {
          $set: {
            leaseUserId: p.userId,
            leaseSessionId: p.sessionId,
            leaseExpiresAt: new Date(Date.now() + 120000),
          },
          $inc: { version: 1 },
        },
        s,
      );
      check(
        next,
        409,
        "LEASE_CONFLICT",
        "The draft changed or its lease belongs to another session. Reacquire or reload.",
      );
      return this.prescriptionView(p, next);
    });
  }
  async savePrescription(
    p: Principal,
    id: string,
    input: PrescriptionInput,
    requestId: string,
  ) {
    this.doctor(p);
    return this.db.transaction(async (s) => {
      const rx = await this.db
        .prescriptions(p.tenantId)
        .findOne({ _id: id, authorId: p.userId }, s);
      check(rx, 404, "NOT_FOUND");
      await this.touch(p, rx.visitId, s);
      const next = await this.db.prescriptions(p.tenantId).update(
        {
          _id: id,
          state: "DRAFT",
          version: input.expected_version,
          leaseUserId: p.userId,
          leaseSessionId: p.sessionId,
          leaseExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            items: input.items,
            notes: input.notes,
            leaseExpiresAt: new Date(Date.now() + 120000),
          },
          $inc: { version: 1 },
        },
        s,
      );
      check(
        next,
        409,
        "LEASE_CONFLICT",
        "The draft lease expired or the content changed. Reload and reacquire it.",
      );
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "PRESCRIPTION_DRAFT_SAVED",
        id,
        requestId,
        s,
      );
      return this.prescriptionView(p, next);
    });
  }
  private async passwordProof(
    p: Principal,
    password: string,
    requestId: string,
  ) {
    this.doctor(p);
    await this.db.checkLimit(
      `doctor-sign:${p.tenantId}:${p.userId}`,
      5,
      15 * 60000,
    );
    const u = await this.db.users(p.tenantId).findOne({
      _id: p.userId,
      status: "ACTIVE",
      role: "DOCTOR",
      credentialVersion: p.version,
    });
    if (
      !u ||
      Buffer.byteLength(password) > 72 ||
      !(await bcrypt.compare(password, u.passwordHash))
    ) {
      await this.db.limit(
        `doctor-sign:${p.tenantId}:${p.userId}`,
        5,
        15 * 60000,
      );
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "CLINICAL_REAUTH_FAILED",
        p.userId,
        requestId,
        undefined,
        "DENIED",
      );
      check(
        false,
        401,
        "AUTH_INVALID",
        "Current password verification failed.",
      );
    }
    return u.passwordHash;
  }
  private async lockCredentials(p: Principal, hash: string, s: ClientSession) {
    check(
      await this.db.users(p.tenantId).update(
        {
          _id: p.userId,
          status: "ACTIVE",
          role: "DOCTOR",
          credentialVersion: p.version,
          passwordHash: hash,
        },
        { $inc: { challengeVersion: 1 } },
        s,
      ),
      401,
      "AUTH_INVALID",
    );
  }
  async sign(
    p: Principal,
    id: string,
    version: number,
    password: string,
    key: string,
    requestId: string,
  ) {
    const hash = await this.passwordProof(p, password, requestId);
    const result = await this.ops.execute(
      p,
      "prescription.sign",
      key,
      { id, version },
      async (s) => {
        await this.lockCredentials(p, hash, s);
        const rx = await this.db
          .prescriptions(p.tenantId)
          .findOne({ _id: id, authorId: p.userId }, s);
        check(rx, 404, "NOT_FOUND");
        await this.touch(p, rx.visitId, s);
        check(
          rx.items.length > 0,
          400,
          "VALIDATION_ERROR",
          "Add at least one complete medicine before signing.",
        );
        const contentHash = digest(
          JSON.stringify({
            visitId: rx.visitId,
            patientId: rx.patientId,
            authorId: rx.authorId,
            revision: rx.revision,
            items: rx.items,
            notes: rx.notes,
          }),
        );
        const next = await this.db.prescriptions(p.tenantId).update(
          {
            _id: id,
            state: "DRAFT",
            version,
            leaseUserId: p.userId,
            leaseSessionId: p.sessionId,
            leaseExpiresAt: { $gt: new Date() },
          },
          {
            $set: {
              state: "SIGNED",
              signedBy: p.userId,
              signedAt: new Date(),
              contentHash,
              leaseUserId: "",
              leaseSessionId: "",
              leaseExpiresAt: null,
            },
            $inc: { version: 1 },
          },
          s,
        );
        check(
          next,
          409,
          "LEASE_CONFLICT",
          "Signing requires the current draft version and an active lease.",
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "PRESCRIPTION_SIGNED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return this.prescription(p, result);
  }
  async discard(
    p: Principal,
    id: string,
    version: number,
    reason: string,
    key: string,
    requestId: string,
  ) {
    this.doctor(p);
    const resource = await this.ops.execute(
      p,
      "prescription.discard",
      key,
      { id, version, reason },
      async (s) => {
        const rx = await this.db
          .prescriptions(p.tenantId)
          .findOne({ _id: id, authorId: p.userId }, s);
        check(rx, 404, "NOT_FOUND");
        await this.touch(p, rx.visitId, s);
        const next = await this.db.prescriptions(p.tenantId).update(
          {
            _id: id,
            state: "DRAFT",
            version,
            leaseUserId: p.userId,
            leaseSessionId: p.sessionId,
            leaseExpiresAt: { $gt: new Date() },
          },
          {
            $set: {
              state: "DISCARDED",
              discardReason: reason,
              leaseUserId: "",
              leaseSessionId: "",
              leaseExpiresAt: null,
            },
            $inc: { version: 1 },
          },
          s,
        );
        check(
          next,
          409,
          "LEASE_CONFLICT",
          "Only an unsigned draft with your active edit lease can be discarded.",
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "PRESCRIPTION_DRAFT_DISCARDED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return this.prescription(p, resource);
  }
  private labView(o: {
    _id: string;
    visitId: string;
    patientId: string;
    doctorId: string;
    tests: unknown;
    state: string;
    createdAt?: Date;
  }) {
    return {
      id: o._id,
      visit_id: o.visitId,
      patient_id: o.patientId,
      requesting_doctor_id: o.doctorId,
      tests: o.tests,
      state: o.state,
      ordered_at: o.createdAt,
    };
  }
  async orderLab(
    p: Principal,
    input: {
      visit_id: string;
      tests: { name: string; instructions?: string }[];
    },
    key: string,
    requestId: string,
  ) {
    this.doctor(p);
    const operationKey = this.operationKey(p, key),
      old = await this.db
        .labOrders(p.tenantId)
        .findOne({ operationKey, doctorId: p.userId });
    if (old) {
      check(
        old.visitId === input.visit_id &&
          JSON.stringify(old.tests) === JSON.stringify(input.tests),
        409,
        "CONFLICT",
      );
      return this.labView(old);
    }
    const id = await this.ops.execute(p, "lab.order", key, input, async (s) => {
      const v = await this.touch(p, input.visit_id, s);
      const o = await this.db.labOrders(p.tenantId).create(
        {
          visitId: v._id,
          patientId: v.patientId,
          doctorId: p.userId,
          tests: input.tests,
          state: "ORDERED",
          operationKey,
        },
        s,
      );
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "LAB_ORDERED",
        o._id,
        requestId,
        s,
      );
      return o._id;
    });
    const order = await this.db.labOrders(p.tenantId).findOne({ _id: id });
    check(order, 404, "NOT_FOUND");
    return this.labView(order);
  }
  async labs(p: Principal) {
    check(
      p.purpose === "access" && ["DOCTOR", "LAB"].includes(p.role),
      403,
      "FORBIDDEN",
    );
    return (
      await this.db
        .labOrders(p.tenantId)
        .list(
          { ...(p.role === "DOCTOR" ? { doctorId: p.userId } : {}) },
          { sort: { createdAt: -1, _id: -1 }, limit: 100 },
        )
    ).map((o) => this.labView(o));
  }
  async orderService(
    p: Principal,
    id: string,
    input: { name: string; instructions?: string },
    key: string,
    requestId: string,
  ) {
    this.doctor(p);
    const operationKey = this.operationKey(p, key);
    const previous = await this.db
      .serviceOrders(p.tenantId)
      .findOne({ operationKey, doctorId: p.userId });
    if (previous) {
      check(
        previous.visitId === id &&
          previous.name === input.name &&
          previous.instructions === (input.instructions ?? ""),
        409,
        "CONFLICT",
      );
      return {
        id: previous._id,
        name: previous.name,
        instructions: previous.instructions,
        state: previous.state,
      };
    }
    const orderId = await this.ops.execute(
      p,
      "service.order",
      key,
      { id, ...input },
      async (s) => {
        const v = await this.touch(p, id, s);
        const order = await this.db.serviceOrders(p.tenantId).create(
          {
            visitId: id,
            patientId: v.patientId,
            doctorId: p.userId,
            name: input.name,
            instructions: input.instructions ?? "",
            state: "ORDERED",
            operationKey,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "SERVICE_ORDERED",
          order._id,
          requestId,
          s,
        );
        return order._id;
      },
    );
    const order = await this.db
      .serviceOrders(p.tenantId)
      .findOne({ _id: orderId });
    check(order, 404, "NOT_FOUND");
    return {
      id: order._id,
      name: order.name,
      instructions: order.instructions,
      state: order.state,
    };
  }
  async complete(
    p: Principal,
    id: string,
    version: number,
    key: string,
    requestId: string,
  ) {
    this.doctor(p);
    const completeKey = this.operationKey(p, key);
    const old = await this.assigned(p, id);
    if (old.state === "COMPLETED") {
      check(
        old.completionKey === completeKey &&
          old.completionRequestHash === digest(JSON.stringify({ id, version })),
        409,
        "CONFLICT",
        "This encounter is already completed.",
      );
      return this.visitView(old);
    }
    const resource = await this.ops.execute(
      p,
      "visit.complete",
      key,
      { id, version },
      async (s) => {
        const v = await this.assigned(p, id, s, true);
        const n = await this.db
          .notes(p.tenantId)
          .findOne({ visitId: id, doctorId: p.userId, state: "DRAFT" }, s);
        check(
          n && n.complaint.trim() && n.assessment.trim(),
          400,
          "VALIDATION_ERROR",
          "Save the presenting complaint and assessment before completing.",
        );
        check(
          !(await this.db
            .prescriptions(p.tenantId)
            .findOne({ visitId: id, state: "DRAFT" }, s)),
          409,
          "UNSIGNED_DRAFT",
          "Sign the prescription draft before completing this encounter.",
        );
        const next = await this.db.visits(p.tenantId).update(
          { _id: id, doctorId: p.userId, state: "IN_CONSULTATION", version },
          {
            $set: {
              state: "COMPLETED",
              completedAt: new Date(),
              completionKey: completeKey,
              completionRequestHash: digest(JSON.stringify({ id, version })),
            },
            $inc: { version: 1 },
          },
          s,
        );
        check(
          next,
          409,
          "CONFLICT",
          "Encounter changed. Reload before completing.",
        );
        await this.db.notes(p.tenantId).update(
          { _id: n._id, state: "DRAFT" },
          {
            $set: { state: "FINAL", finalizedAt: new Date() },
            $inc: { version: 1 },
          },
          s,
        );
        await this.db.usage(p.tenantId).create(
          {
            meter: "COMPLETED_CONSULTATION",
            sourceId: v._id,
            quantity: 1,
            unit: "encounter",
            effectiveAt: new Date(),
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "CONSULTATION_COMPLETED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    const done = await this.assigned(p, resource);
    this.publish({
      tenantId: p.tenantId,
      visitId: resource,
      state: done.state,
      version: done.version,
    });
    return this.visitView(done);
  }
  async amend(
    p: Principal,
    id: string,
    input: {
      complaint: string;
      assessment: string;
      plan: string;
      reason: string;
      password: string;
    },
    key: string,
    requestId: string,
  ) {
    const hash = await this.passwordProof(p, input.password, requestId);
    const fields = {
      complaint: input.complaint,
      assessment: input.assessment,
      plan: input.plan,
      reason: input.reason,
    };
    const amendmentId = await this.ops.execute(
      p,
      "consultation.amend",
      key,
      { id, ...fields },
      async (s) => {
        await this.lockCredentials(p, hash, s);
        const v = await this.assigned(p, id, s);
        check(
          v.state === "COMPLETED",
          409,
          "CONFLICT",
          "Amendments apply only to completed encounters.",
        );
        const n = await this.db
          .notes(p.tenantId)
          .findOne({ visitId: id, state: "FINAL" }, s);
        check(n, 404, "NOT_FOUND");
        const a = await this.db.amendments(p.tenantId).create(
          {
            visitId: id,
            noteId: n._id,
            doctorId: p.userId,
            ...fields,
            operationKey: this.operationKey(p, key),
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "CONSULTATION_AMENDED",
          a._id,
          requestId,
          s,
        );
        return a._id;
      },
    );
    const a = await this.db
      .amendments(p.tenantId)
      .findOne({ _id: amendmentId });
    check(a, 404, "NOT_FOUND");
    return {
      id: a._id,
      complaint: a.complaint,
      assessment: a.assessment,
      plan: a.plan,
      reason: a.reason,
      recorded_at: a.createdAt,
    };
  }
}
