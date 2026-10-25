import { cashView } from "./cash-view.js";
import type { ClientSession } from "mongoose";
import type { Identity } from "../../auth.js";
import { check, type Principal } from "../../types.js";
import { digest } from "../../crypto.js";
import { Operations } from "../reception/operations.js";
import { minorAmount } from "../reception/money.js";
import { priceLines, type InvoiceLineInput } from "./money.js";
import { Proofs } from "./security.js";
import type { Invoice, Payment } from "./models.js";
export class Billing {
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
  private operationKey(p: Principal, key: string) {
    check(key.length >= 16 && key.length <= 128, 400, "VALIDATION_ERROR");
    return digest(`${p.userId}:${key}`);
  }
  private view(i: Invoice) {
    return {
      id: i._id,
      patient_id: i.patientId,
      number: i.number || null,
      state: i.state,
      currency: i.currency,
      lines: i.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price_minor: l.unitPriceMinor,
        tax_basis_points: l.taxBasisPoints,
        subtotal_minor: l.subtotalMinor,
        tax_minor: l.taxMinor,
        total_minor: l.totalMinor,
      })),
      subtotal_minor: i.subtotalMinor,
      tax_minor: i.taxMinor,
      total_minor: i.totalMinor,
      paid_minor: i.paidMinor,
      balance_minor: i.totalMinor - i.paidMinor,
      version: i.version,
      issued_at: i.issuedAt,
      void_reason: i.voidReason,
    };
  }
  private async scopedInvoice(p: Principal, id: string, s?: ClientSession) {
    this.role(p, "OWNER", "RECEPTIONIST", "PATIENT");
    const i = await this.db.invoices(p.tenantId).findOne({ _id: id }, s);
    check(i, 404, "NOT_FOUND");
    if (p.role === "PATIENT")
      check(
        i.state !== "DRAFT" &&
          (await this.db
            .patients(p.tenantId)
            .findOne({ _id: i.patientId, userId: p.userId }, s)),
        404,
        "NOT_FOUND",
      );
    return i;
  }
  async get(p: Principal, id: string) {
    const i = await this.scopedInvoice(p, id),
      patient = await this.db
        .patients(p.tenantId)
        .findOne({ _id: i.patientId });
    return {
      ...this.view(i),
      patient_name: patient?.name ?? "Unavailable patient",
    };
  }
  async list(p: Principal) {
    this.role(p, "OWNER", "RECEPTIONIST", "PATIENT");
    let patientId: string | undefined;
    if (p.role === "PATIENT") {
      const pat = await this.db
        .patients(p.tenantId)
        .findOne({ userId: p.userId });
      if (!pat) return [];
      patientId = pat._id;
    }
    const list = await this.db
      .invoices(p.tenantId)
      .list(
        { ...(patientId ? { patientId, state: { $ne: "DRAFT" } } : {}) },
        { sort: { createdAt: -1, _id: -1 }, limit: 100 },
      );
    return Promise.all(list.map((i) => this.get(p, i._id)));
  }
  async create(
    p: Principal,
    input: { patient_id: string; lines: InvoiceLineInput[] },
    key: string,
    requestId: string,
  ) {
    this.role(p, "OWNER", "RECEPTIONIST");
    const values = priceLines(input.lines),
      operationKey = this.operationKey(p, key),
      requestHash = digest(JSON.stringify(input));
    const previous = await this.db
      .invoices(p.tenantId)
      .findOne({ operationKey });
    if (previous) {
      check(previous.requestHash === requestHash, 409, "CONFLICT");
      return this.get(p, previous._id);
    }
    const id = await this.ops.execute(
      p,
      "invoice.create",
      key,
      input,
      async (s) => {
        check(
          await this.db
            .patients(p.tenantId)
            .findOne({ _id: input.patient_id }, s),
          404,
          "NOT_FOUND",
        );
        const i = await this.db.invoices(p.tenantId).create(
          {
            patientId: input.patient_id,
            createdBy: p.userId,
            currency: "INR",
            state: "DRAFT",
            ...values,
            paidMinor: 0,
            version: 0,
            operationKey,
            requestHash,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "INVOICE_DRAFT_CREATED",
          i._id,
          requestId,
          s,
        );
        return i._id;
      },
    );
    return this.get(p, id);
  }
  async update(
    p: Principal,
    id: string,
    input: { lines: InvoiceLineInput[]; expected_version: number },
    requestId: string,
  ) {
    this.role(p, "OWNER", "RECEPTIONIST");
    const values = priceLines(input.lines);
    await this.db.transaction(async (s) => {
      await this.scopedInvoice(p, id, s);
      const i = await this.db
        .invoices(p.tenantId)
        .update(
          { _id: id, state: "DRAFT", version: input.expected_version },
          { $set: values, $inc: { version: 1 } },
          s,
        );
      check(i, 409, "CONFLICT", "Only a current draft can be edited.");
      await this.identity.audit(
        p.tenantId,
        p.userId,
        "INVOICE_DRAFT_UPDATED",
        id,
        requestId,
        s,
      );
    });
    return this.get(p, id);
  }
  async issue(
    p: Principal,
    id: string,
    version: number,
    key: string,
    requestId: string,
  ) {
    this.role(p, "OWNER", "RECEPTIONIST");
    const resource = await this.ops.execute(
      p,
      "invoice.issue",
      key,
      { id, version },
      async (s) => {
        await this.scopedInvoice(p, id, s);
        const t = await this.db.tenants(p.tenantId).update(
          {
            _id: p.tenantId,
            $or: [
              { invoiceSequence: { $exists: false } },
              { invoiceSequence: { $lt: Number.MAX_SAFE_INTEGER } },
            ],
          },
          { $inc: { invoiceSequence: 1 } },
          s,
        );
        check(t, 409, "CONFLICT");
        const i = await this.db
          .invoices(p.tenantId)
          .findOne({ _id: id, state: "DRAFT", version }, s);
        check(i, 409, "CONFLICT", "Invoice was already issued or changed.");
        check(
          await this.db.invoices(p.tenantId).update(
            { _id: id, state: "DRAFT", version },
            {
              $set: {
                number: `INV-${String(t.invoiceSequence).padStart(6, "0")}`,
                state: i.totalMinor === 0 ? "PAID" : "ISSUED",
                issuedAt: new Date(),
              },
              $inc: { version: 1 },
            },
            s,
          ),
          409,
          "CONFLICT",
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "INVOICE_ISSUED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return this.get(p, resource);
  }
  async void(
    p: Principal,
    id: string,
    input: { expected_version: number; reason: string; mfa_proof: string },
    key: string,
    requestId: string,
  ) {
    this.role(p, "OWNER");
    const resource = await this.ops.execute(
      p,
      "invoice.void",
      key,
      { id, version: input.expected_version, reason: input.reason },
      async (s) => {
        await this.proofs.owner(p, input.mfa_proof, s);
        await this.scopedInvoice(p, id, s);
        const i = await this.db.invoices(p.tenantId).update(
          {
            _id: id,
            version: input.expected_version,
            state: { $in: ["DRAFT", "ISSUED"] },
            paidMinor: 0,
          },
          {
            $set: { state: "VOID", voidReason: input.reason },
            $inc: { version: 1 },
          },
          s,
        );
        check(
          i,
          409,
          "CONFLICT",
          "Only an unpaid draft or issued invoice can be voided.",
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "INVOICE_VOIDED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return this.get(p, resource);
  }
  private paymentView(v: Payment) {
    return {
      id: v._id,
      invoice_id: v.invoiceId,
      amount_minor: v.amountMinor,
      method: v.method,
      external_reference: v.externalReference || null,
      cash_session_id: v.cashSessionId || null,
      recorded_at: v.createdAt,
    };
  }
  async payments(p: Principal, id: string) {
    await this.scopedInvoice(p, id);
    return (
      await this.db
        .payments(p.tenantId)
        .list(
          { invoiceId: id },
          { sort: { createdAt: -1, _id: -1 }, limit: 100 },
        )
    ).map((v) => this.paymentView(v));
  }
  async pay(
    p: Principal,
    id: string,
    input: {
      amount: string;
      method: "CASH" | "UPI" | "CARD";
      external_reference: string;
    },
    key: string,
    requestId: string,
  ) {
    this.role(p, "RECEPTIONIST");
    const amountMinor = minorAmount(input.amount, 2);
    check(
      amountMinor > 0,
      400,
      "VALIDATION_ERROR",
      "Receipt amount must be positive.",
    );
    const operationKey = this.operationKey(p, key),
      requestHash = digest(JSON.stringify({ id, ...input })),
      prior = await this.db.payments(p.tenantId).findOne({ operationKey });
    if (prior) {
      check(prior.requestHash === requestHash, 409, "CONFLICT");
      return this.paymentView(prior);
    }
    const resource = await this.ops.execute(
      p,
      "invoice.payment",
      key,
      { id, ...input },
      async (s) => {
        const i = await this.scopedInvoice(p, id, s);
        check(
          ["ISSUED", "PARTIALLY_PAID"].includes(i.state),
          409,
          "CONFLICT",
          "Only an issued invoice with a balance can accept receipts.",
        );
        check(
          amountMinor <= i.totalMinor - i.paidMinor,
          409,
          "OVERPAYMENT",
          "Receipt exceeds the outstanding balance.",
        );
        let cashId = "";
        if (input.method === "CASH") {
          const cash = await this.db
            .cashSessions(p.tenantId)
            .findOne({ receptionistId: p.userId, state: "OPEN" }, s);
          check(
            cash,
            409,
            "CASH_SESSION_REQUIRED",
            "Record an opening cash float before collecting cash.",
          );
          check(
            Number.isSafeInteger(
              cash.openingFloatMinor +
                (cash.cashReceiptsMinor ?? 0) +
                amountMinor,
            ),
            400,
            "VALIDATION_ERROR",
            "Cash total exceeds the supported limit.",
          );
          check(
            await this.db.cashSessions(p.tenantId).update(
              {
                _id: cash._id,
                state: "OPEN",
                $or: [
                  { version: cash.version ?? 0 },
                  ...(cash.version == null
                    ? [{ version: { $exists: false } }]
                    : []),
                ],
              },
              { $inc: { cashReceiptsMinor: amountMinor, version: 1 } },
              s,
            ),
            409,
            "CONFLICT",
          );
          cashId = cash._id;
        }
        const paid = i.paidMinor + amountMinor;
        check(
          await this.db.invoices(p.tenantId).update(
            { _id: id, version: i.version, state: i.state },
            {
              $set: {
                paidMinor: paid,
                state: paid === i.totalMinor ? "PAID" : "PARTIALLY_PAID",
              },
              $inc: { version: 1 },
            },
            s,
          ),
          409,
          "CONFLICT",
        );
        const receipt = await this.db.payments(p.tenantId).create(
          {
            invoiceId: id,
            patientId: i.patientId,
            actorId: p.userId,
            amountMinor,
            method: input.method,
            externalReference: input.external_reference,
            cashSessionId: cashId,
            operationKey,
            requestHash,
          },
          s,
        );
        if (cashId)
          await this.db.cashMovements(p.tenantId).create(
            {
              cashSessionId: cashId,
              paymentId: receipt._id,
              actorId: p.userId,
              amountMinor,
              kind: "RECEIPT",
            },
            s,
          );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "PAYMENT_RECORDED",
          receipt._id,
          requestId,
          s,
        );
        return receipt._id;
      },
    );
    const payment = await this.db
      .payments(p.tenantId)
      .findOne({ _id: resource });
    check(payment, 404, "NOT_FOUND");
    return this.paymentView(payment);
  }
  async closeCash(
    p: Principal,
    id: string,
    input: {
      expected_version: number;
      counted_cash: string;
      variance_reason: string;
    },
    key: string,
    requestId: string,
  ) {
    this.role(p, "RECEPTIONIST");
    const counted = minorAmount(input.counted_cash, 2);
    const resource = await this.ops.execute(
      p,
      "cash.close",
      key,
      { id, ...input },
      async (s) => {
        const c = await this.db
          .cashSessions(p.tenantId)
          .findOne({ _id: id, receptionistId: p.userId }, s);
        check(c, 404, "NOT_FOUND");
        const expected = c.openingFloatMinor + (c.cashReceiptsMinor ?? 0),
          variance = counted - expected;
        check(
          !variance || input.variance_reason.length >= 3,
          400,
          "VARIANCE_REASON_REQUIRED",
          "Explain any difference between counted and expected cash.",
        );
        check(
          await this.db.cashSessions(p.tenantId).update(
            {
              _id: id,
              receptionistId: p.userId,
              state: "OPEN",
              $or: [
                { version: input.expected_version },
                ...(input.expected_version === 0
                  ? [{ version: { $exists: false } }]
                  : []),
              ],
            },
            {
              $set: {
                state: "CLOSED",
                countedMinor: counted,
                expectedMinor: expected,
                varianceMinor: variance,
                varianceReason: input.variance_reason,
                closedAt: new Date(),
              },
              $inc: { version: 1 },
            },
            s,
          ),
          409,
          "CONFLICT",
          "Cash shift changed or was already closed.",
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "CASH_SESSION_CLOSED",
          id,
          requestId,
          s,
        );
        if (variance)
          await this.identity.audit(
            p.tenantId,
            p.userId,
            "CASH_VARIANCE_RECORDED",
            id,
            requestId,
            s,
          );
        return id;
      },
    );
    return this.cashDetail(p, resource);
  }
  async reviewCash(
    p: Principal,
    id: string,
    input: { expected_version: number; review_note: string; mfa_proof: string },
    key: string,
    requestId: string,
  ) {
    this.role(p, "OWNER");
    const resource = await this.ops.execute(
      p,
      "cash.review",
      key,
      { id, version: input.expected_version, note: input.review_note },
      async (s) => {
        await this.proofs.owner(p, input.mfa_proof, s);
        check(
          await this.db.cashSessions(p.tenantId).findOne({ _id: id }, s),
          404,
          "NOT_FOUND",
        );
        check(
          await this.db.cashSessions(p.tenantId).update(
            { _id: id, state: "CLOSED", version: input.expected_version },
            {
              $set: {
                state: "REVIEWED",
                reviewedBy: p.userId,
                reviewNote: input.review_note,
                reviewedAt: new Date(),
              },
              $inc: { version: 1 },
            },
            s,
          ),
          409,
          "CONFLICT",
          "Only a current closed shift can be reviewed.",
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "CASH_SESSION_REVIEWED",
          id,
          requestId,
          s,
        );
        return id;
      },
    );
    return this.cashDetail(p, resource);
  }
  async cashDetail(p: Principal, id: string) {
    this.role(p, "OWNER", "RECEPTIONIST");
    const c = await this.db.cashSessions(p.tenantId).findOne({
      _id: id,
      ...(p.role === "RECEPTIONIST" ? { receptionistId: p.userId } : {}),
    });
    check(c, 404, "NOT_FOUND");
    return cashView(c);
  }
  async cashList(p: Principal) {
    this.role(p, "OWNER", "RECEPTIONIST");
    const rows = await this.db
      .cashSessions(p.tenantId)
      .list(
        { ...(p.role === "RECEPTIONIST" ? { receptionistId: p.userId } : {}) },
        { sort: { openedAt: -1, _id: -1 }, limit: 100 },
      );
    return Promise.all(rows.map((c) => this.cashDetail(p, c._id)));
  }
}
