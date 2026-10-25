import type { ClientSession } from "mongoose";
import type { Identity } from "../../auth.js";
import { check, type Principal } from "../../types.js";
import { digest } from "../../crypto.js";
import { Operations } from "../reception/operations.js";
import { Proofs } from "../billing/security.js";
import type { LabResult, LabObservation } from "./models.js";
export interface ResultInput {
  observations: {
    name: string;
    value: string;
    unit: string;
    reference_interval: string;
    comments: string;
  }[];
  comments: string;
  correction_reason: string;
}
export class Laboratory {
  private ops: Operations;
  private proofs: Proofs;
  constructor(private identity: Identity) {
    this.ops = new Operations(identity.db);
    this.proofs = new Proofs(identity);
  }
  private get db() {
    return this.identity.db;
  }
  private role(p: Principal, ...roles: Principal["role"][]) {
    check(p.purpose === "access" && roles.includes(p.role), 403, "FORBIDDEN");
  }
  private async order(p: Principal, id: string, s?: ClientSession) {
    this.role(p, "LAB", "DOCTOR", "PATIENT");
    const o = await this.db.labOrders(p.tenantId).findOne({ _id: id }, s);
    check(o, 404, "NOT_FOUND");
    if (p.role === "DOCTOR") check(o.doctorId === p.userId, 404, "NOT_FOUND");
    if (p.role === "PATIENT")
      check(
        await this.db
          .patients(p.tenantId)
          .findOne({ _id: o.patientId, userId: p.userId }, s),
        404,
        "NOT_FOUND",
      );
    return o;
  }
  private async bump(
    p: Principal,
    id: string,
    version: number,
    s: ClientSession,
    changes: Record<string, unknown> = {},
  ) {
    const next = await this.db.labOrders(p.tenantId).update(
      {
        _id: id,
        $or: [
          { version },
          ...(version === 0 ? [{ version: { $exists: false } }] : []),
        ],
      },
      { $set: changes, $inc: { version: 1 } },
      s,
    );
    check(
      next,
      409,
      "CONFLICT",
      "Laboratory order changed. Reload before continuing.",
    );
    return next;
  }
  private view(r: LabResult) {
    return {
      id: r._id,
      order_id: r.orderId,
      visit_id: r.visitId,
      patient_id: r.patientId,
      revision: r.revision,
      state: r.state,
      observations: r.observations.map((o) => ({
        name: o.name,
        value: o.value,
        unit: o.unit,
        reference_interval: o.referenceInterval,
        comments: o.comments,
      })),
      comments: r.comments,
      correction_reason: r.correctionReason,
      version: r.version,
      content_hash: r.contentHash,
      signed_by: r.signedBy,
      verified_by: r.verifiedBy,
      released_by: r.releasedBy,
      signed_at: r.signedAt,
      verified_at: r.verifiedAt,
      released_at: r.releasedAt,
    };
  }
  private observations(input: ResultInput["observations"]): LabObservation[] {
    return input.map((o) => ({
      name: o.name,
      value: o.value,
      unit: o.unit,
      referenceInterval: o.reference_interval,
      comments: o.comments,
    }));
  }
  async list(p: Principal) {
    this.role(p, "LAB", "DOCTOR");
    const rows = await this.db
      .labOrders(p.tenantId)
      .list(
        { ...(p.role === "DOCTOR" ? { doctorId: p.userId } : {}) },
        { sort: { createdAt: -1, _id: -1 }, limit: 100 },
      );
    return Promise.all(
      rows.map(async (o) => {
        const patient = await this.db
          .patients(p.tenantId)
          .findOne({ _id: o.patientId });
        return {
          id: o._id,
          patient_id: o.patientId,
          patient_name: patient?.name ?? "Unavailable patient",
          requesting_doctor_id: o.doctorId,
          tests: o.tests,
          state: o.state,
          version: o.version ?? 0,
          current_result_id: o.currentResultId || null,
        };
      }),
    );
  }
  async collect(
    p: Principal,
    id: string,
    version: number,
    key: string,
    requestId: string,
  ) {
    this.role(p, "LAB");
    const rid = await this.ops.execute(
      p,
      "lab.collect",
      key,
      { id, version },
      async (s) => {
        const o = await this.order(p, id, s);
        check(
          o.state === "ORDERED",
          409,
          "CONFLICT",
          "Only an ordered test can be collected.",
        );
        await this.bump(p, id, version, s, { state: "COLLECTED" });
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "LAB_SAMPLE_COLLECTED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return (await this.list(p)).find((o) => o.id === rid) ?? { id: rid };
  }
  async create(
    p: Principal,
    id: string,
    input: ResultInput,
    key: string,
    requestId: string,
  ) {
    this.role(p, "LAB");
    const rid = await this.ops.execute(
      p,
      "lab.result-create",
      key,
      { id, ...input },
      async (s) => {
        const o = await this.order(p, id, s);
        check(
          ["COLLECTED", "TECH_SIGNED", "DOCTOR_VERIFIED", "RELEASED"].includes(
            o.state,
          ),
          409,
          "CONFLICT",
          "Collect the sample first, or edit the current draft.",
        );
        const [latest] = await this.db
          .labResults(p.tenantId)
          .list({ orderId: id }, { sort: { revision: -1 }, limit: 1 }, s);
        check(
          !latest || input.correction_reason.length >= 3,
          400,
          "CORRECTION_REASON_REQUIRED",
          "Explain a new revision of a previously signed result.",
        );
        const r = await this.db.labResults(p.tenantId).create(
          {
            orderId: id,
            visitId: o.visitId,
            patientId: o.patientId,
            doctorId: o.doctorId,
            revision: (latest?.revision ?? 0) + 1,
            state: "RESULT_DRAFT",
            observations: this.observations(input.observations),
            comments: input.comments,
            correctionReason: input.correction_reason,
            version: 0,
            operationKey: digest(`${p.userId}:${key}`),
          },
          s,
        );
        await this.bump(p, id, o.version ?? 0, s, {
          state: "RESULT_DRAFT",
          currentResultId: r._id,
        });
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "LAB_RESULT_DRAFT_CREATED",
          r._id,
          requestId,
          s,
        );
        return r._id;
      },
    );
    return this.result(p, rid);
  }
  async result(p: Principal, id: string) {
    this.role(p, "LAB", "DOCTOR", "PATIENT");
    const r = await this.db.labResults(p.tenantId).findOne({ _id: id });
    check(r, 404, "NOT_FOUND");
    const o = await this.order(p, r.orderId);
    if (p.role === "PATIENT")
      check(
        r.state === "RELEASED" &&
          o.state === "RELEASED" &&
          o.currentResultId === id,
        404,
        "NOT_FOUND",
      );
    return this.view(r);
  }
  async history(p: Principal, id: string) {
    this.role(p, "LAB", "DOCTOR");
    await this.order(p, id);
    return (
      await this.db
        .labResults(p.tenantId)
        .list({ orderId: id }, { sort: { revision: -1 }, limit: 100 })
    ).map((r) => this.view(r));
  }
  async update(
    p: Principal,
    id: string,
    input: Omit<ResultInput, "correction_reason"> & {
      expected_version: number;
    },
    requestId: string,
  ) {
    this.role(p, "LAB");
    await this.db.transaction(async (s) => {
      const r = await this.db.labResults(p.tenantId).findOne({ _id: id }, s);
      check(r, 404, "NOT_FOUND");
      const o = await this.order(p, r.orderId, s);
      check(
        o.currentResultId === id && o.state === "RESULT_DRAFT",
        409,
        "CONFLICT",
      );
      const next = await this.db.labResults(p.tenantId).update(
        { _id: id, state: "RESULT_DRAFT", version: input.expected_version },
        {
          $set: {
            observations: this.observations(input.observations),
            comments: input.comments,
          },
          $inc: { version: 1 },
        },
        s,
      );
      check(
        next,
        409,
        "CONFLICT",
        "Only the latest unsigned result draft can be edited.",
      );
      await this.bump(p, o._id, o.version ?? 0, s);
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "LAB_RESULT_DRAFT_UPDATED",
        id,
        requestId,
        s,
      );
    });
    return this.result(p, id);
  }
  async sign(
    p: Principal,
    id: string,
    version: number,
    pin: string,
    key: string,
    requestId: string,
  ) {
    this.role(p, "LAB");
    const proof = await this.proofs.verify(p, pin, "pin", requestId);
    const rid = await this.ops.execute(
      p,
      "lab.sign",
      key,
      { id, version },
      async (s) => {
        await proof(s);
        const r = await this.db.labResults(p.tenantId).findOne({ _id: id }, s);
        check(r, 404, "NOT_FOUND");
        const o = await this.order(p, r.orderId, s);
        check(
          o.currentResultId === id && o.state === "RESULT_DRAFT",
          409,
          "CONFLICT",
        );
        const contentHash = digest(
          JSON.stringify({
            orderId: r.orderId,
            revision: r.revision,
            observations: r.observations,
            comments: r.comments,
          }),
        );
        check(
          await this.db.labResults(p.tenantId).update(
            { _id: id, state: "RESULT_DRAFT", version },
            {
              $set: {
                state: "TECH_SIGNED",
                signedBy: p.userId,
                signedAt: new Date(),
                contentHash,
              },
              $inc: { version: 1 },
            },
            s,
          ),
          409,
          "CONFLICT",
        );
        await this.bump(p, o._id, o.version ?? 0, s, { state: "TECH_SIGNED" });
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "LAB_RESULT_SIGNED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return this.result(p, rid);
  }
  async verify(
    p: Principal,
    id: string,
    version: number,
    password: string,
    key: string,
    requestId: string,
  ) {
    this.role(p, "DOCTOR");
    const proof = await this.proofs.verify(p, password, "password", requestId);
    const rid = await this.ops.execute(
      p,
      "lab.verify",
      key,
      { id, version },
      async (s) => {
        await proof(s);
        const r = await this.db
          .labResults(p.tenantId)
          .findOne({ _id: id, doctorId: p.userId }, s);
        check(r, 404, "NOT_FOUND");
        const o = await this.order(p, r.orderId, s);
        check(
          o.currentResultId === id && o.state === "TECH_SIGNED",
          409,
          "CONFLICT",
          "Only the latest technician-signed revision may be verified.",
        );
        check(
          await this.db.labResults(p.tenantId).update(
            { _id: id, state: "TECH_SIGNED", version },
            {
              $set: {
                state: "DOCTOR_VERIFIED",
                verifiedBy: p.userId,
                verifiedAt: new Date(),
              },
              $inc: { version: 1 },
            },
            s,
          ),
          409,
          "CONFLICT",
        );
        await this.bump(p, o._id, o.version ?? 0, s, {
          state: "DOCTOR_VERIFIED",
        });
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "LAB_RESULT_VERIFIED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return this.result(p, rid);
  }
  async release(
    p: Principal,
    id: string,
    version: number,
    key: string,
    requestId: string,
  ) {
    this.role(p, "LAB");
    const rid = await this.ops.execute(
      p,
      "lab.release",
      key,
      { id, version },
      async (s) => {
        const r = await this.db.labResults(p.tenantId).findOne({ _id: id }, s);
        check(r, 404, "NOT_FOUND");
        const o = await this.order(p, r.orderId, s);
        check(
          o.currentResultId === id && o.state === "DOCTOR_VERIFIED",
          409,
          "DOCTOR_VERIFICATION_REQUIRED",
          "The requesting doctor must verify this exact revision before release.",
        );
        check(
          await this.db.labResults(p.tenantId).update(
            { _id: id, state: "DOCTOR_VERIFIED", version },
            {
              $set: {
                state: "RELEASED",
                releasedBy: p.userId,
                releasedAt: new Date(),
              },
              $inc: { version: 1 },
            },
            s,
          ),
          409,
          "CONFLICT",
        );
        await this.bump(p, o._id, o.version ?? 0, s, { state: "RELEASED" });
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "LAB_RESULT_RELEASED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return this.result(p, rid);
  }
}
