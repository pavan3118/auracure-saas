import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PatientPortal } from "./PatientPortal";
import { PlatformUsage } from "./PlatformUsage";
import { PatientActivate } from "./PublicPages";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  download: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  api: mocks.api,
  downloadDocument: mocks.download,
}));
vi.mock("./auth", () => ({
  useAuth: () => ({ me: { user: { role: "PATIENT" } }, logout: mocks.logout }),
}));
const overview = {
  profile: {
    name: "Synthetic Patient",
    contact: { value: "patient@test.test" },
    date_of_birth: null,
  },
  visits: [
    {
      id: "visit",
      state: "COMPLETED",
      queue_number: 1,
      queued_at: new Date().toISOString(),
    },
  ],
  prescriptions: [
    { id: "rx", revision: 1, signed_at: new Date().toISOString() },
  ],
  lab_orders: [
    {
      id: "order",
      state: "RESULT_DRAFT",
      tests: [{ name: "Synthetic test" }],
      released_result_id: null,
    },
  ],
  invoices: [],
  documents: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  history.replaceState(null, "", "/");
  mocks.api.mockResolvedValue(overview);
  mocks.download.mockResolvedValue(undefined);
});
it("shows linked portal data without unreleased report controls or staff actions", async () => {
  render(<PatientPortal />);
  expect(
    await screen.findByRole("heading", { name: "Welcome, Synthetic Patient" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Your care team has not released a current result."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Read released result" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Invite staff" }),
  ).not.toBeInTheDocument();
});
it("obtains an authorized private PDF and downloads it without a public URL", async () => {
  mocks.api.mockImplementation(async (method: string, path: string) => {
    if (method === "POST" && path === "/portal/documents")
      return { id: "document" };
    return overview;
  });
  render(<PatientPortal />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Download prescription PDF" }),
  );
  await waitFor(() => expect(mocks.download).toHaveBeenCalledWith("document"));
  expect(mocks.api).toHaveBeenCalledWith(
    "POST",
    "/portal/documents",
    { kind: "PRESCRIPTION", source_id: "rx" },
    { "Idempotency-Key": expect.any(String) },
  );
});
it("reads signed medication fields and displays server denials without success", async () => {
  mocks.api.mockImplementation(async (_method: string, path: string) => {
    if (path === "/prescriptions/rx") throw new Error("Record is unavailable");
    return overview;
  });
  render(<PatientPortal />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Read prescription revision 1" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Record is unavailable",
  );
});
it("requests contact activation with no patient ID, tenant ID or staff-selected PIN", async () => {
  render(
    <MemoryRouter>
      <PatientActivate />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Facility subdomain"), "synthetic");
  await user.type(
    screen.getByLabelText("Registered email or international mobile"),
    "patient@test.test",
  );
  await user.click(
    screen.getByRole("button", { name: "Request activation link" }),
  );
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/auth/patient-activation-requests",
      { facility_subdomain: "synthetic", login: "patient@test.test" },
    ),
  );
  expect(
    screen.queryByLabelText("Choose a four-digit portal PIN"),
  ).not.toBeInTheDocument();
});
it("strips the activation token from browser history and requires the patient's own PIN", async () => {
  history.replaceState(
    null,
    "",
    "/patient-activate?token=synthetic-activation-token",
  );
  render(
    <MemoryRouter>
      <PatientActivate />
    </MemoryRouter>,
  );
  expect(location.search).toBe("");
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Choose a four-digit portal PIN"),
    "5831",
  );
  await user.click(screen.getByRole("button", { name: "Set my portal PIN" }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith("POST", "/auth/patient-activation", {
      token: "synthetic-activation-token",
      portal_pin: "5831",
    }),
  );
});
it("displays missing prices and incomplete usage without offering live charges", async () => {
  mocks.api.mockImplementation(async (_m: string, path: string) =>
    path.startsWith("/platform/usage")
      ? {
          month: "2026-10",
          completed_consultations: 101,
          consultation_slabs: 2,
          consultation_reconciled: true,
          clinician_seat_days: 3,
          clinician_months: 0.1,
          pdf_byte_days: 100,
          pdf_gb_month: 0.0001,
          observed_days: ["2026-10-25"],
          expected_observed_days: 25,
          coverage_complete: false,
          measurement: "First worker observation per UTC day",
          message_debits: 1,
          message_refunds: 0,
          wallet: { balance: 1, held: 0, available: 1 },
          pricing_status: "PRICING_NOT_CONFIGURED",
          estimate_minor: null,
          rate_version: null,
          sandbox_enabled: false,
        }
      : path === "/patients"
        ? { items: [] }
        : [],
  );
  render(<PlatformUsage />);
  expect(await screen.findByText("Pricing not configured")).toBeInTheDocument();
  expect(
    screen.getByText(/Measurement coverage: 1\/25 days · Incomplete/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add sandbox test credits" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /charge|pay now/i }),
  ).not.toBeInTheDocument();
});
