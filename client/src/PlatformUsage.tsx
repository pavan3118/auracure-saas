import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import { Heading, Field, Form, value } from "./components";
import { rupees } from "./Operations";
interface Usage {
  month: string;
  completed_consultations: number;
  consultation_slabs: number;
  consultation_reconciled: boolean;
  clinician_seat_days: number;
  clinician_months: number;
  pdf_byte_days: number;
  pdf_gb_month: number;
  observed_days: string[];
  expected_observed_days: number;
  coverage_complete: boolean;
  measurement: string;
  message_debits: number;
  message_refunds: number;
  wallet: { balance: number; held: number; available: number };
  pricing_status: string;
  estimate_minor: number | null;
  rate_version: string | null;
  sandbox_enabled: boolean;
}
interface Job {
  id: string;
  channel: string;
  state: string;
  template: string;
}
export function PlatformUsage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [usage, setUsage] = useState<Usage | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [patients, setPatients] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    const [u, j, p] = await Promise.all([
      api<Usage>("GET", `/platform/usage?month=${month}`),
      api<Job[]>("GET", "/platform/messages"),
      api<{ items: { id: string; name: string }[] }>("GET", "/patients"),
    ]);
    setUsage(u);
    setJobs(j);
    setPatients(p.items);
    setError("");
  }, [month]);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load]);
  async function post(path: string, body: unknown) {
    const key = keys.current.get(path) ?? crypto.randomUUID();
    keys.current.set(path, key);
    await api("POST", path, body, { "Idempotency-Key": key });
    keys.current.delete(path);
    setNotice("Sandbox action saved.");
    await load();
  }
  return (
    <>
      <Heading kicker="FACILITY USAGE" title="Usage & credit wallet">
        Monthly UTC measurements. Pricing must be configured before any billing
        estimate; charges are disabled.
      </Heading>
      <label className="field">
        Billing month
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {usage && (
        <>
          <section className="panel operations-panel">
            <h2>Four usage meters</h2>
            <p>
              Clinician seats: {usage.clinician_seat_days} observed seat-days (
              {usage.clinician_months.toFixed(3)} seat-months)
            </p>
            <p>
              Completed consultations: {usage.completed_consultations} ·{" "}
              {usage.consultation_slabs} slabs of 100
            </p>
            <p>
              Messaging: {usage.message_debits} credits debited ·{" "}
              {usage.message_refunds} refunded
            </p>
            <p>
              PDF storage: {usage.pdf_byte_days} observed byte-days (
              {usage.pdf_gb_month.toFixed(6)} GB-month)
            </p>
            <p>
              Measurement coverage: {usage.observed_days.length}/
              {usage.expected_observed_days} days ·{" "}
              {usage.coverage_complete
                ? "Complete for observed period"
                : "Incomplete"}
            </p>
            <p>{usage.measurement}</p>
            <p>
              Consultation reconciliation:{" "}
              {usage.consultation_reconciled
                ? "Matched"
                : "Needs investigation"}
            </p>
            <p>
              {usage.estimate_minor === null
                ? "Pricing not configured"
                : `Sandbox estimate: ${rupees(usage.estimate_minor)} · Rate ${usage.rate_version}`}
            </p>
            <Form
              submit="Record today's usage snapshot"
              onSubmit={async () => {
                await api("POST", "/platform/usage/snapshot", {});
                await load();
              }}
            >
              <p>
                Records the first observation of this UTC day. It does not fill
                historical gaps.
              </p>
            </Form>
          </section>
          <section className="panel operations-panel">
            <h2>Messaging credit wallet</h2>
            <p>
              Balance {usage.wallet.balance} · Reserved {usage.wallet.held} ·
              Available {usage.wallet.available}
            </p>
            {usage.sandbox_enabled && (
              <Form
                submit="Add sandbox test credits"
                onSubmit={(d) =>
                  post("/platform/wallet/test-credits", {
                    units: Number(value(d, "units")),
                    mfa_proof: value(d, "proof"),
                  })
                }
              >
                <Field label="Test credit units" name="units" type="number" />
                <Field
                  label="Fresh authenticator or recovery code"
                  name="proof"
                />
                <p>
                  Test credits have no monetary value and are unavailable in
                  production.
                </p>
              </Form>
            )}
          </section>
          {usage.sandbox_enabled && (
            <section className="panel operations-panel">
              <h2>Sandbox messaging</h2>
              <p>
                No WhatsApp or SMS is actually sent. A fixed portal-access
                template can be queued only for a verified registered mobile.
              </p>
              <Form
                submit="Queue sandbox portal reminder"
                onSubmit={(d) =>
                  post("/platform/messages", {
                    patient_id: value(d, "patient"),
                    channel: value(d, "channel"),
                  })
                }
              >
                <label className="field">
                  Patient
                  <select name="patient">
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Channel
                  <select name="channel">
                    <option>WHATSAPP</option>
                    <option>SMS</option>
                  </select>
                </label>
              </Form>
              {jobs.map((j) => (
                <p key={j.id}>
                  {j.channel} · {j.template} · {j.state}
                </p>
              ))}
              <Form
                submit="Prepare sandbox bill preview"
                onSubmit={() => post("/platform/bills/preview", { month })}
              >
                <p>
                  Requires a closed month, complete measurement coverage,
                  reconciled consultations and explicit configured prices. No
                  money is charged.
                </p>
              </Form>
            </section>
          )}
        </>
      )}
    </>
  );
}
