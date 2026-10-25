import { describe, it, expect } from "vitest";
import { minorAmount } from "../src/modules/reception/money.js";
import {
  patientInput,
  vitalsInput,
} from "../src/modules/reception/contracts.js";
describe("exact cash input", () => {
  it("converts decimal rupees without binary rounding loss", () => {
    expect(minorAmount("0.29", 2)).toBe(29);
    expect(minorAmount("1000.1", 2)).toBe(100010);
    expect(minorAmount("0", 2)).toBe(0);
    expect(minorAmount("90071992547409.91", 2)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([
    "1.001",
    "1e3",
    "-10",
    "01.00",
    "NaN",
    "Infinity",
    "90071992547409.92",
  ])("rejects unsafe or ambiguous amount %s", (amount) => {
    expect(() => minorAmount(amount, 2)).toThrow();
  });
});
describe("approved reception contract", () => {
  it("normalizes a unique email and accepts international mobile contacts", () => {
    expect(
      patientInput.parse({
        name: " Patient ",
        contact: { type: "EMAIL", value: "PATIENT@TEST.COM" },
      }).contact.value,
    ).toBe("patient@test.com");
    expect(
      patientInput.safeParse({
        name: "Patient",
        contact: { type: "MOBILE", value: "+919876543210" },
      }).success,
    ).toBe(true);
  });
  it("accepts paired blood pressure with exact units without clinical interpretation", () => {
    expect(
      vitalsInput.safeParse({
        observations: [
          { code: "SYSTOLIC_BP", value: 120, unit: "mmHg" },
          { code: "DIASTOLIC_BP", value: 80, unit: "mmHg" },
        ],
      }).success,
    ).toBe(true);
  });
});
