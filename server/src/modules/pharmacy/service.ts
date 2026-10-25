import type { ClientSession } from "mongoose";
import type { Identity } from "../../auth.js";
import { check, type Principal } from "../../types.js";
import { digest } from "../../crypto.js";
import { Operations } from "../reception/operations.js";
import { Proofs } from "../billing/security.js";
import type { Batch, Substitution, DispenseAllocation } from "./models.js";
export const productKey = (p: {
  medicine: string;
  strength: string;
  route: string;
  unit: string;
}) =>
  digest(
    JSON.stringify(
      [p.medicine, p.strength, p.route, p.unit].map((v) =>
        v.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
      ),
    ),
  );
export function pharmacyDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
}
export class Pharmacy {
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
  private async pharmacist(p: Principal, s?: ClientSession) {
    this.role(p, "PHARMACIST");
    const user = await this.db.users(p.tenantId).findOne(
      {
        _id: p.userId,
        status: "ACTIVE",
        role: "PHARMACIST",
        credentialVersion: p.version,
        licenceStatus: "VERIFIED",
      },
      s,
    );
    check(
      user,
      403,
      "LICENCE_UNVERIFIED",
      "A verified pharmacist licence is required.",
    );
    if (s)
      check(
        await this.db.users(p.tenantId).update(
          {
            _id: p.userId,
            licenceStatus: "VERIFIED",
            credentialVersion: p.version,
            status: "ACTIVE",
          },
          { $inc: { challengeVersion: 1 } },
          s,
        ),
        403,
        "LICENCE_UNVERIFIED",
      );
  }
  private key(p: Principal, k: string) {
    check(k.length >= 16 && k.length <= 128, 400, "VALIDATION_ERROR");
    return digest(`${p.userId}:${k}`);
  }
  private batchView(b: Batch) {
    return {
      id: b._id,
      medicine: b.medicine,
      strength: b.strength,
      route: b.route,
      unit: b.unit,
      batch_number: b.batchNumber,
      expiry_date: b.expiryDate,
      quantity: b.quantity,
      version: b.version,
      expired: b.expiryDate < pharmacyDate(),
    };
  }
  async batches(p: Principal) {
    this.role(p, "OWNER", "PHARMACIST");
    return (
      await this.db
        .batches(p.tenantId)
        .list({}, { sort: { expiryDate: 1, _id: 1 }, limit: 100 })
    ).map((b) => this.batchView(b));
  }
  async receive(
    p: Principal,
    input: {
      medicine: string;
      strength: string;
      route: string;
      unit: string;
      batch_number: string;
      expiry_date: string;
      quantity: number;
    },
    key: string,
    requestId: string,
  ) {
    await this.pharmacist(p);
    const operationKey = this.key(p, key),
      requestHash = digest(JSON.stringify(input)),
      prior = await this.db.batches(p.tenantId).findOne({ operationKey });
    if (prior) {
      check(prior.requestHash === requestHash, 409, "CONFLICT");
      return this.batchView(prior);
    }
    const id = await this.ops.execute(
      p,
      "stock.receive",
      key,
      input,
      async (s) => {
        await this.pharmacist(p, s);
        const b = await this.db.batches(p.tenantId).create(
          {
            medicine: input.medicine,
            strength: input.strength,
            route: input.route,
            unit: input.unit,
            productKey: productKey(input),
            batchNumber: input.batch_number,
            expiryDate: input.expiry_date,
            quantity: input.quantity,
            version: 0,
            operationKey,
            requestHash,
          },
          s,
        );
        await this.db.adjustments(p.tenantId).create(
          {
            batchId: b._id,
            actorId: p.userId,
            delta: input.quantity,
            reason: "Initial batch receipt",
            operationKey,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "STOCK_RECEIVED",
          b._id,
          requestId,
          s,
        );
        return b._id;
      },
    );
    const b = await this.db.batches(p.tenantId).findOne({ _id: id });
    check(b, 404, "NOT_FOUND");
    return this.batchView(b);
  }
  async adjust(
    p: Principal,
    id: string,
    input: { delta: number; reason: string; expected_version: number },
    key: string,
    requestId: string,
  ) {
    await this.pharmacist(p);
    const operationKey = this.key(p, key);
    const aid = await this.ops.execute(
      p,
      "stock.adjust",
      key,
      { id, ...input },
      async (s) => {
        await this.pharmacist(p, s);
        const b = await this.db.batches(p.tenantId).findOne({ _id: id }, s);
        check(b, 404, "NOT_FOUND");
        check(
          Number.isSafeInteger(b.quantity + input.delta) &&
            b.quantity + input.delta >= 0,
          409,
          "INSUFFICIENT_STOCK",
          "Adjustment would make stock invalid.",
        );
        check(
          await this.db
            .batches(p.tenantId)
            .update(
              { _id: id, version: input.expected_version },
              { $inc: { quantity: input.delta, version: 1 } },
              s,
            ),
          409,
          "CONFLICT",
          "Batch changed. Reload before adjusting.",
        );
        const a = await this.db.adjustments(p.tenantId).create(
          {
            batchId: id,
            actorId: p.userId,
            delta: input.delta,
            reason: input.reason,
            operationKey,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "STOCK_ADJUSTED",
          a._id,
          requestId,
          s,
        );
        return a._id;
      },
    );
    check(
      await this.db.adjustments(p.tenantId).findOne({ _id: aid }),
      404,
      "NOT_FOUND",
    );
    const b = await this.db.batches(p.tenantId).findOne({ _id: id });
    check(b, 404, "NOT_FOUND");
    return this.batchView(b);
  }
  private async latest(p: Principal, id: string, s?: ClientSession) {
    const rx = await this.db
      .prescriptions(p.tenantId)
      .findOne({ _id: id, state: "SIGNED" }, s);
    check(rx, 404, "NOT_FOUND");
    const [latest] = await this.db
      .prescriptions(p.tenantId)
      .list(
        { visitId: rx.visitId, state: { $ne: "DISCARDED" } },
        { sort: { revision: -1 }, limit: 1 },
        s,
      );
    check(
      latest?._id === id,
      409,
      "STALE_PRESCRIPTION",
      "A newer prescription revision must be resolved first.",
    );
    check(
      !(await this.db
        .dispenses(p.tenantId)
        .findOne({ visitId: rx.visitId }, s)),
      409,
      "ALREADY_DISPENSED",
      "This encounter has already been dispensed.",
    );
    return rx;
  }
  private async lockVisit(p: Principal, id: string, s: ClientSession) {
    const v = await this.db.visits(p.tenantId).findOne({ _id: id }, s);
    check(v, 404, "NOT_FOUND");
    check(
      await this.db
        .visits(p.tenantId)
        .update({ _id: id, version: v.version }, { $inc: { version: 1 } }, s),
      409,
      "CONFLICT",
    );
  }
  async prescriptions(p: Principal) {
    this.role(p, "PHARMACIST");
    const rows = await this.db
      .prescriptions(p.tenantId)
      .list(
        { state: "SIGNED" },
        { sort: { createdAt: -1, _id: -1 }, limit: 100 },
      );
    const result = [];
    for (const r of rows) {
      const [latest] = await this.db
        .prescriptions(p.tenantId)
        .list(
          { visitId: r.visitId, state: { $ne: "DISCARDED" } },
          { sort: { revision: -1 }, limit: 1 },
        );
      if (latest?._id !== r._id) continue;
      const pat = await this.db
          .patients(p.tenantId)
          .findOne({ _id: r.patientId }),
        done = await this.db
          .dispenses(p.tenantId)
          .findOne({ visitId: r.visitId });
      result.push({
        id: r._id,
        visit_id: r.visitId,
        patient_name: pat?.name ?? "Unavailable patient",
        revision: r.revision,
        items: r.items,
        dispensed: !!done,
        dispense: done
          ? {
              id: done._id,
              allocations: done.allocations,
              dispensed_at: done.createdAt,
            }
          : null,
      });
    }
    return result;
  }
  private swapView(s: Substitution) {
    return {
      id: s._id,
      prescription_id: s.prescriptionId,
      line_index: s.lineIndex,
      medicine: s.medicine,
      strength: s.strength,
      route: s.route,
      unit: s.unit,
      reason: s.reason,
      state: s.state,
      approved_at: s.approvedAt,
    };
  }
  async swaps(p: Principal) {
    this.role(p, "DOCTOR", "PHARMACIST");
    const rows = await this.db
      .substitutions(p.tenantId)
      .list(
        { ...(p.role === "DOCTOR" ? { doctorId: p.userId } : {}) },
        { sort: { createdAt: -1, _id: -1 }, limit: 100 },
      );
    return Promise.all(
      rows.map(async (s) => {
        const rx = await this.db
          .prescriptions(p.tenantId)
          .findOne({ _id: s.prescriptionId });
        return {
          ...this.swapView(s),
          original: rx?.items[s.lineIndex] ?? null,
        };
      }),
    );
  }
  async requestSwap(
    p: Principal,
    id: string,
    input: {
      line_index: number;
      medicine: string;
      strength: string;
      route: string;
      unit: string;
      reason: string;
    },
    key: string,
    requestId: string,
  ) {
    await this.pharmacist(p);
    const operationKey = this.key(p, key);
    const sid = await this.ops.execute(
      p,
      "pharmacy.swap-request",
      key,
      { id, ...input },
      async (s) => {
        await this.pharmacist(p, s);
        const rx = await this.latest(p, id, s);
        check(rx.items[input.line_index], 400, "VALIDATION_ERROR");
        const original = rx.items[input.line_index]!;
        check(
          input.strength.trim().toLowerCase() ===
            original.strength.trim().toLowerCase() &&
            input.route.trim().toLowerCase() ===
              original.route.trim().toLowerCase(),
          400,
          "VALIDATION_ERROR",
          "Generic swaps must retain prescribed strength and route; other changes require a new prescription revision.",
        );
        await this.lockVisit(p, rx.visitId, s);
        const swap = await this.db.substitutions(p.tenantId).create(
          {
            prescriptionId: id,
            visitId: rx.visitId,
            doctorId: rx.authorId,
            lineIndex: input.line_index,
            medicine: input.medicine,
            strength: input.strength,
            route: input.route,
            unit: input.unit,
            productKey: productKey(input),
            reason: input.reason,
            state: "REQUESTED",
            operationKey,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "SUBSTITUTION_REQUESTED",
          swap._id,
          requestId,
          s,
        );
        return swap._id;
      },
    );
    const swap = await this.db.substitutions(p.tenantId).findOne({ _id: sid });
    check(swap, 404, "NOT_FOUND");
    return this.swapView(swap);
  }
  async approveSwap(
    p: Principal,
    id: string,
    password: string,
    key: string,
    requestId: string,
  ) {
    this.role(p, "DOCTOR");
    const proof = await this.proofs.verify(p, password, "password", requestId);
    const sid = await this.ops.execute(
      p,
      "pharmacy.swap-approve",
      key,
      { id },
      async (s) => {
        await proof(s);
        const swap = await this.db
          .substitutions(p.tenantId)
          .findOne({ _id: id, doctorId: p.userId }, s);
        check(swap, 404, "NOT_FOUND");
        await this.latest(p, swap.prescriptionId, s);
        await this.lockVisit(p, swap.visitId, s);
        check(
          await this.db.substitutions(p.tenantId).update(
            { _id: id, state: "REQUESTED", doctorId: p.userId },
            {
              $set: {
                state: "APPROVED",
                approvedAt: new Date(),
                approvedBy: p.userId,
              },
            },
            s,
          ),
          409,
          "CONFLICT",
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "SUBSTITUTION_APPROVED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    const swap = await this.db.substitutions(p.tenantId).findOne({ _id: sid });
    check(swap, 404, "NOT_FOUND");
    return this.swapView(swap);
  }
  async dispense(
    p: Principal,
    id: string,
    input: {
      line_units: {
        line_index: number;
        unit: string;
        substitution_id?: string;
      }[];
    },
    key: string,
    requestId: string,
  ) {
    await this.pharmacist(p);
    const operationKey = this.key(p, key),
      requestHash = digest(JSON.stringify({ id, ...input })),
      previous = await this.db.dispenses(p.tenantId).findOne({ operationKey });
    if (previous) {
      check(previous.requestHash === requestHash, 409, "CONFLICT");
      return {
        id: previous._id,
        prescription_id: previous.prescriptionId,
        allocations: previous.allocations,
      };
    }
    const did = await this.ops.execute(
      p,
      "pharmacy.dispense",
      key,
      { id, ...input },
      async (s) => {
        await this.pharmacist(p, s);
        const rx = await this.latest(p, id, s);
        await this.lockVisit(p, rx.visitId, s);
        check(
          input.line_units.length === rx.items.length,
          400,
          "VALIDATION_ERROR",
          "Provide a unit for every prescribed medicine line.",
        );
        const allocations: DispenseAllocation[] = [];
        for (let index = 0; index < rx.items.length; index++) {
          const line = rx.items[index]!,
            selection = input.line_units.find((l) => l.line_index === index);
          check(
            selection &&
              Number.isSafeInteger(line.quantity) &&
              line.quantity! > 0,
            400,
            "PRESCRIBED_QUANTITY_REQUIRED",
            "The doctor must specify a positive dispensing quantity for every medicine.",
          );
          let target = {
            medicine: line.medicine,
            strength: line.strength,
            route: line.route,
            unit: selection.unit,
          };
          if (selection.substitution_id) {
            const swap = await this.db.substitutions(p.tenantId).findOne(
              {
                _id: selection.substitution_id,
                prescriptionId: id,
                lineIndex: index,
                state: "APPROVED",
                doctorId: rx.authorId,
              },
              s,
            );
            check(
              swap && swap.unit === selection.unit,
              409,
              "SUBSTITUTION_APPROVAL_REQUIRED",
            );
            target = {
              medicine: swap.medicine,
              strength: swap.strength,
              route: swap.route,
              unit: swap.unit,
            };
          }
          const batches = await this.db.batches(p.tenantId).list(
            {
              productKey: productKey(target),
              expiryDate: { $gte: pharmacyDate() },
              quantity: { $gt: 0 },
            },
            { sort: { expiryDate: 1, _id: 1 }, limit: 101 },
            s,
          );
          let remaining = line.quantity!;
          for (const batch of batches.slice(0, 100)) {
            if (!remaining) break;
            check(
              allocations.length < 100,
              409,
              "ALLOCATION_LIMIT",
              "One dispense supports at most 100 batch allocations.",
            );
            const take = Math.min(remaining, batch.quantity);
            check(
              await this.db.batches(p.tenantId).update(
                {
                  _id: batch._id,
                  version: batch.version,
                  quantity: { $gte: take },
                  expiryDate: { $gte: pharmacyDate() },
                },
                { $inc: { quantity: -take, version: 1 } },
                s,
              ),
              409,
              "CONFLICT",
            );
            allocations.push({
              batchId: batch._id,
              lineIndex: index,
              quantity: take,
              medicine: batch.medicine,
              strength: batch.strength,
              route: batch.route,
              unit: batch.unit,
              batchNumber: batch.batchNumber,
              expiryDate: batch.expiryDate,
            });
            remaining -= take;
          }
          check(
            !remaining,
            409,
            batches.length > 100 ? "ALLOCATION_LIMIT" : "INSUFFICIENT_STOCK",
            batches.length > 100
              ? "Eligible stock exceeds the supported allocation batch limit."
              : "Insufficient eligible unexpired stock for full dispensing.",
          );
        }
        const done = await this.db.dispenses(p.tenantId).create(
          {
            prescriptionId: id,
            visitId: rx.visitId,
            patientId: rx.patientId,
            pharmacistId: p.userId,
            allocations,
            operationKey,
            requestHash,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "PRESCRIPTION_DISPENSED",
          done._id,
          requestId,
          s,
        );
        return done._id;
      },
    );
    const done = await this.db.dispenses(p.tenantId).findOne({ _id: did });
    check(done, 404, "NOT_FOUND");
    return {
      id: done._id,
      prescription_id: done.prescriptionId,
      allocations: done.allocations,
    };
  }
}
