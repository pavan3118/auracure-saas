import { describe, it, expect } from "vitest";
import {
  noteInput,
  prescriptionInput,
  amendmentInput,
  labInput,
} from "../src/modules/doctor/contracts.js";
const medicine = {
  medicine: "Manual medicine",
  strength: "Manual strength",
  dose: "Manual dose",
  route: "Manual route",
  frequency: "Manual frequency",
  duration: "Manual duration",
};
describe("approved doctor data contract", () => {
  it("allows incomplete notes to be saved as drafts without asserting completion eligibility", () => {
    expect(
      noteInput.parse({ complaint: "", assessment: "", expected_version: 0 })
        .plan,
    ).toBe("");
  });
  it("requires every prescribed medication field and rejects injected fields", () => {
    for (const key of Object.keys(medicine)) {
      const line = { ...medicine, [key]: "" };
      expect(
        prescriptionInput.safeParse({ expected_version: 0, items: [line] })
          .success,
      ).toBe(false);
    }
    expect(
      prescriptionInput.safeParse({
        expected_version: 0,
        items: [{ ...medicine, tenant_id: "other" }],
      }).success,
    ).toBe(false);
  });
  it("accepts manual text without silently inventing a drug catalogue or dosing conversion", () => {
    const r = prescriptionInput.parse({
      expected_version: 1,
      items: [
        { ...medicine, quantity: 2, instructions: "Doctor-entered text" },
      ],
    });
    expect(r.items[0]!.dose).toBe("Manual dose");
    expect(r.items[0]!.quantity).toBe(2);
  });
  it("requires correction attribution and a nonempty assessment for amendments", () => {
    expect(
      amendmentInput.safeParse({
        complaint: "Correction",
        assessment: "",
        plan: "",
        reason: "Correction reason",
        password: "proof",
      }).success,
    ).toBe(false);
    expect(
      amendmentInput.safeParse({
        complaint: "Correction",
        assessment: "Assessment",
        reason: "x",
        password: "proof",
      }).success,
    ).toBe(false);
  });
  it("bounds batch sizes and rejects priced service masquerading as a clinical test", () => {
    expect(
      labInput.safeParse({
        visit_id: "00000000-0000-4000-8000-000000000001",
        tests: [{ name: "Manual test", price: 100 }],
      }).success,
    ).toBe(false);
    expect(
      prescriptionInput.safeParse({
        expected_version: 0,
        items: Array.from({ length: 21 }, () => medicine),
      }).success,
    ).toBe(false);
  });
});
