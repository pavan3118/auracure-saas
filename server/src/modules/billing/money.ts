import { check } from "../../types.js";
import { minorAmount } from "../reception/money.js";
export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unit_price: string;
  tax_percent: string;
}
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  taxBasisPoints: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}
function safe(value: bigint) {
  check(
    value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER),
    400,
    "VALIDATION_ERROR",
    "Amount exceeds the supported limit.",
  );
  return Number(value);
}
/** Explicit per-line tax, with half-up rounding at a whole paise boundary. */
export function priceLines(lines: InvoiceLineInput[]) {
  const priced: InvoiceLine[] = lines.map((line) => {
    check(
      Number.isSafeInteger(line.quantity) && line.quantity > 0,
      400,
      "VALIDATION_ERROR",
    );
    const unitPriceMinor = minorAmount(line.unit_price, 2),
      taxBasisPoints = minorAmount(line.tax_percent, 2);
    check(
      taxBasisPoints <= 10000,
      400,
      "VALIDATION_ERROR",
      "Tax percentage must be between 0 and 100.",
    );
    const base = BigInt(unitPriceMinor) * BigInt(line.quantity),
      tax = (base * BigInt(taxBasisPoints) + 5000n) / 10000n;
    return {
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor,
      taxBasisPoints,
      subtotalMinor: safe(base),
      taxMinor: safe(tax),
      totalMinor: safe(base + tax),
    };
  });
  return {
    lines: priced,
    subtotalMinor: safe(
      priced.reduce((n, l) => n + BigInt(l.subtotalMinor), 0n),
    ),
    taxMinor: safe(priced.reduce((n, l) => n + BigInt(l.taxMinor), 0n)),
    totalMinor: safe(priced.reduce((n, l) => n + BigInt(l.totalMinor), 0n)),
  };
}
