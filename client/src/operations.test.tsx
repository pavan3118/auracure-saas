import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Billing, Pharmacy, Laboratory } from "./Operations";
const mocks = vi.hoisted(() => ({ api: vi.fn(), role: "RECEPTIONIST" }));
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  api: mocks.api,
}));
vi.mock("./auth", () => ({
  useAuth: () => ({ me: { user: { role: mocks.role } } }),
}));
const invoice = {
  id: "invoice",
  patient_name: "Synthetic Patient",
  number: "INV-000001",
  state: "ISSUED",
  version: 1,
  total_minor: 11800,
  paid_minor: 0,
  balance_minor: 11800,
  lines: [
    {
      description: "Synthetic service",
      quantity: 1,
      unit_price_minor: 10000,
      tax_basis_points: 1800,
      total_minor: 11800,
    },
  ],
};
const order = {
  id: "order",
  patient_name: "Synthetic Patient",
  tests: [{ name: "Synthetic test" }],
  state: "TECH_SIGNED",
  version: 3,
  current_result_id: "result",
};
const result = {
  id: "result",
  revision: 1,
  state: "TECH_SIGNED",
  version: 1,
  observations: [
    {
      name: "Synthetic analyte",
      value: "12",
      unit: "u",
      reference_interval: "manual",
      comments: "manual",
    },
  ],
  comments: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "RECEPTIONIST";
  mocks.api.mockImplementation(async (method: string, path: string) => {
    if (path === "/patients")
      return { items: [{ id: "patient", name: "Synthetic Patient" }] };
    if (path === "/invoices") return [invoice];
    if (path === "/invoices/invoice") return invoice;
    if (path.endsWith("/payments")) return [];
    if (path === "/lab/orders") return [order];
    if (path.endsWith("/results")) return [result];
    return [];
  });
});
it("records a manual receipt using an idempotency key and explicit reference", async () => {
  render(<Billing />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /INV-000001/ }));
  await user.type(screen.getByLabelText("Received amount (₹)"), "118.00");
  await user.selectOptions(screen.getByLabelText("Payment method"), "UPI");
  await user.type(
    screen.getByLabelText(/Transaction reference/),
    "synthetic-ref",
  );
  await user.click(screen.getByRole("button", { name: "Record receipt" }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/invoices/invoice/payments",
      { amount: "118.00", method: "UPI", external_reference: "synthetic-ref" },
      { "Idempotency-Key": expect.any(String) },
    ),
  );
});
it("owner can void unpaid invoices with fresh proof and cannot record receipts", async () => {
  mocks.role = "OWNER";
  render(<Billing />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /INV-000001/ }));
  expect(
    screen.queryByRole("button", { name: "Record receipt" }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Void reason"),
    "Synthetic cancellation",
  );
  await user.type(
    screen.getByLabelText("Fresh authenticator or recovery code"),
    "synthetic-code",
  );
  await user.click(screen.getByRole("button", { name: "Void unpaid invoice" }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/invoices/invoice/void",
      expect.objectContaining({
        expected_version: 1,
        mfa_proof: "synthetic-code",
      }),
      expect.any(Object),
    ),
  );
});
it("requesting doctor sees the exact original and alternative before password approval", async () => {
  mocks.role = "DOCTOR";
  mocks.api.mockResolvedValue([
    {
      id: "swap",
      line_index: 0,
      state: "REQUESTED",
      medicine: "Alternative",
      strength: "10 mg",
      route: "Oral",
      unit: "tablet",
      reason: "Synthetic reason",
      original: {
        medicine: "Original",
        strength: "10 mg",
        route: "Oral",
        dose: "One",
        frequency: "Daily",
      },
    },
  ]);
  render(<Pharmacy />);
  const user = userEvent.setup();
  expect(await screen.findByText(/Prescribed: Original/)).toBeInTheDocument();
  expect(screen.getByText(/Alternative: Alternative/)).toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Current doctor password"),
    "synthetic-password",
  );
  await user.click(
    screen.getByRole("button", { name: "Approve exact alternative" }),
  );
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/pharmacy/substitutions/swap/approve",
      { password: "synthetic-password" },
      expect.any(Object),
    ),
  );
});
it("doctor verification requires password and does not expose laboratory release", async () => {
  mocks.role = "DOCTOR";
  render(<Laboratory />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /Synthetic Patient/ }),
  );
  expect(
    screen.queryByRole("button", { name: "Release verified result" }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Current doctor password"),
    "synthetic-password",
  );
  await user.click(
    screen.getByRole("button", { name: "Verify this result revision" }),
  );
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/lab/results/result/verify",
      { expected_version: 1, password: "synthetic-password" },
      expect.any(Object),
    ),
  );
});
it("lab cannot release technician-signed results before doctor verification", async () => {
  mocks.role = "LAB";
  render(<Laboratory />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /Synthetic Patient/ }),
  );
  expect(await screen.findByText(/Revision 1/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Release verified result" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Verify this result revision" }),
  ).not.toBeInTheDocument();
});
it("shows server validation failure instead of a success notice", async () => {
  render(<Billing />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /INV-000001/ }));
  mocks.api.mockRejectedValueOnce(new Error("Receipt failed"));
  await user.type(screen.getByLabelText("Received amount (₹)"), "999.00");
  await user.click(screen.getByRole("button", { name: "Record receipt" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
