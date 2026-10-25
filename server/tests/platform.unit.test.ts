import { it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { monthRange } from "../src/modules/platform/service.js";
import { verifySandboxCallback } from "../src/modules/platform/providers.js";
it("uses calendar month lengths and exact UTC boundaries including leap years", () => {
  expect(monthRange("2024-02").days).toBe(29);
  expect(monthRange("2025-02").days).toBe(28);
  expect(monthRange("2025-12").to.toISOString()).toBe(
    "2026-01-01T00:00:00.000Z",
  );
  expect(() => monthRange("2025-13")).toThrow();
});
it("binds sandbox signatures to raw bytes and limits timestamp replay windows", () => {
  const secret = "a sufficiently long synthetic secret for tests",
    raw = Buffer.from('{"event":"fixture"}'),
    now = 1700000000000,
    ts = String(now / 1000),
    hash = createHmac("sha256", secret)
      .update(`${ts}.`)
      .update(raw)
      .digest("hex"),
    header = `t=${ts},v1=${hash}`;
  expect(() => verifySandboxCallback(secret, header, raw, now)).not.toThrow();
  expect(() =>
    verifySandboxCallback(
      secret,
      header,
      Buffer.from('{ "event":"fixture"}'),
      now,
    ),
  ).toThrow();
  expect(() =>
    verifySandboxCallback(secret, header, raw, now + 301000),
  ).toThrow();
  expect(() => verifySandboxCallback(undefined, header, raw, now)).toThrow();
});
