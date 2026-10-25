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
test("reception registration, check-in, live owner queue, vitals, opening float and cancellation", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const request = await playwright.request.newContext({ baseURL });
  const suffix = randomUUID().slice(0, 8),
    domain = `reception-${suffix}`,
    email = `owner-${suffix}@auracare.test`,
    login = `reception-${suffix}@auracare.test`,
    patientEmail = `patient-${suffix}@auracare.test`;
  const challenge = await post<{ challenge_id: string }>(
    request,
    "/onboarding/contact-challenges",
    { email, desired_subdomain: domain },
  );
  const mail = await mailbox(email, "Verify your AuraCare contact");
  const proof = mail.split("Verification code: ")[1]!.split("\n")[0]!;
  const verified = await post<{ verification_grant: string }>(
    request,
    "/onboarding/contact-challenges/verify",
    { challenge_id: challenge.challenge_id, proof },
  );
  const owner = await post<{ access_token: string }>(
    request,
    "/onboarding/register",
    {
      facility: {
        name: "Maple Community Clinic",
        type: "CLINIC",
        subdomain: domain,
        capacity: 5,
      },
      owner: {
        name: "Casey Owner",
        email,
        password: "a secure phase two owner password",
      },
      ...verified,
    },
  );
  const setup = await post<{ secret: string }>(
    request,
    "/auth/mfa/enroll",
    {},
    owner.access_token,
  );
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(setup.secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  const full = await post<{ access_token: string; recovery_codes: string[] }>(
    request,
    "/auth/mfa/confirm",
    { proof: totp.generate() },
    owner.access_token,
  );
  await post(
    request,
    "/staff/invitations",
    { login, role: "RECEPTIONIST" },
    full.access_token,
  );
  const invitation = await mailbox(login, "Join your AuraCare facility");
  const inviteToken = /token=([\w-]+)/.exec(invitation)![1]!;
  await page.goto(`/invite?token=${inviteToken}`);
  await page.getByLabel("Your name").fill("Riley Reception");
  await page
    .getByLabel("New password", { exact: true })
    .fill("a secure receptionist password");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    page.getByRole("heading", { name: "A warm welcome. A smooth visit." }),
  ).toBeVisible();
  await expect(
    page.getByText("Live updates connected", { exact: true }),
  ).toBeVisible();
  // A separate authenticated owner tab observes the queue without reloading.
  const context = await browser.newContext({ baseURL });
  const observer = await context.newPage();
  await observer.goto("/login");
  await observer.getByLabel("Facility subdomain").fill(domain);
  await observer.getByLabel("User ID or email").fill(email);
  await observer
    .getByLabel("Password", { exact: true })
    .fill("a secure phase two owner password");
  await observer.getByRole("button", { name: "Sign in", exact: true }).click();
  await observer
    .getByLabel("Authenticator code or recovery code")
    .fill(full.recovery_codes[0]!);
  await observer
    .getByRole("button", { name: "Verify code", exact: true })
    .click();
  await observer
    .getByRole("button", { name: "Live queue", exact: true })
    .click();
  await expect(
    observer.getByText("Live updates connected", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await page.getByLabel("Full name", { exact: true }).fill("Morgan Example");
  await page.getByLabel("Email or mobile contact").fill(patientEmail);
  await page.getByLabel("Date of birth (optional)").fill("1992-04-12");
  await page.getByRole("button", { name: "Save patient", exact: true }).click();
  await expect(page.getByText(patientEmail, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByText(/Morgan Example checked in/)).toBeVisible();
  await expect(
    observer.getByText("Morgan Example", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Live queue" }).click();
  await expect(page.getByText("Morgan Example", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record vitals" }).click();
  await page.getByLabel("Temperature (°C)").fill("37.2");
  await page.getByLabel("Systolic pressure (mmHg)").fill("120");
  await page.getByLabel("Diastolic pressure (mmHg)").fill("80");
  await page.getByRole("button", { name: "Save vitals" }).click();
  await expect(
    page.getByText("Vitals recorded.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recorded measurements" }),
  ).toBeVisible();
  await mkdir(".local", { recursive: true });
  await page.screenshot({
    path: ".local/phase2-reception.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close vitals" }).click();
  await page.getByRole("tab", { name: "Cash float" }).click();
  await page.getByLabel("Opening float (₹)").fill("1500.25");
  await page.getByRole("button", { name: "Record opening float" }).click();
  await expect(
    page.getByText("Opening float recorded.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("₹1,500.25", { exact: true })).toBeVisible();
  expect(await page.getByRole("button", { name: "Close shift" }).count()).toBe(
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/phase2-cash-mobile.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Live queue" }).click();
  await page.getByRole("button", { name: "Cancel visit" }).click();
  await page
    .getByLabel("Cancellation reason")
    .fill("Patient rescheduled their visit");
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(
    page.getByText("Visit cancelled. Patient details are retained.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("The queue is clear. Check patients in from the directory."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Patient directory" }).click();
  await expect(page.getByText(patientEmail, { exact: true })).toBeVisible();
  await expect(
    observer.getByText(
      "The queue is clear. Check patients in from the directory.",
    ),
  ).toBeVisible();
  await context.close();
  await request.dispose();
});
