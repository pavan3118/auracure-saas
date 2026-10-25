import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { mailbox } from "./mailbox.js";
test("real owner onboarding, MFA, Screen 07 invitation and doctor access", async ({
  page,
  browser,
}) => {
  const suffix = randomUUID().slice(0, 8),
    domain = `browser-${suffix}`,
    ownerEmail = `owner-${suffix}@auracare.test`,
    doctorEmail = `doctor-${suffix}@auracare.test`;
  await page.goto("/onboarding");
  await page.getByLabel("Facility name").fill("Cedar Family Clinic");
  await page.getByLabel("Workspace subdomain").fill(domain);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Planned clinician capacity").fill("5");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Full name").fill("Alex Morgan");
  await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
  await page.getByRole("button", { name: "Send verification code" }).click();
  const mail = await mailbox(ownerEmail, "Verify your AuraCare contact");
  const proof = mail.split("Verification code: ")[1]!.split("\n")[0]!;
  await page.getByLabel("Verification code", { exact: true }).fill(proof);
  await page.getByRole("button", { name: "Verify contact" }).click();
  await page
    .getByLabel("Owner password", { exact: true })
    .fill("a secure owner browser password");
  await page
    .getByLabel("Confirm password")
    .fill("a secure owner browser password");
  await page
    .getByRole("button", { name: "Create facility & secure account" })
    .click();
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = await page.locator(".secret-key").innerText();
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
  await page
    .getByLabel("Authenticator code or recovery code")
    .fill(totp.generate());
  await page.getByRole("button", { name: "Confirm MFA" }).click();
  await expect(
    page.getByRole("heading", { name: "Save your recovery codes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I have saved my codes" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Alex." }),
  ).toBeVisible();
  await mkdir(".local", { recursive: true });
  await page.screenshot({ path: ".local/phase1-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Team & access" }).click();
  await page.getByRole("button", { name: "Invite staff", exact: true }).click();
  await page.getByLabel("Staff email").fill(doctorEmail);
  await page.getByLabel("Role", { exact: true }).selectOption("DOCTOR");
  await page.getByRole("button", { name: "Send secure invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation queued");
  const invitation = await mailbox(doctorEmail, "Join your AuraCare facility");
  const inviteToken = /token=([\w-]+)/.exec(invitation)![1]!;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const doctor = await context.newPage();
  await doctor.goto(`http://localhost:5173/invite?token=${inviteToken}`);
  await doctor.getByLabel("Your name").fill("Doctor Taylor");
  await doctor
    .getByLabel("New password", { exact: true })
    .fill("a secure doctor browser password");
  await doctor.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    doctor.getByRole("heading", {
      name: "Ready for your next patient, Doctor?",
    }),
  ).toBeVisible();
  await expect(
    doctor.getByRole("button", { name: "Team & access" }),
  ).toHaveCount(0);
  const denied = await doctor.evaluate(async () => {
    const r = await fetch("/api/v1/staff");
    return r.status;
  });
  expect(denied).toBe(401);
  await doctor.screenshot({ path: ".local/phase1-mobile.png", fullPage: true });
  await doctor.reload();
  await expect(
    doctor.getByRole("heading", {
      name: "Ready for your next patient, Doctor?",
    }),
  ).toBeVisible();
  await doctor.getByRole("button", { name: "Sign out" }).click();
  await expect(
    doctor.getByRole("heading", { name: "Sign in to your facility" }),
  ).toBeVisible();
  await context.close();
});
