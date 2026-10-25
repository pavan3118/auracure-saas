import { check } from "../../types.js";
/** Decimal strings are converted using integer arithmetic, never float multiplication. */
export function minorAmount(amount: string, decimals: number): number {
  check(
    Number.isInteger(decimals) && decimals >= 0 && decimals <= 3,
    400,
    "VALIDATION_ERROR",
  );
  const pattern = decimals
    ? new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`)
    : /^(?:0|[1-9]\d*)$/;
  check(
    pattern.test(amount),
    400,
    "VALIDATION_ERROR",
    "Enter a non-negative amount with the currency's supported decimal places.",
  );
  const [whole, fraction = ""] = amount.split(".");
  const number =
    BigInt(whole!) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  check(
    number <= BigInt(Number.MAX_SAFE_INTEGER),
    400,
    "VALIDATION_ERROR",
    "Amount exceeds the supported limit.",
  );
  return Number(number);
}
