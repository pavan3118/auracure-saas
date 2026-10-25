import type { Identity } from "../../auth.js";
import { check, type Principal } from "../../types.js";
import { Doctor } from "../doctor/service.js";
import { Laboratory } from "../laboratory/service.js";
import { Billing } from "../billing/service.js";
export class Portal {
  constructor(private identity: Identity) {}
  async patient(p: Principal) {
    check(p.role === "PATIENT" && p.purpose === "access", 403, "FORBIDDEN");
    const u = await this.identity.db.users(p.tenantId).findOne({
      _id: p.userId,
      role: "PATIENT",
      status: "ACTIVE",
      contactVerified: true,
      credentialVersion: p.version,
    });
    const patient = u
      ? await this.identity.db
          .patients(p.tenantId)
          .findOne({ userId: p.userId })
      : null;
    check(patient, 404, "NOT_FOUND");
    return patient;
  }
  async overview(p: Principal) {
    const pat = await this.patient(p),
      db = this.identity.db;
    const [visits, rxs, labs, invoices, documents] = await Promise.all([
      db
        .visits(p.tenantId)
        .list(
          { patientId: pat._id },
          { sort: { queuedAt: -1, _id: -1 }, limit: 100 },
        ),
      db
        .prescriptions(p.tenantId)
        .list(
          { patientId: pat._id, state: "SIGNED" },
          { sort: { createdAt: -1, _id: -1 }, limit: 100 },
        ),
      db
        .labOrders(p.tenantId)
        .list(
          { patientId: pat._id },
          { sort: { createdAt: -1, _id: -1 }, limit: 100 },
        ),
      new Billing(this.identity).list(p),
      db
        .documents(p.tenantId)
        .list(
          { patientId: pat._id },
          { sort: { createdAt: -1, _id: -1 }, limit: 100 },
        ),
    ]);
    return {
      profile: {
        id: pat._id,
        name: pat.name,
        date_of_birth: pat.dateOfBirth || null,
        contact: { type: pat.contactType, value: pat.contactValue },
      },
      visits: visits.map((v) => ({
        id: v._id,
        state: v.state,
        queue_number: v.queueNumber,
        queued_at: v.queuedAt,
        completed_at: v.completedAt,
      })),
      prescriptions: rxs.map((r) => ({
        id: r._id,
        visit_id: r.visitId,
        revision: r.revision,
        signed_at: r.signedAt,
      })),
      lab_orders: labs.map((o) => ({
        id: o._id,
        state: o.state,
        tests: o.tests.map((t) => ({ name: t.name })),
        released_result_id: o.state === "RELEASED" ? o.currentResultId : null,
      })),
      invoices,
      documents: documents
        .filter(
          (d) =>
            d.kind !== "LAB_RESULT" ||
            labs.some(
              (o) => o.state === "RELEASED" && o.currentResultId === d.sourceId,
            ),
        )
        .map((d) => ({
          id: d._id,
          kind: d.kind,
          source_id: d.sourceId,
          size_bytes: d.sizeBytes,
          created_at: d.createdAt,
        })),
      limit: 100,
    };
  }
  async source(
    p: Principal,
    kind: "PRESCRIPTION" | "LAB_RESULT" | "INVOICE",
    id: string,
  ) {
    const pat = await this.patient(p);
    if (kind === "PRESCRIPTION")
      return {
        patient: pat,
        data: await new Doctor(this.identity).prescription(p, id),
      };
    if (kind === "LAB_RESULT")
      return {
        patient: pat,
        data: await new Laboratory(this.identity).result(p, id),
      };
    const invoice = await new Billing(this.identity).get(p, id);
    check(
      invoice.state !== "VOID",
      409,
      "DOCUMENT_UNAVAILABLE",
      "Voided invoices cannot be exported.",
    );
    return { patient: pat, data: invoice };
  }
}
