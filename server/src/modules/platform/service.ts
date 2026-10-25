import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import type { Identity } from "../../auth.js";
import { digest, seal, open } from "../../crypto.js";
import { check, type Principal } from "../../types.js";
import { Operations } from "../reception/operations.js";
import { Proofs } from "../billing/security.js";
import {
  sandboxMessaging,
  sandboxBilling,
  type MessagingProvider,
  type BillingProvider,
} from "./providers.js";
export function monthRange(month: string) {
  check(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) >= 2020,
    400,
    "VALIDATION_ERROR",
  );
  const from = new Date(`${month}-01T00:00:00Z`),
    to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to, days: (+to - +from) / 86400000 };
}
export class Platform {
  private ops: Operations;
  constructor(
    private identity: Identity,
    private messaging: MessagingProvider = sandboxMessaging,
    private billing: BillingProvider = sandboxBilling,
  ) {
    this.ops = new Operations(identity.db);
  }
  private get db() {
    return this.identity.db;
  }
  private owner(p: Principal) {
    check(p.role === "OWNER" && p.purpose === "access", 403, "FORBIDDEN");
  }
  private sandbox() {
    check(
      !this.identity.config.production,
      503,
      "PROVIDER_UNAVAILABLE",
      "External provider activation is not configured.",
    );
  }
  async snapshot(t: string, now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    if (await this.db.dailyUsage(t).findOne({ day })) return;
    try {
      await this.db.transaction(async (s) => {
        check(
          await this.db.tenants(t).findOne({ _id: t, status: "ACTIVE" }, s),
          404,
          "NOT_FOUND",
        );
        const clinicians = await this.db
            .users(t)
            .count({ role: "DOCTOR", status: "ACTIVE" }, s),
          pdfBytes = await this.db.documents(t).sum({}, "sizeBytes", s);
        await this.db
          .dailyUsage(t)
          .create({ day, observedAt: now, clinicians, pdfBytes }, s);
      });
    } catch (e) {
      if (!(await this.db.dailyUsage(t).findOne({ day }))) throw e;
    }
  }
  async usage(p: Principal, month: string) {
    this.owner(p);
    const { from, to, days } = monthRange(month),
      t = p.tenantId;
    const [
      completed,
      actual,
      seatDays,
      byteDays,
      snapshots,
      debits,
      refunds,
      wallet,
    ] = await Promise.all([
      this.db.usage(t).count({
        meter: "COMPLETED_CONSULTATION",
        effectiveAt: { $gte: from, $lt: to },
      }),
      this.db
        .visits(t)
        .count({ state: "COMPLETED", completedAt: { $gte: from, $lt: to } }),
      this.db
        .dailyUsage(t)
        .sum(
          { day: { $gte: month + "-01", $lt: to.toISOString().slice(0, 10) } },
          "clinicians",
        ),
      this.db
        .dailyUsage(t)
        .sum(
          { day: { $gte: month + "-01", $lt: to.toISOString().slice(0, 10) } },
          "pdfBytes",
        ),
      this.db
        .dailyUsage(t)
        .list(
          { day: { $gte: month + "-01", $lt: to.toISOString().slice(0, 10) } },
          { sort: { day: 1 }, limit: 31 },
        ),
      this.db
        .walletEntries(t)
        .sum({ kind: "DEBIT", createdAt: { $gte: from, $lt: to } }, "units"),
      this.db
        .walletEntries(t)
        .sum({ kind: "REFUND", createdAt: { $gte: from, $lt: to } }, "units"),
      this.db.wallets(t).findOne({}),
    ]);
    const expected =
      +from > Date.now()
        ? 0
        : Math.min(
            days,
            Math.floor((Math.min(Date.now(), +to) - +from) / 86400000) +
              (+to > Date.now() ? 1 : 0),
          );
    const rate = this.identity.config.prices,
      slabs = Math.ceil(completed / 100);
    let amountMinor: number | null = null;
    if (rate) {
      const numerator =
        BigInt(seatDays) * BigInt(rate.seatMinor) * 1000000000n +
        BigInt(byteDays) * BigInt(rate.gbMinor);
      const denom = BigInt(days) * 1000000000n;
      const total =
        (numerator + denom / 2n) / denom +
        BigInt(slabs) * BigInt(rate.slabMinor);
      check(total <= BigInt(Number.MAX_SAFE_INTEGER), 400, "METER_OVERFLOW");
      amountMinor = Number(total);
    }
    return {
      month,
      currency: "INR",
      completed_consultations: completed,
      consultation_slabs: slabs,
      consultation_reconciled: completed === actual,
      completed_encounters: actual,
      clinician_seat_days: seatDays,
      clinician_months: seatDays / days,
      pdf_byte_days: byteDays,
      pdf_gb_month: byteDays / days / 1e9,
      observed_days: snapshots.map((s) => s.day),
      expected_observed_days: expected,
      coverage_complete: snapshots.length === expected,
      measurement:
        "First worker observation per UTC day; no inferred historical snapshots",
      message_debits: debits,
      message_refunds: refunds,
      wallet: {
        balance: wallet?.balance ?? 0,
        held: wallet?.held ?? 0,
        available: (wallet?.balance ?? 0) - (wallet?.held ?? 0),
      },
      pricing_status: rate ? "SANDBOX_ESTIMATE" : "PRICING_NOT_CONFIGURED",
      rate_version: rate?.version ?? null,
      estimate_minor: amountMinor,
      sandbox_enabled: !this.identity.config.production,
      charges_enabled: false,
    };
  }
  private async wallet(t: string, s: ClientSession) {
    return (
      (await this.db.wallets(t).findOne({}, s)) ??
      (await this.db
        .wallets(t)
        .create({ _id: t, balance: 0, held: 0, version: 0 }, s))
    );
  }
  async credit(
    p: Principal,
    units: number,
    proof: string,
    key: string,
    requestId: string,
  ) {
    this.owner(p);
    this.sandbox();
    check(
      Number.isSafeInteger(units) && units > 0 && units <= 1000000,
      400,
      "VALIDATION_ERROR",
    );
    const id = await this.ops.execute(
      p,
      "wallet.test-credit",
      key,
      { units },
      async (s) => {
        await new Proofs(this.identity).owner(p, proof, s);
        const w = await this.wallet(p.tenantId, s);
        check(Number.isSafeInteger(w.balance + units), 400, "METER_OVERFLOW");
        check(
          await this.db
            .wallets(p.tenantId)
            .update(
              { _id: w._id, version: w.version },
              { $inc: { balance: units, version: 1 } },
              s,
            ),
          409,
          "CONFLICT",
        );
        const entry = await this.db.walletEntries(p.tenantId).create(
          {
            source: `test:${digest(p.userId + key)}`,
            kind: "TEST_CREDIT",
            units,
            actorId: p.userId,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "SANDBOX_WALLET_CREDIT",
          entry._id,
          requestId,
          s,
        );
        return entry._id;
      },
    );
    return { id, test_only: true };
  }
  async messages(p: Principal) {
    this.owner(p);
    return (
      await this.db
        .messages(p.tenantId)
        .list({}, { sort: { createdAt: -1 }, limit: 100 })
    ).map((j) => ({
      id: j._id,
      patient_id: j.patientId,
      channel: j.channel,
      template: j.template,
      state: j.state,
      provider_reference: j.providerRef,
      cost: j.cost,
    }));
  }
  async queue(
    p: Principal,
    input: { patient_id: string; channel: "SMS" | "WHATSAPP" },
    key: string,
    requestId: string,
  ) {
    this.owner(p);
    this.sandbox();
    const requestHash = digest(JSON.stringify(input)),
      operationKey = digest(`${p.userId}:${key}`),
      old = await this.db.messages(p.tenantId).findOne({ operationKey });
    if (old) {
      check(old.requestHash === requestHash, 409, "CONFLICT");
      return { id: old._id, state: old.state };
    }
    const id = await this.ops.execute(
      p,
      "message.queue",
      key,
      input,
      async (s) => {
        const pat = await this.db
          .patients(p.tenantId)
          .findOne({ _id: input.patient_id }, s);
        check(
          pat && pat.contactType === "MOBILE" && pat.userId,
          400,
          "VERIFIED_MOBILE_REQUIRED",
        );
        check(
          await this.db.users(p.tenantId).findOne(
            {
              _id: pat.userId,
              role: "PATIENT",
              status: "ACTIVE",
              contactVerified: true,
              login: pat.contactValue,
            },
            s,
          ),
          400,
          "VERIFIED_MOBILE_REQUIRED",
        );
        const w = await this.wallet(p.tenantId, s);
        check(w.balance - w.held >= 1, 409, "INSUFFICIENT_CREDITS");
        check(
          await this.db
            .wallets(p.tenantId)
            .update(
              { _id: w._id, version: w.version },
              { $inc: { held: 1, version: 1 } },
              s,
            ),
          409,
          "CONFLICT",
        );
        const j = await this.db.messages(p.tenantId).create(
          {
            patientId: pat._id,
            recipient: pat.contactValue,
            channel: input.channel,
            template: "PORTAL_ACCESS",
            encryptedBody: seal(
              `Your AuraCare portal is available at ${this.identity.config.origin}/login. Sign in using your facility and PIN.`,
              this.identity.config.encryptionKey,
            ),
            providerRef: `sandbox-msg-${randomUUID()}`,
            state: "QUEUED",
            cost: 1,
            operationKey,
            requestHash,
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "SANDBOX_MESSAGE_QUEUED",
          j._id,
          requestId,
          s,
        );
        return j._id;
      },
    );
    return {
      id,
      state: (await this.db.messages(p.tenantId).findOne({ _id: id }))!.state,
    };
  }
  async sendPending() {
    this.sandbox();
    for (const ref of await this.db.pendingMessageRefs()) {
      const job = await this.db.messages(ref.tenant_id).update(
        {
          _id: ref._id,
          state: "QUEUED",
          $or: [
            { nextAttempt: { $lte: new Date() } },
            { nextAttempt: { $exists: false } },
          ],
        },
        {
          $set: { nextAttempt: new Date(Date.now() + 60000) },
          $inc: { attempts: 1 },
        },
      );
      if (!job) continue;
      if (
        !(await this.db
          .tenants(ref.tenant_id)
          .findOne({ _id: ref.tenant_id, status: "ACTIVE" }))
      )
        continue;
      const pat = await this.db
        .patients(ref.tenant_id)
        .findOne({ _id: job.patientId, contactValue: job.recipient });
      if (
        !pat ||
        !(await this.db.users(ref.tenant_id).findOne({
          _id: pat.userId,
          role: "PATIENT",
          status: "ACTIVE",
          contactVerified: true,
          login: job.recipient,
        }))
      )
        continue;

      try {
        // Adapter must deduplicate reference before returning acceptance. Never blindly retry an ambiguous live send.
        const accepted = await this.messaging.send({
          reference: job.providerRef,
          channel: job.channel,
          recipient: job.recipient,
          body: open(job.encryptedBody, this.identity.config.encryptionKey),
        });
        check(
          accepted.reference === job.providerRef,
          502,
          "PROVIDER_REFERENCE_MISMATCH",
        );
        await this.db.transaction(async (s) => {
          const current = await this.db
            .messages(ref.tenant_id)
            .findOne({ _id: job._id, state: "QUEUED" }, s);
          if (!current) return;
          const w = await this.wallet(ref.tenant_id, s);
          check(
            w.held >= job.cost && w.balance >= job.cost,
            409,
            "WALLET_INCONSISTENT",
          );
          check(
            await this.db
              .wallets(ref.tenant_id)
              .update(
                { _id: w._id, version: w.version },
                { $inc: { balance: -job.cost, held: -job.cost, version: 1 } },
                s,
              ),
            409,
            "CONFLICT",
          );
          await this.db.messages(ref.tenant_id).update(
            { _id: job._id, state: "QUEUED" },
            {
              $set: {
                state: "ACCEPTED",
                acceptedAt: new Date(),
                encryptedBody: "",
              },
            },
            s,
          );
          await this.db.walletEntries(ref.tenant_id).create(
            {
              source: `accepted:${job._id}`,
              kind: "DEBIT",
              units: job.cost,
              actorId: "provider",
            },
            s,
          );
          await this.identity.audit(
            ref.tenant_id,
            "provider",
            "SANDBOX_MESSAGE_ACCEPTED",
            job._id,
            "worker",
            s,
          );
        });
      } catch {
        // Retry only the reference-idempotent local adapter; retain reserved credits on ambiguous failure.
        await this.db.messages(ref.tenant_id).update(
          { _id: job._id, state: "QUEUED" },
          {
            $set: {
              nextAttempt: new Date(
                Date.now() +
                  Math.min(
                    3600000,
                    60000 * 2 ** Math.min(Math.max(0, job.attempts - 1), 6),
                  ),
              ),
            },
          },
        );
      }
    }
  }
  async preview(p: Principal, month: string, key: string, requestId: string) {
    this.owner(p);
    this.sandbox();
    const quote = await this.usage(p, month);
    check(
      quote.pricing_status === "SANDBOX_ESTIMATE",
      409,
      "PRICING_NOT_CONFIGURED",
    );
    check(
      quote.coverage_complete && quote.consultation_reconciled,
      409,
      "USAGE_INCOMPLETE",
    );
    check(month < new Date().toISOString().slice(0, 7), 409, "PERIOD_OPEN");
    const reference = `sandbox-bill-${digest(`${p.tenantId}:${p.userId}:${key}`).slice(0, 32)}`;
    await this.billing.preview({
      reference,
      amountMinor: quote.estimate_minor!,
      currency: "INR",
    });
    const id = await this.ops.execute(
      p,
      "platform.preview",
      key,
      { month, rate: quote.rate_version },
      async (s) => {
        const b = await this.db.platformBills(p.tenantId).create(
          {
            month,
            providerRef: reference,
            quoteHash: digest(JSON.stringify(quote)),
            state: "PREVIEW",
            amountMinor: quote.estimate_minor!,
            rateVersion: quote.rate_version!,
            operationKey: digest(`${p.userId}:${key}`),
          },
          s,
        );
        await this.identity.audit(
          p.tenantId,
          p.userId,
          "SANDBOX_BILL_PREVIEW",
          b._id,
          requestId,
          s,
        );
        return b._id;
      },
    );
    return { id, test_only: true };
  }
  async callback(
    kind: "MESSAGE" | "BILL",
    input: {
      event_id: string;
      reference: string;
      status: "DELIVERED" | "FAILED" | "PAID";
    },
    payloadHash: string,
  ) {
    this.sandbox();
    const ref = await this.db.resolveProviderReference(input.reference, kind);
    check(ref, 404, "NOT_FOUND");
    try {
      return await this.db.transaction(async (s) => {
        const old = await this.db
          .providerEvents(ref.tenant_id)
          .findOne({ eventId: input.event_id }, s);
        if (old) {
          check(
            old.payloadHash === payloadHash &&
              old.reference === input.reference,
            409,
            "CONFLICT",
          );
          return { duplicate: true };
        }
        if (kind === "MESSAGE") {
          check(input.status !== "PAID", 400, "VALIDATION_ERROR");
          const j = await this.db
            .messages(ref.tenant_id)
            .findOne({ _id: ref._id }, s);
          check(j, 404, "NOT_FOUND");
          check(
            j.state === "ACCEPTED" || j.state === input.status,
            409,
            "TERMINAL_STATE_CONFLICT",
          );
          if (j.state === "ACCEPTED") {
            if (input.status === "FAILED") {
              const w = await this.wallet(ref.tenant_id, s);
              check(
                Number.isSafeInteger(w.balance + j.cost),
                400,
                "METER_OVERFLOW",
              );
              check(
                await this.db
                  .wallets(ref.tenant_id)
                  .update(
                    { _id: w._id, version: w.version },
                    { $inc: { balance: j.cost, version: 1 } },
                    s,
                  ),
                409,
                "CONFLICT",
              );
              await this.db.walletEntries(ref.tenant_id).create(
                {
                  source: `refund:${j._id}`,
                  kind: "REFUND",
                  units: j.cost,
                  actorId: "provider",
                },
                s,
              );
            }
            await this.db
              .messages(ref.tenant_id)
              .update(
                { _id: j._id, state: "ACCEPTED" },
                { $set: { state: input.status, completedAt: new Date() } },
                s,
              );
          }
        } else {
          check(input.status !== "DELIVERED", 400, "VALIDATION_ERROR");
          const b = await this.db
            .platformBills(ref.tenant_id)
            .findOne({ _id: ref._id }, s);
          check(b, 404, "NOT_FOUND");
          check(
            b.state === "PREVIEW" || b.state === input.status,
            409,
            "TERMINAL_STATE_CONFLICT",
          );
          await this.db
            .platformBills(ref.tenant_id)
            .update({ _id: b._id }, { $set: { state: input.status } }, s);
        }
        await this.db.providerEvents(ref.tenant_id).create(
          {
            eventId: input.event_id,
            reference: input.reference,
            payloadHash,
            status: input.status,
          },
          s,
        );
        await this.identity.audit(
          ref.tenant_id,
          "provider",
          `SANDBOX_${kind}_${input.status}`,
          ref._id,
          input.event_id,
          s,
        );
        return { duplicate: false };
      });
    } catch (error) {
      const event = await this.db
        .providerEvents(ref.tenant_id)
        .findOne({ eventId: input.event_id });
      if (event) {
        check(
          event.payloadHash === payloadHash &&
            event.reference === input.reference,
          409,
          "CONFLICT",
        );
        return { duplicate: true };
      }
      throw error;
    }
  }
  async tick() {
    for await (const t of await this.db.activeTenantRefs())
      await this.snapshot(t._id);
    if (!this.identity.config.production) await this.sendPending();
  }
}
