import type { CashSession } from "../reception/models.js";
export function cashView(c: CashSession) {
  return {
    id: c._id,
    receptionist_id: c.receptionistId,
    opening_float_minor: c.openingFloatMinor,
    currency: c.currency,
    state: c.state,
    opened_at: c.openedAt,
    version: c.version ?? 0,
    cash_receipts_minor: c.cashReceiptsMinor ?? 0,
    expected_cash_minor:
      c.expectedMinor ?? c.openingFloatMinor + (c.cashReceiptsMinor ?? 0),
    counted_cash_minor: c.countedMinor ?? null,
    variance_minor: c.varianceMinor ?? null,
    variance_reason: c.varianceReason ?? "",
    closed_at: c.closedAt ?? null,
    reviewed_at: c.reviewedAt ?? null,
    review_note: c.reviewNote ?? "",
    reconciliation_available: true,
  };
}
