import { useCallback, useEffect, useRef, useState } from "react";
import {
  Stethoscope,
  ArrowRight,
  Clock3,
  FileCheck2,
  Plus,
  X,
} from "lucide-react";
import { api, errorMessage } from "./api";
import { useAuth } from "./auth";
import { Form, Heading, Field, value } from "./components";
import { PrescriptionEditor } from "./PrescriptionEditor";
import {
  type DoctorDetail,
  type DoctorVisit,
  type DoctorWorkspace,
} from "./doctor-api";
import { useLiveQueue } from "./use-live-queue";
import { vitalFields } from "./reception-api";
export function Doctor() {
  const { me } = useAuth();
  const [detail, setDetail] = useState<DoctorDetail | null>(null),
    [ongoing, setOngoing] = useState<DoctorDetail | null>(null),
    [history, setHistory] = useState<DoctorVisit[]>([]),
    [count, setCount] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [showOrders, setShowOrders] = useState(false),
    [showComplete, setShowComplete] = useState(false),
    [showAmend, setShowAmend] = useState(false),
    [noteDirty, setNoteDirty] = useState(false);
  const selected = useRef<string | null>(null),
    retries = useRef(new Map<string, string>());
  const refreshQueue = useCallback(async () => {
    try {
      const q = await api<{ queued_count: number }>("GET", "/queue");
      setCount(q.queued_count);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  const live = useLiveQueue(refreshQueue);
  const load = useCallback(async () => {
    try {
      const [workspace, list] = await Promise.all([
        api<DoctorWorkspace>("GET", "/doctor/workspace"),
        api<DoctorVisit[]>("GET", "/doctor/visits"),
      ]);
      setCount(workspace.queued_count);
      setOngoing(workspace.active);
      setHistory(list);
      if (selected.current) {
        const current = await api<DoctorDetail>(
          "GET",
          `/visits/${selected.current}`,
        );
        setDetail(current);
      } else if (workspace.active) {
        selected.current = workspace.active.visit.id;
        setDetail(workspace.active);
      } else setDetail(null);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function mutate<T>(
    operation: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    let key = retries.current.get(operation);
    if (!key) {
      key = crypto.randomUUID();
      retries.current.set(operation, key);
    }
    const result = await api<T>("POST", path, body, { "Idempotency-Key": key });
    retries.current.delete(operation);
    return result;
  }
  async function claim() {
    setError("");
    setBusy(true);
    try {
      const next = await mutate<DoctorDetail>("claim", "/queue/claim-next", {});
      selected.current = next.visit.id;
      setDetail(next);
      setOngoing(next);
      setNoteDirty(false);
      setNotice(`Queue #${next.visit.queue_number} is assigned to you.`);
      setShowComplete(false);
      await load();
    } catch (e) {
      setError(errorMessage(e));
      await refreshQueue();
    } finally {
      setBusy(false);
    }
  }
  const active = detail?.visit.state === "IN_CONSULTATION";
  return (
    <div className="doctor-workspace">
      <div className="heading-row">
        <Heading
          kicker="DOCTOR · CONSULTATION WORKSPACE"
          title={`Ready for your next patient, ${me?.user.name.split(" ")[0] ?? "doctor"}?`}
        >
          Assigned care, clear records, and deliberate prescription signing.
        </Heading>
        <span className="status-chip">
          <i />
          {live === "live" ? "Live queue connected" : "Queue reconnecting"}
        </span>
      </div>
      <div className="stat-grid">
        <article className="stat-card">
          <Clock3 />
          <span>Waiting for consultation</span>
          <strong>{count}</strong>
          <small>Facility queue</small>
        </article>
        <article className="stat-card">
          <Stethoscope />
          <span>Your current encounter</span>
          <strong>
            {ongoing ? `#${ongoing.visit.queue_number}` : "No active visit"}
          </strong>
          <small>
            {ongoing ? ongoing.patient.name : "Call the next waiting patient"}
          </small>
        </article>
        <article className="stat-card">
          <FileCheck2 />
          <span>Recent assigned encounters</span>
          <strong>{history.length}</strong>
          <small>Latest 50 records</small>
        </article>
      </div>
      {error && (
        <div role="alert" className="alert error">
          {error}
          <button
            aria-label="Dismiss doctor error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="alert success">
          {notice}
          <button
            aria-label="Dismiss doctor confirmation"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <section className="panel call-next">
        <div>
          <h2>Call the next patient</h2>
          <p>
            Claims the earliest waiting ticket for you. Complete your current
            encounter before calling another.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => void claim()}
          disabled={busy || loading || !!ongoing || count === 0}
        >
          Call next
          <ArrowRight size={16} />
        </button>
      </section>
      {ongoing && detail && ongoing.visit.id !== detail.visit.id && (
        <div className="info-box">
          You are viewing a previous record.{" "}
          <button
            className="text-button"
            onClick={() => {
              selected.current = ongoing.visit.id;
              setNoteDirty(false);
              setShowAmend(false);
              void load();
            }}
          >
            Return to current encounter
          </button>
        </div>
      )}
      {loading ? (
        <p className="empty-state" role="status">
          Opening your clinical workspace…
        </p>
      ) : detail ? (
        <>
          <section className="panel patient-context">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  QUEUE #{detail.visit.queue_number} ·{" "}
                  {active ? "IN CONSULTATION" : "COMPLETED RECORD"}
                </span>
                <h2>{detail.patient.name}</h2>
                <p>
                  {detail.patient.date_of_birth
                    ? `Date of birth: ${detail.patient.date_of_birth}`
                    : "Date of birth not recorded"}{" "}
                  · {detail.patient.contact.value}
                </p>
              </div>
              <span className={`badge ${active ? "" : "good"}`}>
                {active ? "Assigned to you" : "Completed"}
              </span>
            </div>
            <div className="doctor-vitals">
              <h3>Reception vitals</h3>
              {detail.vitals.length ? (
                detail.vitals[0]!.observations.map((o) => (
                  <span key={o.code}>
                    {vitalFields.find((f) => f.code === o.code)?.label ??
                      o.code}
                    <strong>
                      {o.value} {o.unit}
                    </strong>
                  </span>
                ))
              ) : (
                <p className="hint">No vitals recorded for this visit.</p>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Consultation notes</h2>
              <span className="badge">
                {detail.consultation?.state === "FINAL"
                  ? "Final record"
                  : "Draft"}
              </span>
            </div>
            {active ? (
              <Form
                key={`${detail.consultation?.id}:${detail.consultation?.version}`}
                submit="Save consultation notes"
                onSubmit={async (d) => {
                  await api(
                    "PATCH",
                    `/visits/${detail.visit.id}/consultation`,
                    {
                      complaint: value(d, "complaint"),
                      assessment: value(d, "assessment"),
                      plan: value(d, "plan"),
                      expected_version: detail.consultation?.version ?? 0,
                    },
                  );
                  setNoteDirty(false);
                  setNotice("Consultation notes saved.");
                  await load();
                }}
              >
                <div onChange={() => setNoteDirty(true)}>
                  <label className="field">
                    Presenting complaint
                    <textarea
                      name="complaint"
                      defaultValue={detail.consultation?.complaint ?? ""}
                      maxLength={4000}
                    />
                  </label>
                  <label className="field">
                    Assessment
                    <textarea
                      name="assessment"
                      defaultValue={detail.consultation?.assessment ?? ""}
                      maxLength={4000}
                    />
                  </label>
                  <label className="field">
                    Plan (optional)
                    <textarea
                      name="plan"
                      defaultValue={detail.consultation?.plan ?? ""}
                      maxLength={4000}
                    />
                  </label>
                </div>
                <p className="hint">
                  Presenting complaint and assessment must be saved before
                  completing this encounter.
                </p>
              </Form>
            ) : (
              <div className="clinical-summary">
                <h3>Presenting complaint</h3>
                <p>{detail.consultation?.complaint}</p>
                <h3>Assessment</h3>
                <p>{detail.consultation?.assessment}</p>
                {detail.consultation?.plan && (
                  <>
                    <h3>Plan</h3>
                    <p>{detail.consultation.plan}</p>
                  </>
                )}
                <button
                  className="button secondary"
                  onClick={() => setShowAmend((v) => !v)}
                >
                  Append a correction
                </button>
              </div>
            )}
          </section>
          {showAmend && !active && (
            <section className="panel">
              <h2>Append consultation correction</h2>
              <p>
                The original completed record is retained. Your correction
                becomes a separate, audited amendment.
              </p>
              <Form
                submit="Append signed correction"
                onSubmit={async (d) => {
                  await mutate(
                    `amend:${detail.visit.id}`,
                    `/visits/${detail.visit.id}/amendments`,
                    {
                      complaint: value(d, "complaint"),
                      assessment: value(d, "assessment"),
                      plan: value(d, "plan"),
                      reason: value(d, "reason"),
                      password: value(d, "password"),
                    },
                  );
                  setShowAmend(false);
                  setNotice(
                    "Correction appended. The original record is unchanged.",
                  );
                  await load();
                }}
              >
                <label className="field">
                  Corrected presenting complaint
                  <textarea name="complaint" required maxLength={4000} />
                </label>
                <label className="field">
                  Corrected assessment
                  <textarea name="assessment" required maxLength={4000} />
                </label>
                <label className="field">
                  Corrected plan (optional)
                  <textarea name="plan" maxLength={4000} />
                </label>
                <Field
                  label="Reason for consultation correction"
                  name="reason"
                  minLength={3}
                />
                <Field
                  label="Current password to confirm correction"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                />
              </Form>
            </section>
          )}
          {detail.amendments.length > 0 && (
            <section className="panel">
              <h2>Append-only corrections</h2>
              {detail.amendments.map((a) => (
                <article className="clinical-summary amendment" key={a.id}>
                  <time>{new Date(a.recorded_at).toLocaleString()}</time>
                  <p>
                    <strong>Reason:</strong> {a.reason}
                  </p>
                  <p>
                    <strong>Complaint:</strong> {a.complaint}
                  </p>
                  <p>
                    <strong>Assessment:</strong> {a.assessment}
                  </p>
                  {a.plan && (
                    <p>
                      <strong>Plan:</strong> {a.plan}
                    </p>
                  )}
                </article>
              ))}
            </section>
          )}
          <div className="heading-row clinical-section">
            <h2>Prescriptions</h2>
            {active &&
              !detail.prescriptions.some((r) => r.state === "DRAFT") &&
              !detail.prescriptions.some((r) => r.state === "SIGNED") && (
                <button
                  className="button secondary"
                  onClick={() => {
                    void mutate(
                      `new-rx:${detail.visit.id}`,
                      `/visits/${detail.visit.id}/prescriptions`,
                      {},
                    )
                      .then(load)
                      .catch((e) => setError(errorMessage(e)));
                  }}
                >
                  <Plus size={15} />
                  Create prescription draft
                </button>
              )}
          </div>
          {detail.prescriptions.length ? (
            detail.prescriptions.map((rx) => (
              <PrescriptionEditor
                key={rx.id}
                initial={rx}
                active={
                  !!active &&
                  (rx.state === "DRAFT" ||
                    (rx.id ===
                      detail.prescriptions.find((r) => r.state === "SIGNED")
                        ?.id &&
                      !detail.prescriptions.some((r) => r.state === "DRAFT")))
                }
                reload={load}
                mutate={mutate}
              />
            ))
          ) : (
            <section className="panel">
              <p className="empty-state">
                No prescription. A consultation can be completed without
                medication.
              </p>
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>Lab & additional service orders</h2>
              {active && (
                <button
                  className="button secondary"
                  onClick={() => setShowOrders((v) => !v)}
                >
                  <Plus size={15} />
                  Add order
                </button>
              )}
            </div>
            <p className="hint">
              Manual requests only. Pricing, sample processing and result
              release are delivered in Phase 4.
            </p>
            {showOrders && active && (
              <Form
                submit="Place clinical order"
                onSubmit={async (d) => {
                  const name = value(d, "name"),
                    instructions = value(d, "instructions");
                  if (value(d, "kind") === "LAB")
                    await mutate(`lab:${detail.visit.id}`, "/lab/orders", {
                      visit_id: detail.visit.id,
                      tests: [{ name, instructions }],
                    });
                  else
                    await mutate(
                      `service:${detail.visit.id}`,
                      `/visits/${detail.visit.id}/service-orders`,
                      { name, instructions },
                    );
                  setShowOrders(false);
                  setNotice("Clinical order placed.");
                  await load();
                }}
              >
                <label className="field">
                  Order type
                  <select aria-label="Order type" name="kind">
                    <option value="LAB">Laboratory test</option>
                    <option value="SERVICE">Additional service</option>
                  </select>
                </label>
                <Field label="Test or service name" name="name" minLength={2} />
                <Field
                  label="Clinical order instructions (optional)"
                  name="instructions"
                  required={false}
                />
              </Form>
            )}
            <div className="clinical-orders">
              {detail.lab_orders.map((o) => (
                <article key={o.id}>
                  <span className="badge">LAB · {o.state}</span>
                  {o.tests.map((t, i) => (
                    <div key={i}>
                      <strong>{t.name}</strong>
                      {t.instructions && <p>{t.instructions}</p>}
                    </div>
                  ))}
                </article>
              ))}
              {detail.service_orders.map((o) => (
                <article key={o.id}>
                  <span className="badge">SERVICE · {o.state}</span>
                  <strong>{o.name}</strong>
                  {o.instructions && <p>{o.instructions}</p>}
                </article>
              ))}
            </div>
          </section>
          {active && (
            <section className="panel completion-panel">
              <div className="panel-heading">
                <div>
                  <h2>Complete this consultation</h2>
                  <p>
                    Finalizes the saved note and records one completed
                    encounter. Signed prescriptions stay immutable.
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={
                    noteDirty ||
                    detail.prescriptions.some((r) => r.state === "DRAFT")
                  }
                  onClick={() => setShowComplete((v) => !v)}
                >
                  Review completion
                </button>
              </div>
              {noteDirty && (
                <p className="hint">Save your consultation changes first.</p>
              )}
              {detail.prescriptions.some((r) => r.state === "DRAFT") && (
                <p className="hint">
                  Sign the prescription draft before completing.
                </p>
              )}
              {showComplete && (
                <Form
                  submit="Complete consultation"
                  onSubmit={async () => {
                    if (noteDirty)
                      throw new Error("Save the consultation first.");
                    const current = await api<DoctorDetail>(
                      "GET",
                      `/visits/${detail.visit.id}`,
                    );
                    if (current.visit.state === "COMPLETED") {
                      setShowComplete(false);
                      setNotice(
                        "Consultation was already completed. No additional encounter was recorded.",
                      );
                      await load();
                      return;
                    }
                    await mutate(
                      `complete:${detail.visit.id}`,
                      `/visits/${detail.visit.id}/complete`,
                      { expected_version: current.visit.version },
                    );
                    setShowComplete(false);
                    setNotice(
                      "Consultation completed. One encounter was recorded.",
                    );
                    await load();
                  }}
                >
                  <label className="checkbox">
                    <input type="checkbox" required />I have reviewed the saved
                    consultation and intend to complete this encounter.
                  </label>
                </Form>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="panel empty-clinical">
          <Stethoscope size={34} />
          <h2>Your clinical workspace is clear.</h2>
          <p>Call the next patient when you’re ready to begin.</p>
        </section>
      )}
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>Your recent encounters</h2>
          <span className="subtle">Latest 50</span>
        </div>
        {history.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Status</th>
                  <th>Assigned</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {history.map((v) => (
                  <tr key={v.id}>
                    <td>#{v.queue_number}</td>
                    <td>
                      <span className="badge">
                        {v.state === "COMPLETED"
                          ? "Completed"
                          : "In consultation"}
                      </span>
                    </td>
                    <td>
                      {v.claimed_at
                        ? new Date(v.claimed_at).toLocaleString()
                        : ""}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={noteDirty}
                        onClick={() => {
                          selected.current = v.id;
                          setShowComplete(false);
                          setShowAmend(false);
                          void load();
                        }}
                      >
                        Open encounter
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">No assigned encounters yet.</p>
        )}
      </section>
    </div>
  );
}
