import { describe, it, expect } from "vitest";
import { priceLines } from "../src/modules/billing/money.js";
import { pharmacyDate, productKey } from "../src/modules/pharmacy/service.js";
describe("exact invoice amounts and pharmacy identity", () => {
  it("rounds tax half up independently per line", () => {
    const l = {
      description: "Test",
      quantity: 1,
      unit_price: "0.01",
      tax_percent: "50",
    };
    expect(priceLines([l, l]).totalMinor).toBe(4);
  });
  it("rejects overflow, negative prices and unsupported tax precision", () => {
    for (const x of [
      { unit_price: "-1", tax_percent: "0", quantity: 1 },
      { unit_price: "90071992547409.91", tax_percent: "100", quantity: 2 },
      { unit_price: "1", tax_percent: "100.01", quantity: 1 },
      { unit_price: "1", tax_percent: "0.001", quantity: 1 },
    ])
      expect(() => priceLines([{ description: "Test", ...x }])).toThrow();
  });
  it("uses Asia/Kolkata midnight rather than UTC midnight", () => {
    expect(pharmacyDate(new Date("2026-10-25T18:29:59Z"))).toBe("2026-10-25");
    expect(pharmacyDate(new Date("2026-10-25T18:30:00Z"))).toBe("2026-10-26");
  });
  it("normalizes labels while separating strength, route and units", () => {
    const p = {
      medicine: " Medicine  X ",
      strength: "10 mg",
      route: "Oral",
      unit: "tablet",
    };
    expect(productKey(p)).toBe(productKey({ ...p, medicine: "medicine x" }));
    expect(productKey(p)).not.toBe(productKey({ ...p, unit: "ml" }));
  });
});
