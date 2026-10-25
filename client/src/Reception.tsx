import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Plus,
  UserRound,
  Clock3,
  RefreshCw,
  ArrowRight,
  Wallet,
  X,
  CheckCircle2,
} from "lucide-react";
import { api, errorMessage } from "./api";
import { useAuth } from "./auth";
import { Field, Form, Heading, value } from "./components";
import {
  type Patient,
  type PatientPage,
  type Visit,
  type Queue,
  type CashFloat,
  type VitalsEntry,
  vitalFields,
} from "./reception-api";
import { useLiveQueue } from "./use-live-queue";
const emptyQueue: Queue = {
  items: [],
  queued_count: 0,
  in_consultation_count: 0,
  limit: 100,
};
const inr = (minor: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    minor / 100,
  );
export function Reception() {
  const { me } = useAuth();
  const receptionist = me!.user.role === "RECEPTIONIST",
    owner = me!.user.role === "OWNER";
  const [tab, setTab] = useState<"patients" | "queue" | "cash">(
      receptionist ? "patients" : "queue",
    ),
    [page, setPage] = useState<PatientPage>({ items: [], next_cursor: null }),
    [queue, setQueue] = useState<Queue>(emptyQueue),
    [cash, setCash] = useState<CashFloat[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | undefined>(),
    [history, setHistory] = useState<(string | undefined)[]>([]),
    [register, setRegister] = useState(false),
    [selected, setSelected] = useState<Patient | null>(null),
    [vitalVisit, setVitalVisit] = useState<Visit | null>(null),
    [cancelling, setCancelling] = useState<Visit | null>(null),
    [busy, setBusy] = useState("");
  const retries = useRef(new Map<string, string>());
  const readQueue = useCallback(async () => {
    try {
      setQueue(await api<Queue>("GET", "/queue"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  const live = useLiveQueue(readQueue);
  const readPatients = useCallback(async () => {
    if (!receptionist) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        q: search,
        limit: "20",
        ...(cursor ? { cursor } : {}),
      });
      setPage(await api<PatientPage>("GET", `/patients?${q}`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [receptionist, search, cursor]);
  const readCash = useCallback(async () => {
    if (!receptionist && !owner) return;
    try {
      setCash(await api<CashFloat[]>("GET", "/cash/sessions"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [receptionist, owner]);
  useEffect(() => {
    void readPatients();
  }, [readPatients]);
  useEffect(() => {
    void readQueue();
    void readCash();
  }, [readQueue, readCash]);
  async function mutate<T>(
    name: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    let key = retries.current.get(name);
    if (!key) {
      key = crypto.randomUUID();
      retries.current.set(name, key);
    }
    const result = await api<T>("POST", path, body, { "Idempotency-Key": key });
    retries.current.delete(name);
    return result;
  }
  async function checkIn(patient: Patient) {
    setBusy(patient.id);
    setError("");
    try {
      const visit = await mutate<Visit>(`checkin:${patient.id}`, "/visits", {
        patient_id: patient.id,
      });
      setNotice(`${patient.name} checked in · queue #${visit.queue_number}.`);
      await Promise.all([readQueue(), readPatients()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  const active = new Set(queue.items.map((v) => v.patient_id));
  return (
    <div className="reception">
      <div className="heading-row">
        <Heading
          kicker={
            receptionist
              ? "RECEPTION · PATIENT SERVICES"
              : "FACILITY · LIVE QUEUE"
          }
          title={
            receptionist
              ? "A warm welcome. A smooth visit."
              : "Your facility, in motion."
          }
        >
          Patient check-in and the live queue, together in one workspace.
        </Heading>
        <span
          className={`status-chip ${live !== "live" ? "muted-status" : ""}`}
          role="status"
        >
          <i />
          {live === "live"
            ? "Live updates connected"
            : live === "connecting"
              ? "Connecting live updates…"
              : "Live updates offline · refreshing periodically"}
        </span>
      </div>
      <div className="stat-grid reception-stats">
        <article className="stat-card">
          <UserRound />
          <span>Waiting in queue</span>
          <strong>{queue.queued_count}</strong>
          <small>Ready for consultation</small>
        </article>
        <article className="stat-card">
          <Clock3 />
          <span>In consultation</span>
          <strong>{queue.in_consultation_count}</strong>
          <small>Assigned visits</small>
        </article>
        <article className="stat-card">
          <CheckCircle2 />
          <span>Today’s workspace</span>
          <strong>Reception ready</strong>
          <small>Patient details stay within your facility</small>
        </article>
      </div>
      <div
        className="reception-tabs"
        role="tablist"
        aria-label="Reception sections"
      >
        {receptionist && (
          <button
            role="tab"
            aria-selected={tab === "patients"}
            onClick={() => setTab("patients")}
          >
            <UserRound size={16} />
            Patient directory
          </button>
        )}
        <button
          role="tab"
          aria-selected={tab === "queue"}
          onClick={() => setTab("queue")}
        >
          <Clock3 size={16} />
          Live queue
        </button>
        {(receptionist || owner) && (
          <button
            role="tab"
            aria-selected={tab === "cash"}
            onClick={() => setTab("cash")}
          >
            <Wallet size={16} />
            Cash float
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="alert error">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="alert success">
          {notice}
          <button
            aria-label="Dismiss confirmation"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {tab === "patients" && receptionist && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Patient directory</h2>
                <p className="hint">
                  Find a patient before creating a new record.
                </p>
              </div>
              <button
                className="button primary"
                onClick={() => {
                  setRegister((v) => !v);
                  setSelected(null);
                }}
              >
                <Plus size={16} />
                Register patient
              </button>
            </div>
            <Form
              className="patient-search"
              submit="Search patients"
              onSubmit={async (d) => {
                setSearch(value(d, "search"));
                setCursor(undefined);
                setHistory([]);
              }}
            >
              <Field
                label="Search name or contact"
                name="search"
                required={false}
                placeholder="Name, email or international mobile"
              />
              <Search size={18} aria-hidden="true" />
            </Form>
          </section>
          {register && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Register a patient</h2>
                <button
                  aria-label="Close registration"
                  onClick={() => setRegister(false)}
                >
                  <X />
                </button>
              </div>
              <Form
                submit="Save patient"
                onSubmit={async (d) => {
                  const patient = await mutate<Patient>(
                    "patient-register",
                    "/patients",
                    {
                      name: value(d, "name"),
                      contact: {
                        type: value(d, "contact_type"),
                        value: value(d, "contact"),
                      },
                      ...(value(d, "date_of_birth")
                        ? { date_of_birth: value(d, "date_of_birth") }
                        : {}),
                    },
                  );
                  setRegister(false);
                  setNotice(`${patient.name} registered. Check in when ready.`);
                  setSearch("");
                  setCursor(undefined);
                  await readPatients();
                }}
              >
                <div className="form-grid">
                  <Field
                    label="Full name"
                    name="name"
                    minLength={2}
                    maxLength={120}
                  />
                  <Field
                    label="Date of birth (optional)"
                    name="date_of_birth"
                    type="date"
                    required={false}
                  />
                  <label className="field">
                    Contact type
                    <select aria-label="Contact type" name="contact_type">
                      <option value="EMAIL">Email</option>
                      <option value="MOBILE">Mobile</option>
                    </select>
                  </label>
                  <Field
                    label="Email or mobile contact"
                    name="contact"
                    placeholder="name@example.com or +919876543210"
                  />
                </div>
                <p className="hint">
                  Use a unique contact. Shared family access is not yet
                  supported. Portal credentials are never displayed at
                  reception.
                </p>
              </Form>
            </section>
          )}
          <section className="panel table-panel">
            <div className="panel-heading">
              <h2>{search ? "Search results" : "Patient records"}</h2>
              <span className="subtle">{page.items.length} shown</span>
            </div>
            {loading ? (
              <p className="empty-state" role="status">
                Loading patients…
              </p>
            ) : page.items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Contact</th>
                      <th>Date of birth</th>
                      <th>Visit</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <small>{p.id.slice(0, 8)}</small>
                        </td>
                        <td>{p.contact?.value}</td>
                        <td>{p.date_of_birth ?? "Not recorded"}</td>
                        <td>
                          <span
                            className={`badge ${active.has(p.id) ? "good" : ""}`}
                          >
                            {active.has(p.id)
                              ? "Checked in"
                              : "No active visit"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setSelected(p)}
                          >
                            Edit details
                          </button>
                          <button
                            className="button secondary"
                            disabled={!!busy || active.has(p.id)}
                            onClick={() => void checkIn(p)}
                          >
                            {busy === p.id ? "Checking in…" : "Check in"}
                            <ArrowRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">
                {search
                  ? "No matching patients. Check the contact before registering a new record."
                  : "No patients yet. Register your first patient to start check-in."}
              </p>
            )}
            <div className="pagination">
              <button
                className="button secondary"
                disabled={!history.length || loading}
                onClick={() => {
                  const previous = [...history];
                  setCursor(previous.pop());
                  setHistory(previous);
                }}
              >
                Previous
              </button>
              <button
                className="button secondary"
                disabled={!page.next_cursor || loading}
                onClick={() => {
                  setHistory([...history, cursor]);
                  setCursor(page.next_cursor!);
                }}
              >
                Next
              </button>
            </div>
          </section>
          {selected && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Edit {selected.name}</h2>
                <button
                  aria-label="Close patient editor"
                  onClick={() => setSelected(null)}
                >
                  <X />
                </button>
              </div>
              <Form
                key={selected.id + selected.version}
                submit="Save changes"
                onSubmit={async (d) => {
                  await api("PATCH", `/patients/${selected.id}`, {
                    name: value(d, "name"),
                    date_of_birth: value(d, "date_of_birth") || null,
                    expected_version: selected.version,
                  });
                  setSelected(null);
                  setNotice("Patient details updated.");
                  await readPatients();
                }}
              >
                <label className="field">
                  Full name
                  <input
                    name="name"
                    defaultValue={selected.name}
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </label>
                <label className="field">
                  Date of birth
                  <input
                    name="date_of_birth"
                    type="date"
                    defaultValue={selected.date_of_birth ?? ""}
                  />
                </label>
                <p className="hint">
                  Contact changes require a separate ownership-verification
                  process.
                </p>
              </Form>
            </section>
          )}
        </>
      )}
      {tab === "queue" && (
        <>
          <section className="panel table-panel">
            <div className="panel-heading">
              <h2>Live facility queue</h2>
              <button
                className="button secondary"
                onClick={() => void readQueue()}
              >
                <RefreshCw size={14} />
                Refresh queue
              </button>
            </div>
            {queue.items.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Queue</th>
                      {(owner || receptionist) && <th>Patient</th>}
                      <th>Status</th>
                      <th>Checked in</th>
                      {(owner || receptionist) && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {queue.items.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <span className="queue-ticket">
                            #{v.queue_number}
                          </span>
                        </td>
                        {(owner || receptionist) && (
                          <td>
                            <strong>{v.patient_name}</strong>
                          </td>
                        )}
                        <td>
                          <span className="badge good">
                            {v.state === "QUEUED"
                              ? "Waiting"
                              : "In consultation"}
                          </span>
                        </td>
                        <td>
                          {new Date(v.queued_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        {(owner || receptionist) && (
                          <td>
                            {v.state === "QUEUED" && (
                              <>
                                {receptionist && (
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      setVitalVisit(v);
                                      setCancelling(null);
                                    }}
                                  >
                                    Record vitals
                                  </button>
                                )}
                                <button
                                  className="text-button danger-text"
                                  onClick={() => {
                                    setCancelling(v);
                                    setVitalVisit(null);
                                  }}
                                >
                                  Cancel visit
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-state">
                The queue is clear. Check patients in from the directory.
              </p>
            )}
            {queue.queued_count + queue.in_consultation_count > queue.limit && (
              <p className="hint queue-limit">
                Showing the first {queue.limit} active visits in queue order.
              </p>
            )}
          </section>
          {vitalVisit && receptionist && (
            <VitalsPanel
              key={vitalVisit.id}
              visit={vitalVisit}
              onClose={() => setVitalVisit(null)}
              onSaved={async () => {
                setNotice("Vitals recorded.");
                await readQueue();
              }}
              mutate={mutate}
            />
          )}
          {cancelling && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Cancel queue #{cancelling.queue_number}</h2>
                <button
                  aria-label="Close cancellation"
                  onClick={() => setCancelling(null)}
                >
                  <X />
                </button>
              </div>
              <Form
                submit="Confirm cancellation"
                onSubmit={async (d) => {
                  await mutate(
                    `cancel:${cancelling.id}`,
                    `/visits/${cancelling.id}/cancel`,
                    {
                      expected_version: cancelling.version,
                      reason: value(d, "reason"),
                    },
                  );
                  setCancelling(null);
                  setNotice("Visit cancelled. Patient details are retained.");
                  await readQueue();
                }}
              >
                <Field
                  label="Cancellation reason"
                  name="reason"
                  minLength={3}
                  maxLength={240}
                />
                <p className="hint">
                  This removes the visit from the waiting queue. Only queued
                  visits can be cancelled here.
                </p>
              </Form>
            </section>
          )}
        </>
      )}
      {tab === "cash" && (receptionist || owner) && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Opening cash float</h2>
              <span className="badge">INR</span>
            </div>
            <p>
              Record the opening float, then reconcile recorded cash receipts at
              shift close.
            </p>
            {receptionist && !cash.some((c) => c.state === "OPEN") && (
              <Form
                submit="Record opening float"
                onSubmit={async (d) => {
                  await mutate("cash-open", "/cash/sessions", {
                    opening_float: value(d, "opening_float"),
                    currency: "INR",
                  });
                  setNotice("Opening float recorded.");
                  await readCash();
                }}
              >
                <Field
                  label="Opening float (₹)"
                  name="opening_float"
                  placeholder="0.00"
                />
                <p className="hint">
                  Use rupees with up to two decimal places. This records a
                  float, not a payment.
                </p>
              </Form>
            )}
            {cash.length ? (
              <div className="cash-records">
                {cash.map((c) => (
                  <article className="cash-record" key={c.id}>
                    <Wallet size={22} />
                    <div>
                      <span>Opening float</span>
                      <strong>{inr(c.opening_float_minor)}</strong>
                      <small>{new Date(c.opened_at).toLocaleString()}</small>
                    </div>
                    <span className="badge good">
                      {c.state === "OPEN" ? "Open shift" : c.state}
                    </span>
                    <div>
                      <p>Expected cash: {inr(c.expected_cash_minor)}</p>
                      {c.counted_cash_minor !== null && (
                        <p>
                          Counted: {inr(c.counted_cash_minor)} · Variance:{" "}
                          {inr(c.variance_minor ?? 0)} · {c.variance_reason}
                        </p>
                      )}
                      {receptionist && c.state === "OPEN" && (
                        <Form
                          submit="Close cash shift"
                          onSubmit={async (d) => {
                            await mutate(
                              `cash-close-${c.id}`,
                              `/cash/sessions/${c.id}/close`,
                              {
                                expected_version: c.version,
                                counted_cash: value(d, "counted"),
                                variance_reason: value(d, "reason"),
                              },
                            );
                            await readCash();
                          }}
                        >
                          <Field label="Counted cash (₹)" name="counted" />
                          <Field
                            label="Variance reason (required if cash differs)"
                            name="reason"
                            required={false}
                          />
                        </Form>
                      )}
                      {owner && c.state === "CLOSED" && (
                        <Form
                          submit="Review cash close"
                          onSubmit={async (d) => {
                            await mutate(
                              `cash-review-${c.id}`,
                              `/cash/sessions/${c.id}/review`,
                              {
                                expected_version: c.version,
                                review_note: value(d, "note"),
                                mfa_proof: value(d, "proof"),
                              },
                            );
                            await readCash();
                          }}
                        >
                          <Field label="Owner review note" name="note" />
                          <Field
                            label="Fresh authenticator or recovery code"
                            name="proof"
                          />
                        </Form>
                      )}
                      {c.review_note && <p>Owner review: {c.review_note}</p>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">No opening float has been recorded.</p>
            )}
            <div className="info-box">
              Expected cash equals opening float plus recorded cash receipts.
              Explain any variance; the owner reviews closed shifts.
            </div>
          </section>
        </>
      )}
    </div>
  );
}
function VitalsPanel({
  visit,
  onClose,
  onSaved,
  mutate,
}: {
  visit: Visit;
  onClose: () => void;
  onSaved: () => Promise<void>;
  mutate: <T>(name: string, path: string, body: unknown) => Promise<T>;
}) {
  const [entries, setEntries] = useState<VitalsEntry[]>([]),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setEntries(await api<VitalsEntry[]>("GET", `/visits/${visit.id}/vitals`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [visit.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Vitals · queue #{visit.queue_number}</h2>
          <p className="hint">
            {visit.patient_name} · record measurements only; no automated
            clinical interpretation.
          </p>
        </div>
        <button aria-label="Close vitals" onClick={onClose}>
          <X />
        </button>
      </div>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      <Form
        submit="Save vitals"
        onSubmit={async (d) => {
          const observations = vitalFields
            .filter((f) => value(d, f.code) !== "")
            .map((f) => ({
              code: f.code,
              value: Number(value(d, f.code)),
              unit: f.unit,
            }));
          if (!observations.length)
            throw new Error("Enter at least one measurement.");
          await mutate(`vitals:${visit.id}`, `/visits/${visit.id}/vitals`, {
            observations,
          });
          await reload();
          await onSaved();
        }}
      >
        <div className="form-grid">
          {vitalFields.map((f) => (
            <label className="field" key={f.code}>
              {f.label} ({f.unit})
              <input name={f.code} type="number" step="any" />
            </label>
          ))}
        </div>
        <p className="hint">
          Enter both blood pressure values together. Saved entries are retained
          as a history.
        </p>
      </Form>
      {entries.length > 0 && (
        <div className="vitals-history">
          <h3>Recorded measurements</h3>
          {entries.map((e) => (
            <article key={e.id}>
              <time>{new Date(e.recorded_at).toLocaleString()}</time>
              <div>
                {e.observations.map((o) => (
                  <span key={o.code}>
                    {vitalFields.find((f) => f.code === o.code)?.label}:{" "}
                    <strong>
                      {o.value} {o.unit}
                    </strong>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
