import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { mailbox } from "./mailbox.js";
async function post<T>(
  api: APIRequestContext,
  path: string,
  data: unknown,
  token?: string,
): Promise<T> {
  const r = await api.post(`/api/v1${path}`, {
    data,
    headers: {
      "Idempotency-Key": randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!r.ok())
    throw new Error(`Fixture request ${path} failed with HTTP ${r.status()}`);
  return (await r.json()).data as T;
}
test("clinic workflow through patient activation, private PDF and owner usage", async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120000);
  const api = await playwright.request.newContext({ baseURL });
  const suffix = randomUUID().slice(0, 8),
    domain = `doctor-${suffix}`,
    ownerEmail = `owner-${suffix}@auracare.test`,
    doctorEmail = `doctor-${suffix}@auracare.test`,
    recEmail = `rec-${suffix}@auracare.test`,
    doctorPassword = "a secure phase three doctor password";
  const challenge = await post<{ challenge_id: string }>(
      api,
      "/onboarding/contact-challenges",
      { email: ownerEmail, desired_subdomain: domain },
    ),
    mail = await mailbox(ownerEmail, "Verify your AuraCare contact");
  const grant = await post<{ verification_grant: string }>(
    api,
    "/onboarding/contact-challenges/verify",
    {
      challenge_id: challenge.challenge_id,
      proof: mail.split("Verification code: ")[1]!.split("\n")[0]!,
    },
  );
  const owner = await post<{ access_token: string }>(
    api,
    "/onboarding/register",
    {
      facility: {
        name: "Willow Clinical Centre",
        type: "CLINIC",
        subdomain: domain,
        capacity: 4,
      },
      owner: {
        name: "Owner Example",
        email: ownerEmail,
        password: "a secure phase three owner password",
      },
      ...grant,
    },
  );
  const setup = await post<{ secret: string }>(
      api,
      "/auth/mfa/enroll",
      {},
      owner.access_token,
    ),
    totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(setup.secret),
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    });
  const full = await post<{ access_token: string; recovery_codes: string[] }>(
    api,
    "/auth/mfa/confirm",
    { proof: totp.generate() },
    owner.access_token,
  );
  await post(
    api,
    "/staff/invitations",
    { login: recEmail, role: "RECEPTIONIST" },
    full.access_token,
  );
  const recLink = await mailbox(recEmail, "Join your AuraCare facility");
  const rec = await post<{ access_token: string }>(
    api,
    "/auth/invitations/accept",
    {
      token: /token=([\w-]+)/.exec(recLink)![1],
      name: "Reception Fixture",
      password: "a secure reception fixture password",
    },
  );
  const patient = await post<{ id: string }>(
    api,
    "/patients",
    {
      name: "Jordan Example",
      contact: { type: "EMAIL", value: `patient-${suffix}@auracare.test` },
      date_of_birth: "1990-05-20",
    },
    rec.access_token,
  );
  const visit = await post<{ id: string }>(
    api,
    "/visits",
    { patient_id: patient.id },
    rec.access_token,
  );
  await post(
    api,
    `/visits/${visit.id}/vitals`,
    { observations: [{ code: "TEMPERATURE", value: 37.1, unit: "°C" }] },
    rec.access_token,
  );
  await post(
    api,
    "/staff/invitations",
    { login: doctorEmail, role: "DOCTOR" },
    full.access_token,
  );
  const doctorLink = await mailbox(doctorEmail, "Join your AuraCare facility");
  await page.goto(`/invite?token=${/token=([\w-]+)/.exec(doctorLink)![1]}`);
  await page.getByLabel("Your name").fill("Jamie Doctor");
  await page.getByLabel("New password", { exact: true }).fill(doctorPassword);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready for your next patient, Jamie?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Call next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Jordan Example" }),
  ).toBeVisible();
  await page
    .getByLabel("Presenting complaint", { exact: true })
    .fill("Synthetic presenting complaint for workflow verification");
  await page
    .getByLabel("Assessment", { exact: true })
    .fill("Synthetic assessment, not clinical advice");
  await page.getByLabel("Plan (optional)").fill("Synthetic follow-up plan");
  await page.getByRole("button", { name: "Save consultation notes" }).click();
  await expect(
    page.getByText("Consultation notes saved.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create prescription draft" }).click();
  await page.getByRole("button", { name: "Acquire edit lease" }).click();
  await page
    .getByLabel("Medicine name", { exact: true })
    .fill("Example medicine (synthetic)");
  await page.getByLabel("Strength", { exact: true }).fill("Synthetic strength");
  await page.getByLabel("Dose", { exact: true }).fill("Synthetic dose");
  await page.getByLabel("Route", { exact: true }).fill("Manual route");
  await page
    .getByLabel("Frequency", { exact: true })
    .fill("Doctor-entered frequency");
  await page
    .getByLabel("Duration", { exact: true })
    .fill("Doctor-entered duration");
  await page.getByLabel("Quantity (optional)").fill("3");
  await page.getByRole("button", { name: "Save prescription draft" }).click();
  await expect(
    page.getByText("Prescription draft saved.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review & sign" }).click();
  await page
    .getByLabel("Current password to confirm prescription signing")
    .fill(doctorPassword);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Sign prescription permanently" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Signed prescription" }),
  ).toBeVisible();
  await expect(page.getByLabel("Medicine name", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Add order", exact: true }).click();
  await page
    .getByLabel("Test or service name")
    .fill("Manually requested test (synthetic)");
  await page
    .getByLabel("Clinical order instructions (optional)")
    .fill("Synthetic workflow fixture");
  await page.getByRole("button", { name: "Place clinical order" }).click();
  await expect(
    page.getByText("Clinical order placed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Manually requested test (synthetic)", { exact: true }),
  ).toBeVisible();
  await mkdir(".local", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".local/phase3-doctor.png", fullPage: true });
  await page.getByRole("button", { name: "Review completion" }).click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Complete consultation", exact: true })
    .click();
  await expect(
    page.getByText("Consultation completed. One encounter was recorded.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Presenting complaint", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Append a correction" }).click();
  await page
    .getByLabel("Corrected presenting complaint")
    .fill("Append-only synthetic correction");
  await page
    .getByLabel("Corrected assessment")
    .fill("Corrected synthetic assessment");
  await page
    .getByLabel("Reason for consultation correction")
    .fill("Workflow correction verification");
  await page
    .getByLabel("Current password to confirm correction")
    .fill(doctorPassword);
  await page.getByRole("button", { name: "Append signed correction" }).click();
  await expect(
    page.getByText("Correction appended. The original record is unchanged.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic assessment, not clinical advice", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Corrected synthetic assessment", { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".local/phase3-mobile.png", fullPage: true });
  await page.reload();
  await expect(
    page.getByText("Completed", { exact: true }).first(),
  ).toBeVisible();
  // Continue the same isolated synthetic facility through Phase 4, avoiding extra onboarding fixtures.
  const pharmaEmail = `pharmacy-${suffix}@auracare.test`,
    labEmail = `lab-${suffix}@auracare.test`;
  await post(
    api,
    "/staff/invitations",
    { login: pharmaEmail, role: "PHARMACIST" },
    full.access_token,
  );
  const pharmaMail = await mailbox(pharmaEmail, "Join your AuraCare facility");
  const pharmaContext = await page.context().browser()!.newContext({ baseURL });
  const pharmacy = await pharmaContext.newPage();
  await pharmacy.goto(`/invite?token=${/token=([\w-]+)/.exec(pharmaMail)![1]}`);
  await pharmacy.getByLabel("Your name").fill("Morgan Pharmacist");
  await pharmacy
    .getByLabel("New password", { exact: true })
    .fill("a secure pharmacy fixture password");
  await pharmacy.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    pharmacy.getByRole("heading", { name: "Stock & dispensing" }),
  ).toBeVisible();
  const staffResponse = await api.get("/api/v1/staff", {
    headers: { Authorization: `Bearer ${full.access_token}` },
  });
  const staff = (await staffResponse.json()).data as {
    id: string;
    login: string;
  }[];
  await post(
    api,
    `/staff/${staff.find((u) => u.login === pharmaEmail)!.id}/licence-verification`,
    {
      evidence_ref: "Synthetic verification",
      mfa_proof: full.recovery_codes[0],
    },
    full.access_token,
  );
  const receive = pharmacy
    .getByRole("heading", { name: "Receive stock batch" })
    .locator("..");
  await receive
    .getByLabel("Medicine", { exact: true })
    .fill("Example medicine (synthetic)");
  await receive
    .getByLabel("Strength", { exact: true })
    .fill("Synthetic strength");
  await receive.getByLabel("Route", { exact: true }).fill("Manual route");
  await receive.getByLabel("Dispensing unit (e.g. tablet)").fill("tablet");
  await receive.getByLabel("Batch number").fill("SYNTHETIC-BATCH");
  await receive.getByLabel("Expiry date").fill("2090-01-01");
  await receive.getByLabel("Integer stock quantity").fill("10");
  await pharmacy.getByRole("button", { name: "Receive batch" }).click();
  await expect(pharmacy.getByText(/SYNTHETIC-BATCH · Expires/)).toBeVisible();
  await pharmacy
    .getByLabel("Line 1 dispensing unit", { exact: true })
    .fill("tablet");
  await pharmacy
    .getByRole("button", { name: "Dispense full prescription" })
    .click();
  await expect(
    pharmacy.getByRole("heading", {
      name: /Jordan Example · Revision 1 · Dispensed/,
    }),
  ).toBeVisible();
  await pharmaContext.close();

  await post(
    api,
    "/staff/invitations",
    { login: labEmail, role: "LAB" },
    full.access_token,
  );
  const labMail = await mailbox(labEmail, "Join your AuraCare facility");
  const labContext = await page.context().browser()!.newContext();
  const lab = await labContext.newPage();
  await lab.goto(
    `${baseURL}/invite?token=${/token=([\w-]+)/.exec(labMail)![1]}`,
  );
  await lab.getByLabel("Your name").fill("Taylor Laboratory");
  await lab
    .getByLabel("New password", { exact: true })
    .fill("a secure laboratory fixture password");
  await lab
    .getByLabel("Laboratory sign-off PIN (lab staff only, six digits)")
    .fill("827391");
  await lab.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    lab.getByRole("heading", { name: "Samples & results" }),
  ).toBeVisible();
  await lab.getByRole("button", { name: /Jordan Example/ }).click();
  await lab.getByRole("button", { name: "Mark sample collected" }).click();
  await lab
    .getByLabel("Analyte name", { exact: true })
    .fill("Synthetic analyte");
  await lab.getByLabel("Result value", { exact: true }).fill("12");
  await lab.getByLabel("Unit", { exact: true }).fill("u");
  await lab
    .getByLabel("Reference interval", { exact: true })
    .fill("Manual interval");
  await lab.getByRole("button", { name: "Create result draft" }).click();
  await lab.getByLabel("Six-digit diagnostic sign-off PIN").fill("827391");
  await lab.getByRole("button", { name: "Sign result with PIN" }).click();
  await expect(
    lab.getByRole("heading", { name: /Revision 1 · TECH_SIGNED/ }),
  ).toBeVisible();
  await expect(
    lab.getByRole("button", { name: "Release verified result" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Laboratory", exact: true }).click();
  await page.getByRole("button", { name: /Jordan Example/ }).click();
  await page.getByLabel("Current doctor password").fill(doctorPassword);
  await page
    .getByRole("button", { name: "Verify this result revision" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Revision 1 · DOCTOR_VERIFIED/ }),
  ).toBeVisible();
  await lab.reload();
  await lab.getByRole("button", { name: /Jordan Example/ }).click();
  await lab.getByRole("button", { name: "Release verified result" }).click();
  await expect(
    lab.getByRole("heading", { name: /Revision 1 · RELEASED/ }),
  ).toBeVisible();
  await labContext.close();

  const recContext = await page.context().browser()!.newContext();
  const reception = await recContext.newPage();
  await reception.goto(`${baseURL}/login`);
  await reception.getByLabel("Facility subdomain").fill(domain);
  await reception.getByLabel("User ID or email").fill(recEmail);
  await reception
    .getByLabel("Password")
    .fill("a secure reception fixture password");
  await reception.getByRole("button", { name: "Sign in", exact: true }).click();
  await reception.getByRole("tab", { name: "Cash float" }).click();
  await reception.getByLabel("Opening float (₹)").fill("50.00");
  await reception.getByRole("button", { name: "Record opening float" }).click();
  await expect(
    reception.getByText("Opening float recorded.", { exact: true }),
  ).toBeVisible();
  await reception.getByRole("button", { name: "Invoices & receipts" }).click();
  await reception
    .getByLabel("Description", { exact: true })
    .fill("Synthetic consultation");
  await reception.getByLabel("Quantity", { exact: true }).fill("1");
  await reception.getByLabel("Unit price (₹)", { exact: true }).fill("100.00");
  await reception.getByLabel("Tax (%)", { exact: true }).fill("18.00");
  await reception.getByRole("button", { name: "Create invoice draft" }).click();
  await reception
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await reception.getByLabel("Received amount (₹)").fill("118.00");
  await reception.getByRole("button", { name: "Record receipt" }).click();
  await expect(
    reception.getByText(/Total ₹118.00 · Paid ₹118.00 · Balance ₹0.00/),
  ).toBeVisible();
  await reception
    .getByRole("button", { name: "Reception", exact: true })
    .click();
  await reception.getByRole("tab", { name: "Cash float" }).click();
  await reception.getByLabel("Counted cash (₹)").fill("168.00");
  await reception.getByRole("button", { name: "Close cash shift" }).click();
  await expect(reception.getByText("CLOSED", { exact: true })).toBeVisible();
  const cashResponse = await api.get("/api/v1/cash/sessions", {
    headers: { Authorization: `Bearer ${full.access_token}` },
  });
  const cash = (await cashResponse.json()).data[0] as {
    id: string;
    version: number;
  };
  await post(
    api,
    `/cash/sessions/${cash.id}/review`,
    {
      expected_version: cash.version,
      review_note: "Synthetic close reviewed",
      mfa_proof: full.recovery_codes[1],
    },
    full.access_token,
  );
  await reception.reload();
  await reception.getByRole("tab", { name: "Cash float" }).click();
  await expect(reception.getByText("REVIEWED", { exact: true })).toBeVisible();
  await recContext.close();
  // Contact proof activates the existing dormant patient; no new public registration.
  const patientEmail = `patient-${suffix}@auracare.test`;
  await post(api, "/auth/patient-activation-requests", {
    facility_subdomain: domain,
    login: patientEmail,
  });
  const activationMail = await mailbox(
    patientEmail,
    "Activate your AuraCare portal",
  );
  const patientContext = await page.context().browser()!.newContext();
  const patientPage = await patientContext.newPage();
  await patientPage.goto(
    `${baseURL}/patient-activate?token=${/token=([\w-]+)/.exec(activationMail)![1]}`,
  );
  await patientPage.getByLabel("Choose a four-digit portal PIN").fill("5831");
  await patientPage.getByRole("button", { name: "Set my portal PIN" }).click();
  await expect(patientPage.getByRole("status")).toContainText(
    "Portal activated",
  );
  await patientPage.getByRole("link", { name: "Back to sign in" }).click();
  await patientPage.getByLabel("Facility subdomain").fill(domain);
  await patientPage.getByLabel("User ID or email").fill(patientEmail);
  await patientPage
    .getByLabel("Sign in as a patient with a portal PIN")
    .check();
  await patientPage.getByLabel("Four-digit portal PIN").fill("5831");
  await patientPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    patientPage.getByRole("heading", { name: "Welcome, Jordan Example" }),
  ).toBeVisible();
  await patientPage
    .getByRole("button", { name: "Read prescription revision 1" })
    .click();
  await expect(
    patientPage.getByRole("heading", { name: "Prescription · revision 1" }),
  ).toBeVisible();
  const download = patientPage.waitForEvent("download");
  await patientPage
    .getByRole("button", { name: "Download prescription PDF" })
    .click();
  expect((await download).suggestedFilename()).toBe("auracare-record.pdf");
  await patientPage
    .getByRole("button", { name: "Read released result" })
    .click();
  await expect(
    patientPage.getByRole("heading", { name: "Released result · revision 1" }),
  ).toBeVisible();
  await patientPage
    .getByRole("button", { name: "View receipts for INV-000001" })
    .click();
  await expect(patientPage.getByText(/CASH · ₹118.00/)).toBeVisible();
  await patientPage.reload();
  await expect(
    patientPage.getByRole("heading", { name: "Welcome, Jordan Example" }),
  ).toBeVisible();
  await patientContext.close();

  const ownerContext = await page.context().browser()!.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${baseURL}/login`);
  await ownerPage.getByLabel("Facility subdomain").fill(domain);
  await ownerPage.getByLabel("User ID or email").fill(ownerEmail);
  await ownerPage
    .getByLabel("Password", { exact: true })
    .fill("a secure phase three owner password");
  await ownerPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await ownerPage
    .getByLabel("Authenticator code or recovery code")
    .fill(full.recovery_codes[2]!);
  await ownerPage.getByRole("button", { name: "Verify code" }).click();
  await ownerPage.getByRole("button", { name: "Usage & credits" }).click();
  await expect(
    ownerPage.getByText("Pricing not configured", { exact: true }),
  ).toBeVisible();
  await ownerPage
    .getByRole("button", { name: "Record today's usage snapshot" })
    .click();
  await expect(
    ownerPage.getByText(/Completed consultations: 1 · 1 slabs of 100/),
  ).toBeVisible();
  await ownerContext.close();
  await api.dispose();
});
