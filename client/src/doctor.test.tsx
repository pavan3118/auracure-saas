import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Doctor } from "./Doctor";
import { PrescriptionEditor } from "./PrescriptionEditor";
import type { DoctorDetail, Prescription, Medicine } from "./doctor-api";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  mutate: vi.fn(),
  reload: vi.fn(),
  detail: null as unknown,
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  api: mocks.api,
}));
vi.mock("./auth", () => ({
  useAuth: () => ({
    me: { user: { name: "Taylor Doctor", role: "DOCTOR" } },
    result: { access_token: "token" },
  }),
}));
vi.mock("./use-live-queue", () => ({ useLiveQueue: () => "live" }));
const medicine: Medicine = {
  medicine: "Manual medicine",
  strength: "10 mg",
  dose: "One tablet",
  route: "Oral",
  frequency: "Doctor specified frequency",
  duration: "Three days",
};
function rx(patch: Partial<Prescription> = {}): Prescription {
  return {
    id: "rx1",
    visit_id: "visit1",
    patient_id: "p1",
    revision: 1,
    state: "DRAFT",
    items: [medicine],
    notes: "",
    version: 0,
    lease_expires_at: null,
    lease_owned: false,
    signed_at: null,
    signed_by: "",
    content_hash: "",
    source_id: null,
    revision_reason: "",
    ...patch,
  };
}
function encounter(): DoctorDetail {
  return {
    visit: {
      id: "visit1",
      patient_id: "p1",
      state: "IN_CONSULTATION",
      queue_number: 7,
      queued_at: new Date().toISOString(),
      claimed_at: new Date().toISOString(),
      completed_at: null,
      version: 1,
    },
    patient: {
      id: "p1",
      name: "Test Patient",
      date_of_birth: "1990-05-20",
      contact: { type: "EMAIL", value: "patient@test.test" },
    },
    consultation: {
      id: "note1",
      complaint: "",
      assessment: "",
      plan: "",
      version: 0,
      state: "DRAFT",
      finalized_at: null,
    },
    prescriptions: [],
    vitals: [],
    lab_orders: [],
    service_orders: [],
    amendments: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail = null;
  mocks.reload.mockResolvedValue(undefined);
  mocks.api.mockImplementation(async (method: string, path: string) => {
    if (path === "/doctor/workspace")
      return { active: mocks.detail, queued_count: 2 };
    if (path === "/doctor/visits")
      return mocks.detail ? [(mocks.detail as DoctorDetail).visit] : [];
    if (path === "/queue") return { queued_count: 2 };
    if (path === "/queue/claim-next") {
      mocks.detail = encounter();
      return mocks.detail;
    }
    if (path.startsWith("/visits/")) return mocks.detail;
    throw new Error(`Unexpected request ${method} ${path}`);
  });
});
describe("doctor consultation UI", () => {
  it("calls next with a retry key and displays only the assigned encounter", async () => {
    render(<Doctor />);
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Call next" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Call next" }));
    expect(
      await screen.findByRole("heading", { name: "Test Patient" }),
    ).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/queue/claim-next",
      {},
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
    expect(screen.getByRole("button", { name: "Call next" })).toBeDisabled();
  });
  it("preserves unsaved note input on save failure and blocks premature completion", async () => {
    mocks.detail = encounter();
    const normal = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(
      (method: string, path: string, ...rest: unknown[]) =>
        method === "PATCH"
          ? Promise.reject(new Error("Note version conflict"))
          : normal(method, path, ...rest),
    );
    render(<Doctor />);
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("Presenting complaint"),
      "Doctor-entered complaint",
    );
    await user.type(
      screen.getByLabelText("Assessment"),
      "Doctor-entered assessment",
    );
    expect(
      screen.getByRole("button", { name: "Review completion" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Save consultation notes" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Note version conflict",
    );
    expect(screen.getByLabelText("Presenting complaint")).toHaveValue(
      "Doctor-entered complaint",
    );
  });
  it("requires explicit completion review after the saved encounter version is refreshed", async () => {
    const detail = encounter();
    detail.consultation!.complaint = "Saved complaint";
    detail.consultation!.assessment = "Saved assessment";
    mocks.detail = detail;
    const normal = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(
      async (method: string, path: string, ...rest: unknown[]) => {
        if (path.endsWith("/complete")) {
          detail.visit.state = "COMPLETED";
          return detail.visit;
        }
        return normal(method, path, ...rest);
      },
    );
    render(<Doctor />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Review completion" }),
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", {
        name: "Complete consultation",
      }),
    );
    expect(
      await screen.findByText(
        "Consultation completed. One encounter was recorded.",
      ),
    ).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/visits/visit1/complete",
      { expected_version: 1 },
      expect.any(Object),
    );
  });
});
describe("prescription editor controls", () => {
  it("keeps the medicine inputs locked until this session acquires a valid lease", async () => {
    const initial = rx();
    mocks.api.mockResolvedValue({
      ...initial,
      version: 1,
      lease_owned: true,
      lease_expires_at: new Date(Date.now() + 120000).toISOString(),
    });
    render(
      <PrescriptionEditor
        initial={initial}
        active
        reload={mocks.reload}
        mutate={mocks.mutate}
      />,
    );
    expect(screen.getByLabelText("Medicine name")).toBeDisabled();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Acquire edit lease" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Medicine name")).toBeEnabled(),
    );
    expect(mocks.api).toHaveBeenCalledWith("POST", "/prescriptions/rx1/lease", {
      expected_version: 0,
    });
  });
  it("requires password confirmation and intent before signing a saved draft", async () => {
    const initial = rx({
      lease_owned: true,
      lease_expires_at: new Date(Date.now() + 120000).toISOString(),
      version: 2,
    });
    mocks.mutate.mockResolvedValue({
      ...initial,
      state: "SIGNED",
      version: 3,
      signed_at: new Date().toISOString(),
      lease_owned: false,
    });
    render(
      <PrescriptionEditor
        initial={initial}
        active
        reload={mocks.reload}
        mutate={mocks.mutate}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review & sign" }));
    await user.type(
      screen.getByLabelText("Current password to confirm prescription signing"),
      "current doctor password",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Sign prescription permanently" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Signed prescription" }),
    ).toBeInTheDocument();
    expect(mocks.mutate).toHaveBeenCalledWith(
      "sign:rx1",
      "/prescriptions/rx1/sign",
      { expected_version: 2, password: "current doctor password" },
    );
    expect(screen.queryByLabelText("Medicine name")).not.toBeInTheDocument();
  });
  it("never exposes editing controls for a signed revision", () => {
    render(
      <PrescriptionEditor
        initial={rx({ state: "SIGNED", signed_at: new Date().toISOString() })}
        active={false}
        reload={mocks.reload}
        mutate={mocks.mutate}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Signed prescription" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Acquire edit lease" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Discard unsigned draft" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Manual medicine · 10 mg")).toBeInTheDocument();
  });
  it("retains discarded draft metadata without allowing it to be signed", () => {
    render(
      <PrescriptionEditor
        initial={rx({
          state: "DISCARDED",
          discard_reason: "Medication not indicated",
        })}
        active
        reload={mocks.reload}
        mutate={mocks.mutate}
      />,
    );
    expect(screen.getByText("Medication not indicated")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review & sign" }),
    ).not.toBeInTheDocument();
  });
});

describe("current patient vs historical record context", () => {
  it("retains the true active encounter summary while viewing a completed record", async () => {
    const current = encounter(),
      past = encounter();
    past.visit = {
      ...past.visit,
      id: "past-visit",
      queue_number: 2,
      state: "COMPLETED",
    };
    past.patient = {
      ...past.patient,
      id: "past-patient",
      name: "Previous Patient",
    };
    past.consultation = {
      ...past.consultation!,
      state: "FINAL",
      complaint: "Historical complaint",
      assessment: "Historical assessment",
    };
    mocks.api.mockImplementation(async (_method: string, path: string) =>
      path === "/doctor/workspace"
        ? { active: current, queued_count: 1 }
        : path === "/doctor/visits"
          ? [current.visit, past.visit]
          : path === "/visits/past-visit"
            ? past
            : current,
    );
    render(<Doctor />);
    await screen.findByRole("heading", { name: "Test Patient" });
    await userEvent
      .setup()
      .click(screen.getAllByRole("button", { name: "Open encounter" })[1]!);
    await screen.findByRole("heading", { name: "Previous Patient" });
    const summary = screen
      .getByText("Your current encounter")
      .closest("article")!;
    expect(summary).toHaveTextContent("#7");
    expect(summary).toHaveTextContent("Test Patient");
    expect(screen.getByRole("button", { name: "Call next" })).toBeDisabled();
    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Return to current encounter" }),
      );
    await screen.findByRole("heading", { name: "Test Patient" });
  });
});
