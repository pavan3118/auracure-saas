import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Reception } from "./Reception";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  role: "RECEPTIONIST",
  patients: [] as {
    id: string;
    name: string;
    contact: { type: string; value: string };
    version: number;
    date_of_birth: string;
  }[],
  queue: [] as {
    id: string;
    patient_id: string;
    patient_name: string;
    state: string;
    queue_number: number;
    version: number;
    queued_at: string;
  }[],
  cash: [] as object[],
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  api: mocks.api,
}));
vi.mock("./auth", () => ({
  useAuth: () => ({
    me: { user: { id: "rec", name: "Reception Test", role: mocks.role } },
    result: { access_token: "token" },
  }),
}));
vi.mock("./use-live-queue", () => ({ useLiveQueue: () => "live" }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "RECEPTIONIST";
  mocks.patients = [];
  mocks.queue = [];
  mocks.cash = [];
  mocks.api.mockImplementation(
    async (method: string, path: string, body: Record<string, unknown>) => {
      if (method === "GET" && path.startsWith("/patients?"))
        return { items: mocks.patients, next_cursor: null };
      if (method === "GET" && path === "/queue")
        return {
          items: mocks.queue,
          queued_count: mocks.queue.length,
          in_consultation_count: 0,
          limit: 100,
        };
      if (method === "GET" && path === "/cash/sessions") return mocks.cash;
      if (method === "GET" && path.endsWith("/vitals")) return [];
      if (method === "POST" && path === "/patients") {
        const p = {
          id: "patient1",
          name: String(body.name),
          contact: body.contact as { type: string; value: string },
          version: 0,
          date_of_birth: String(body.date_of_birth ?? ""),
        };
        mocks.patients = [p];
        return p;
      }
      if (method === "POST" && path === "/visits") {
        const v = {
          id: "visit1",
          patient_id: String(body.patient_id),
          patient_name: "Taylor Patient",
          state: "QUEUED",
          queue_number: 12,
          version: 0,
          queued_at: new Date().toISOString(),
        };
        mocks.queue = [v];
        return v;
      }
      if (method === "POST" && path === "/cash/sessions") {
        mocks.cash = [
          {
            id: "cash1",
            opening_float_minor: 29,
            currency: "INR",
            state: "OPEN",
            opened_at: new Date().toISOString(),
          },
        ];
        return mocks.cash[0];
      }
      return {};
    },
  );
});
describe("reception user workflows", () => {
  it("registers a patient with the approved contact and date fields, then checks in", async () => {
    render(<Reception />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Register patient" }));
    await user.type(screen.getByLabelText("Full name"), "Taylor Patient");
    await user.type(
      screen.getByLabelText("Email or mobile contact"),
      "taylor@test.test",
    );
    await user.type(
      screen.getByLabelText("Date of birth (optional)"),
      "1990-05-20",
    );
    await user.click(screen.getByRole("button", { name: "Save patient" }));
    await screen.findByText("taylor@test.test");
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/patients",
      {
        name: "Taylor Patient",
        contact: { type: "EMAIL", value: "taylor@test.test" },
        date_of_birth: "1990-05-20",
      },
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
    await user.click(screen.getByRole("button", { name: "Check in" }));
    await screen.findByText("Taylor Patient checked in · queue #12.");
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/visits",
      { patient_id: "patient1" },
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
    expect(screen.getByRole("button", { name: "Check in" })).toBeDisabled();
  });
  it("keeps registration input after a server rejection", async () => {
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(
      (m: string, p: string, b: Record<string, unknown>, h: object) =>
        p === "/patients" && m === "POST"
          ? Promise.reject(
              new Error("This contact already belongs to a patient."),
            )
          : original(m, p, b, h),
    );
    render(<Reception />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Register patient" }));
    await user.type(screen.getByLabelText("Full name"), "Existing Patient");
    await user.type(
      screen.getByLabelText("Email or mobile contact"),
      "duplicate@test.test",
    );
    await user.click(screen.getByRole("button", { name: "Save patient" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already belongs",
    );
    expect(screen.getByLabelText("Email or mobile contact")).toHaveValue(
      "duplicate@test.test",
    );
  });
  it("records vitals in fixed units and prevents empty submissions", async () => {
    mocks.queue = [
      {
        id: "visit1",
        patient_id: "patient1",
        patient_name: "Vitals Patient",
        state: "QUEUED",
        queue_number: 12,
        version: 0,
        queued_at: new Date().toISOString(),
      },
    ];
    render(<Reception />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Live queue" }));
    await user.click(
      await screen.findByRole("button", { name: "Record vitals" }),
    );
    await user.click(screen.getByRole("button", { name: "Save vitals" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at least one measurement",
    );
    await user.type(screen.getByLabelText("Temperature (°C)"), "37.1");
    await user.click(screen.getByRole("button", { name: "Save vitals" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "POST",
        "/visits/visit1/vitals",
        { observations: [{ code: "TEMPERATURE", value: 37.1, unit: "°C" }] },
        expect.any(Object),
      ),
    );
  });
  it("records INR opening float and exposes no payment or close action", async () => {
    render(<Reception />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Cash float" }));
    await user.type(screen.getByLabelText("Opening float (₹)"), "0.29");
    await user.click(
      screen.getByRole("button", { name: "Record opening float" }),
    );
    expect(
      await screen.findByText("Opening float recorded."),
    ).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/cash/sessions",
      { opening_float: "0.29", currency: "INR" },
      expect.any(Object),
    );
    expect(
      screen.queryByRole("button", { name: /close shift|collect payment/i }),
    ).not.toBeInTheDocument();
  });
  it("limits owners to operational queue and read-only cash without a patient directory or vitals form", async () => {
    mocks.role = "OWNER";
    mocks.queue = [
      {
        id: "v",
        patient_id: "p",
        patient_name: "Operational Patient",
        state: "QUEUED",
        queue_number: 1,
        version: 0,
        queued_at: new Date().toISOString(),
      },
    ];
    render(<Reception />);
    await screen.findByText("Operational Patient");
    expect(
      screen.queryByRole("tab", { name: "Patient directory" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Record vitals" }),
    ).not.toBeInTheDocument();
    const tabs = screen.getByRole("tablist");
    await userEvent
      .setup()
      .click(within(tabs).getByRole("tab", { name: "Cash float" }));
    expect(
      screen.queryByRole("button", { name: "Record opening float" }),
    ).not.toBeInTheDocument();
  });
});
