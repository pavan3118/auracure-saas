import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type AuthResult } from "./api";
import { useAuth } from "./auth";
import { PublicLayout, Heading, Form, Field, value } from "./components";
export function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(false);
  return (
    <PublicLayout>
      <section className="auth-card">
        <Heading kicker="WELCOME BACK" title="Sign in to your facility">
          A focused workspace for every member of your team.
        </Heading>
        <Form
          submit="Sign in"
          onSubmit={async (d) => {
            await auth.accept(
              await api<AuthResult>("POST", "/auth/login", {
                facility_subdomain: value(d, "subdomain"),
                login: value(d, "login"),
                ...(patient
                  ? { portal_pin: value(d, "password") }
                  : { password: value(d, "password") }),
              }),
            );
            navigate("/");
          }}
        >
          <Field
            label="Facility subdomain"
            name="subdomain"
            placeholder="your-clinic"
            autoComplete="organization"
          />
          <Field
            label="User ID or email"
            name="login"
            autoComplete="username"
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={patient}
              onChange={(e) => setPatient(e.target.checked)}
            />
            Sign in as a patient with a portal PIN
          </label>
          <Field
            label={patient ? "Four-digit portal PIN" : "Password"}
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={patient ? 4 : undefined}
            maxLength={patient ? 4 : undefined}
          />
          <div className="form-link">
            <Link to="/recover">Forgot your password?</Link>
          </div>
        </Form>
        <p className="auth-footer">
          Setting up a new facility? <Link to="/onboarding">Get started</Link>
        </p>
      </section>
    </PublicLayout>
  );
}
const steps = ["Facility", "Capacity", "Services", "Usage", "Owner"];
export function Onboarding() {
  const auth = useAuth(),
    navigate = useNavigate();
  const [step, setStep] = useState(0),
    [facility, setFacility] = useState({
      name: "",
      type: "CLINIC",
      subdomain: "",
      capacity: 1,
    }),
    [owner, setOwner] = useState({ name: "", email: "" }),
    [challenge, setChallenge] = useState(""),
    [grant, setGrant] = useState(""),
    [ack, setAck] = useState(false);
  const key = useRef(crypto.randomUUID());
  return (
    <PublicLayout>
      <section className="wizard">
        <Heading
          kicker="SCREEN 00 · FACILITY ONBOARDING"
          title="Make room for better care."
        >
          Set up your facility and secure your owner account.
        </Heading>
        <ol className="step-list">
          {steps.map((s, i) => (
            <li
              key={s}
              aria-current={step === i ? "step" : undefined}
              className={step >= i ? "active" : ""}
            >
              <span>{i + 1}</span>
              <small>{s}</small>
            </li>
          ))}
        </ol>
        {step === 0 && (
          <Form
            onSubmit={async (d) => {
              setFacility({
                ...facility,
                name: value(d, "name"),
                type: value(d, "type"),
                subdomain: value(d, "subdomain").toLowerCase(),
              });
              setStep(1);
            }}
          >
            <h2>Tell us about your facility</h2>
            <Field
              label="Facility name"
              name="name"
              minLength={2}
              autoComplete="organization"
            />
            <label className="field">
              Facility type
              <select name="type">
                <option value="CLINIC">Outpatient clinic</option>
                <option value="POLYCLINIC">Polyclinic</option>
                <option value="DIAGNOSTIC_CENTER">Diagnostic center</option>
              </select>
            </label>
            <Field
              label="Workspace subdomain"
              name="subdomain"
              placeholder="your-clinic"
              minLength={3}
              maxLength={40}
            />
            <p className="hint">
              Lowercase letters, numbers and internal hyphens. Availability is
              confirmed when you register.
            </p>
          </Form>
        )}
        {step === 1 && (
          <Form
            onSubmit={async (d) => {
              setFacility({
                ...facility,
                capacity: Number(value(d, "capacity")),
              });
              setStep(2);
            }}
          >
            <h2>Your facility capacity</h2>
            <Field
              label="Planned clinician capacity"
              name="capacity"
              type="number"
            />
            <p className="hint">
              Plan space for your team. This is not an upfront licence
              commitment.
            </p>
          </Form>
        )}
        {step === 2 && (
          <div>
            <h2>Start with a connected team</h2>
            <p>
              Provision your staff after registration in Screen 07. Reception,
              clinical, pharmacy and laboratory workflows will be delivered in
              later phases.
            </p>
            <div className="info-box">
              Phase 1 includes facility onboarding, authentication and staff
              management.
            </div>
            <button className="button primary full" onClick={() => setStep(3)}>
              Continue
            </button>
          </div>
        )}
        {step === 3 && (
          <div>
            <h2>Pay as your facility grows</h2>
            <ul className="meter-list">
              <li>Active clinician seats</li>
              <li>Completed consultations, per 100 encounters</li>
              <li>WhatsApp / SMS credit wallet</li>
              <li>PDF cloud storage</li>
            </ul>
            <div className="info-box">
              Pricing is not configured. No charge or payment mandate is created
              during onboarding.
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              I understand that pricing must be configured before paid
              activation.
            </label>
            <button
              className="button primary full"
              disabled={!ack}
              onClick={() => setStep(4)}
            >
              Continue
            </button>
          </div>
        )}
        {step === 4 && !challenge && (
          <Form
            submit="Send verification code"
            onSubmit={async (d) => {
              const o = {
                name: value(d, "name"),
                email: value(d, "email").toLowerCase(),
              };
              const c = await api<{ challenge_id: string }>(
                "POST",
                "/onboarding/contact-challenges",
                { email: o.email, desired_subdomain: facility.subdomain },
              );
              setOwner(o);
              setChallenge(c.challenge_id);
            }}
          >
            <h2>Create your owner account</h2>
            <Field
              label="Full name"
              name="name"
              autoComplete="name"
              minLength={2}
            />
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
            />
            <p className="hint">
              We will verify this contact before creating your facility.
            </p>
          </Form>
        )}
        {step === 4 && challenge && !grant && (
          <Form
            submit="Verify contact"
            onSubmit={async (d) => {
              const v = await api<{ verification_grant: string }>(
                "POST",
                "/onboarding/contact-challenges/verify",
                { challenge_id: challenge, proof: value(d, "proof") },
              );
              setGrant(v.verification_grant);
            }}
          >
            <h2>Check your inbox</h2>
            <p>
              Enter the verification code sent to {owner.email}. It expires in
              15 minutes.
            </p>
            <Field
              label="Verification code"
              name="proof"
              autoComplete="one-time-code"
            />
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setChallenge("");
                setGrant("");
              }}
            >
              Use a different contact
            </button>
          </Form>
        )}
        {step === 4 && grant && (
          <Form
            submit="Create facility & secure account"
            onSubmit={async (d) => {
              const password = value(d, "password");
              if (password !== value(d, "confirm"))
                throw new Error("Passwords do not match.");
              const r = await api<AuthResult>(
                "POST",
                "/onboarding/register",
                {
                  facility,
                  owner: { ...owner, password },
                  verification_grant: grant,
                },
                { "Idempotency-Key": key.current },
              );
              await auth.accept(r);
              navigate("/");
            }}
          >
            <h2>Your workspace is ready to create</h2>
            <div className="summary">
              <strong>{facility.name}</strong>
              <span>
                {facility.subdomain} · {owner.email}
              </span>
            </div>
            <Field
              label="Owner password"
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
            />
            <Field
              label="Confirm password"
              name="confirm"
              type="password"
              minLength={12}
              autoComplete="new-password"
            />
            <p className="hint">
              At least 12 characters, at most 72 UTF-8 bytes. Mandatory MFA
              enrollment follows.
            </p>
          </Form>
        )}
        {step > 0 && step < 4 && (
          <button
            className="text-button back"
            onClick={() => setStep(step - 1)}
          >
            Back
          </button>
        )}
        <p className="auth-footer">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </PublicLayout>
  );
}
export function SecurityGate() {
  const auth = useAuth();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(
      null,
    ),
    [codes, setCodes] = useState<string[]>(auth.result?.recovery_codes ?? []);
  const r = auth.result;
  if (!r) return null;
  const enrollment = r.purpose === "mfa-enroll";
  return (
    <PublicLayout>
      <section className="auth-card">
        <Heading
          kicker="ACCOUNT SECURITY"
          title={
            codes.length
              ? "Save your recovery codes"
              : enrollment
                ? "Secure your owner account"
                : r.purpose === "password-change"
                  ? "Choose a new password"
                  : "Verify your sign-in"
          }
        >
          Business access stays locked until your security steps are complete.
        </Heading>
        {codes.length ? (
          <>
            <p>
              Keep these single-use codes offline. They will not be shown again.
            </p>
            <div className="recovery-codes">
              {codes.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <button
              className="button primary full"
              onClick={() => {
                setCodes([]);
                void auth.accept({ ...r, recovery_codes: undefined });
              }}
            >
              I have saved my codes
            </button>
          </>
        ) : r.purpose === "password-change" ? (
          <Form
            submit="Change password"
            onSubmit={async (d) =>
              auth.accept(
                await api<AuthResult>("POST", "/auth/password/change", {
                  current: value(d, "current"),
                  new_password: value(d, "password"),
                }),
              )
            }
          >
            <Field label="Temporary password" name="current" type="password" />
            <Field
              label="New password"
              name="password"
              type="password"
              minLength={12}
            />
          </Form>
        ) : (
          <>
            {enrollment && !setup ? (
              <Form
                submit="Set up authenticator"
                onSubmit={async () =>
                  setSetup(await api("POST", "/auth/mfa/enroll", {}))
                }
              >
                <p>
                  Use a TOTP authenticator, such as Google Authenticator or
                  1Password.
                </p>
              </Form>
            ) : (
              <>
                {setup && (
                  <div className="info-box">
                    <p>
                      Add an account to your authenticator using this setup key:
                    </p>
                    <code className="secret-key">{setup.secret}</code>
                    <p className="hint">
                      Keep this key private. Never share it with support.
                    </p>
                  </div>
                )}
                <Form
                  submit={enrollment ? "Confirm MFA" : "Verify code"}
                  onSubmit={async (d) => {
                    const response = await api<AuthResult>(
                      "POST",
                      enrollment ? "/auth/mfa/confirm" : "/auth/mfa/verify",
                      { proof: value(d, "proof") },
                    );
                    await auth.accept(response);
                    if (response.recovery_codes)
                      setCodes(response.recovery_codes);
                  }}
                >
                  <Field
                    label="Authenticator code or recovery code"
                    name="proof"
                    autoComplete="one-time-code"
                  />
                </Form>
              </>
            )}
          </>
        )}
        <button
          className="text-button"
          onClick={() => {
            void auth.logout();
          }}
        >
          Leave this session
        </button>
      </section>
    </PublicLayout>
  );
}
export function Invite() {
  const auth = useAuth(),
    navigate = useNavigate();
  const [inviteToken] = useState(
    () => new URLSearchParams(location.search).get("token") ?? "",
  );
  useEffect(() => {
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <PublicLayout>
      <section className="auth-card">
        <Heading kicker="TEAM INVITATION" title="Welcome to your team">
          Choose your own password to activate your account. Owner accounts
          require MFA next.
        </Heading>
        <Form
          submit="Accept invitation"
          onSubmit={async (d) => {
            await auth.accept(
              await api<AuthResult>("POST", "/auth/invitations/accept", {
                token: inviteToken,
                name: value(d, "name"),
                password: value(d, "password"),
                ...(value(d, "signoff_pin")
                  ? { signoff_pin: value(d, "signoff_pin") }
                  : {}),
              }),
            );
            navigate("/");
          }}
        >
          <Field
            label="Your name"
            name="name"
            autoComplete="name"
            minLength={2}
          />
          <Field
            label="New password"
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
          />
          <Field
            label="Laboratory sign-off PIN (lab staff only, six digits)"
            name="signoff_pin"
            type="password"
            required={false}
            minLength={6}
            maxLength={6}
          />
        </Form>
      </section>
    </PublicLayout>
  );
}
export function Recover() {
  const [patient, setPatient] = useState(false);
  const [recoveryToken] = useState(
      () => new URLSearchParams(location.search).get("token") ?? "",
    ),
    [message, setMessage] = useState("");
  useEffect(() => {
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <PublicLayout>
      <section className="auth-card">
        <Heading
          kicker="ACCOUNT RECOVERY"
          title={
            recoveryToken
              ? patient
                ? "Reset your portal PIN"
                : "Reset your password"
              : "Recover your account"
          }
        >
          Recovery links expire in 15 minutes. Owner MFA is never bypassed.
        </Heading>
        {message ? (
          <div role="status" className="info-box">
            {message}
          </div>
        ) : (
          <Form
            submit={
              recoveryToken
                ? patient
                  ? "Reset portal PIN"
                  : "Reset password"
                : "Send recovery instructions"
            }
            onSubmit={async (d) => {
              if (recoveryToken) {
                await api("POST", "/auth/recovery/complete", {
                  token: recoveryToken,
                  new_password: value(d, "password"),
                  ...(value(d, "proof")
                    ? { mfa_proof: value(d, "proof") }
                    : {}),
                });
                setMessage("Credential reset. Sign in again.");
              } else {
                await api("POST", "/auth/recovery/request", {
                  facility_subdomain: value(d, "subdomain"),
                  login: value(d, "login"),
                });
                setMessage(
                  "If your account is eligible, recovery instructions will be sent.",
                );
              }
            }}
          >
            {recoveryToken ? (
              <>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={patient}
                    onChange={(e) => setPatient(e.target.checked)}
                  />
                  Reset my patient portal PIN
                </label>
                <Field
                  label={patient ? "New four-digit portal PIN" : "New password"}
                  name="password"
                  type="password"
                  minLength={patient ? 4 : 12}
                  maxLength={patient ? 4 : undefined}
                />
                <Field
                  label="Owner authenticator or recovery code (owners only)"
                  name="proof"
                  required={false}
                />
              </>
            ) : (
              <>
                <Field label="Facility subdomain" name="subdomain" />
                <Field label="Registered email" name="login" type="email" />
              </>
            )}
          </Form>
        )}
        <p className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </section>
    </PublicLayout>
  );
}

export function PatientLink() {
  const auth = useAuth(),
    navigate = useNavigate();
  const [code] = useState(
    () => new URLSearchParams(location.search).get("token") ?? "",
  );
  useEffect(() => {
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <PublicLayout>
      <section className="auth-card">
        <Heading kicker="PATIENT SIGN-IN" title="Open your secure session">
          Only continue if you requested this sign-in link.
        </Heading>
        <Form
          submit="Continue to my account"
          onSubmit={async () => {
            await auth.accept(
              await api<AuthResult>("POST", "/auth/otp-exchange", { code }),
            );
            navigate("/");
          }}
        >
          <p>Links are single-use and expire after five minutes.</p>
        </Form>
      </section>
    </PublicLayout>
  );
}
