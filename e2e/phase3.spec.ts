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
test("doctor claims, records consultation, signs a prescription, orders a test and completes with an appended correction", async ({
  page,
  playwright,
  baseURL,
}) => {
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
  const full = await post<{ access_token: string }>(
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
  await api.dispose();
});
