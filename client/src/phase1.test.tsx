import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  Login,
  Onboarding,
  SecurityGate,
  Invite,
  Recover,
} from "./PublicPages";
import { Workspace } from "./Workspace";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  accept: vi.fn(),
  logout: vi.fn(),
  auth: { result: null as unknown, me: null as unknown },
}));
vi.mock("./api", async () => ({
  ...(await vi.importActual("./api")),
  api: mocks.api,
}));
vi.mock("./auth", () => ({
  useAuth: () => ({
    ...mocks.auth,
    accept: mocks.accept,
    logout: mocks.logout,
  }),
}));
const owner = {
  id: "owner",
  name: "Alex Owner",
  login: "alex@test.test",
  role: "OWNER",
  status: "ACTIVE",
  mfa_enabled: true,
  licence_status: "PENDING",
};
function page(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = { result: null, me: null };
  mocks.accept.mockResolvedValue(undefined);
  history.replaceState(null, "", "/");
});
describe("Phase 1 accessible user journeys", () => {
  it("submits facility-scoped login and reports errors without losing input", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Invalid credentials."));
    page(<Login />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Facility subdomain"), "alpha");
    await user.type(
      screen.getByLabelText("User ID or email"),
      "alex@test.test",
    );
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid credentials.",
    );
    expect(screen.getByLabelText("Facility subdomain")).toHaveValue("alpha");
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it("walks all five onboarding steps and verifies contact before registration", async () => {
    const user = userEvent.setup();
    mocks.api.mockImplementation(async (_method: string, path: string) =>
      path === "/onboarding/contact-challenges"
        ? { challenge_id: "challenge" }
        : path === "/onboarding/contact-challenges/verify"
          ? { verification_grant: "grant" }
          : { access_token: "token", purpose: "mfa-enroll", user: owner },
    );
    page(<Onboarding />);
    await user.type(screen.getByLabelText("Facility name"), "Alpha Clinic");
    await user.type(screen.getByLabelText("Workspace subdomain"), "alpha");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Planned clinician capacity"), "5");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Full name"), "Alex Owner");
    await user.type(screen.getByLabelText("Email"), "alex@test.test");
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.type(
      await screen.findByLabelText("Verification code"),
      "verified-proof",
    );
    await user.click(screen.getByRole("button", { name: "Verify contact" }));
    await user.type(
      await screen.findByLabelText("Owner password"),
      "a long secure password",
    );
    await user.type(
      screen.getByLabelText("Confirm password"),
      "a long secure password",
    );
    await user.click(
      screen.getByRole("button", { name: "Create facility & secure account" }),
    );
    await waitFor(() => expect(mocks.accept).toHaveBeenCalled());
    expect(mocks.api).toHaveBeenLastCalledWith(
      "POST",
      "/onboarding/register",
      expect.objectContaining({
        verification_grant: "grant",
        facility: expect.objectContaining({ subdomain: "alpha", capacity: 5 }),
      }),
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
  });
  it("keeps business access behind owner MFA and shows single-use recovery codes", async () => {
    mocks.auth.result = {
      access_token: "enroll",
      purpose: "mfa-enroll",
      user: owner,
    };
    mocks.api
      .mockResolvedValueOnce({
        secret: "PRIVATESETUPKEY",
        uri: "otpauth://test",
      })
      .mockResolvedValueOnce({
        access_token: "access",
        purpose: "access",
        user: owner,
        recovery_codes: ["single-use-recovery"],
      });
    page(<SecurityGate />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Set up authenticator" }),
    );
    expect(await screen.findByText("PRIVATESETUPKEY")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Authenticator code or recovery code"),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Confirm MFA" }));
    expect(await screen.findByText("single-use-recovery")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "I have saved my codes" }),
    ).toBeInTheDocument();
  });
  it("removes invitation tokens from the browser URL and accepts a chosen password", async () => {
    history.replaceState(null, "", "/invite?token=secret-invitation");
    mocks.api.mockResolvedValue({
      access_token: "access",
      purpose: "access",
      user: owner,
    });
    page(<Invite />);
    expect(location.search).toBe("");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your name"), "Doctor Test");
    await user.type(
      screen.getByLabelText("New password"),
      "a secure doctor password",
    );
    await user.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect(mocks.api).toHaveBeenCalledWith(
      "POST",
      "/auth/invitations/accept",
      expect.objectContaining({ token: "secret-invitation" }),
    );
  });
  it("uses generic recovery messaging", async () => {
    mocks.api.mockResolvedValue({});
    page(<Recover />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Facility subdomain"), "alpha");
    await user.type(
      screen.getByLabelText("Registered email"),
      "alex@test.test",
    );
    await user.click(
      screen.getByRole("button", { name: "Send recovery instructions" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If your account is eligible",
    );
  });
  it("renders Screen 07, submits invitations and displays pending activation", async () => {
    mocks.auth.me = {
      user: owner,
      tenant: {
        id: "t1",
        name: "Alpha Clinic",
        subdomain: "alpha",
        type: "CLINIC",
      },
    };
    mocks.api.mockImplementation(async (method: string, path: string) =>
      path === "/staff"
        ? [owner]
        : path === "/staff/invitations" && method === "GET"
          ? []
          : path === "/audit-events"
            ? []
            : {},
    );
    page(<Workspace />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Team & access" }));
    expect(
      screen.getByText("SCREEN 07 · STAFF MANAGEMENT"),
    ).toBeInTheDocument();
    await screen.findByText("alex@test.test");
    await user.click(screen.getByRole("button", { name: "Invite staff" }));
    await user.type(screen.getByLabelText("Staff email"), "doctor@test.test");
    await user.selectOptions(screen.getByLabelText("Role"), "DOCTOR");
    await user.click(
      screen.getByRole("button", { name: "Send secure invitation" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Invitation queued for delivery.",
    );
    expect(mocks.api).toHaveBeenCalledWith("POST", "/staff/invitations", {
      login: "doctor@test.test",
      role: "DOCTOR",
    });
  });
  it("does not show owner staff/audit controls to clinical roles", async () => {
    mocks.auth.me = {
      user: { ...owner, role: "DOCTOR" },
      tenant: {
        id: "t1",
        name: "Alpha Clinic",
        subdomain: "alpha",
        type: "CLINIC",
      },
    };
    mocks.api.mockImplementation(async (_method: string, path: string) =>
      path === "/doctor/workspace" ? { active: null, queued_count: 0 } : [],
    );
    page(<Workspace />);
    expect(
      screen.queryByRole("button", { name: "Team & access" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Audit trail" }),
    ).not.toBeInTheDocument();
    await screen.findByText("No assigned encounters yet.");
    expect(
      mocks.api.mock.calls.every(
        ([, path]) =>
          !["/staff", "/staff/invitations", "/audit-events"].includes(path),
      ),
    ).toBe(true);
    expect(
      screen.getByRole("heading", {
        name: "Ready for your next patient, Alex?",
      }),
    ).toBeInTheDocument();
  });
});

describe("patient credential forms", () => {
  it("uses the portal PIN mode without sending a staff password", async () => {
    mocks.api.mockResolvedValue({
      access_token: "patient",
      purpose: "access",
      user: { ...owner, role: "PATIENT" },
    });
    page(<Login />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Facility subdomain"), "alpha");
    await user.type(
      screen.getByLabelText("User ID or email"),
      "patient@test.test",
    );
    await user.click(screen.getByRole("checkbox"));
    await user.type(screen.getByLabelText("Four-digit portal PIN"), "1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mocks.api).toHaveBeenCalledWith("POST", "/auth/login", {
      facility_subdomain: "alpha",
      login: "patient@test.test",
      portal_pin: "1234",
    });
  });
  it("permits a four-digit patient recovery credential while leaving staff validation to the server", async () => {
    history.replaceState(null, "", "/recover?token=patient-recovery");
    mocks.api.mockResolvedValue({});
    page(<Recover />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox"));
    await user.type(screen.getByLabelText("New four-digit portal PIN"), "5678");
    await user.click(screen.getByRole("button", { name: "Reset portal PIN" }));
    expect(mocks.api).toHaveBeenCalledWith("POST", "/auth/recovery/complete", {
      token: "patient-recovery",
      new_password: "5678",
    });
  });
});
