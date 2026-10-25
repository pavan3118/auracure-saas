import { useEffect, useState } from "react";
import { Plus, LockKeyhole, Check, RefreshCw, X } from "lucide-react";
import { api, errorMessage } from "./api";
import { Form, Field, value } from "./components";
import type { Prescription, Medicine } from "./doctor-api";
const blank = (): Medicine => ({
  medicine: "",
  strength: "",
  dose: "",
  route: "",
  frequency: "",
  duration: "",
  instructions: "",
});
const fields = [
  "medicine",
  "strength",
  "dose",
  "route",
  "frequency",
  "duration",
] as const;
export function PrescriptionEditor({
  initial,
  active,
  reload,
  mutate,
}: {
  initial: Prescription;
  active: boolean;
  reload: () => Promise<void>;
  mutate: <T>(operation: string, path: string, body: unknown) => Promise<T>;
}) {
  const [rx, setRx] = useState(initial),
    [items, setItems] = useState<Medicine[]>(
      initial.items.length ? initial.items : [blank()],
    ),
    [notes, setNotes] = useState(initial.notes),
    [clock, setClock] = useState(Date.now()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [signing, setSigning] = useState(false),
    [revising, setRevising] = useState(false),
    [discarding, setDiscarding] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil((new Date(rx.lease_expires_at ?? 0).getTime() - clock) / 1000),
  );
  const locked =
    rx.state === "DRAFT" && rx.lease_owned && seconds > 0 && active;
  function receive(next: Prescription) {
    setRx(next);
    setClock(Date.now());
  }
  async function lease(renew = false) {
    setError("");
    setBusy(true);
    try {
      receive(
        await api<Prescription>(
          "POST",
          `/prescriptions/${rx.id}/lease${renew ? "/renew" : ""}`,
          { expected_version: rx.version },
        ),
      );
      setNotice(renew ? "Edit lease renewed." : "Edit lease acquired.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      const fresh = await api<Prescription>("GET", `/prescriptions/${rx.id}`);
      receive(fresh);
      setItems(fresh.items.length ? fresh.items : [blank()]);
      setNotes(fresh.notes);
      setDirty(false);
      setError("");
      setNotice("Latest prescription loaded.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const signed = rx.state === "SIGNED";
  if (rx.state === "DISCARDED")
    return (
      <section className="panel">
        <h2>Discarded draft · revision {rx.revision}</h2>
        <p className="hint">
          Retained as an unsigned record. It cannot be dispensed.
        </p>
        <p>{rx.discard_reason}</p>
      </section>
    );
  return (
    <section className="panel prescription-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PRESCRIPTION · REVISION {rx.revision}</span>
          <h2>{signed ? "Signed prescription" : "Prescription draft"}</h2>
        </div>
        <span className={`badge ${signed ? "good" : ""}`}>
          <LockKeyhole size={12} />
          {signed
            ? "Immutable signed record"
            : locked
              ? `Edit lease · ${seconds}s`
              : "Editing locked"}
        </span>
      </div>
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="alert success">
          {notice}
        </div>
      )}
      {signed ? (
        <>
          <div className="medicine-summary">
            {rx.items.map((m, i) => (
              <article key={i}>
                <strong>
                  {m.medicine} · {m.strength}
                </strong>
                <p>
                  {m.dose} · {m.route} · {m.frequency} · {m.duration}
                </p>
                {m.quantity !== undefined && (
                  <small>Quantity: {m.quantity}</small>
                )}
                {m.instructions && <p>{m.instructions}</p>}
              </article>
            ))}
          </div>
          {rx.notes && <p className="clinical-text">{rx.notes}</p>}
          <p className="hint">
            Signed {rx.signed_at ? new Date(rx.signed_at).toLocaleString() : ""}
            . The signed content cannot be edited. A correction creates a new
            draft revision.
          </p>
          {active && (
            <button
              className="button secondary"
              onClick={() => setRevising((v) => !v)}
            >
              Create correction revision
            </button>
          )}
          {revising && (
            <Form
              submit="Create new draft revision"
              onSubmit={async (d) => {
                await mutate(
                  `revision:${rx.id}`,
                  `/prescriptions/${rx.id}/revisions`,
                  { reason: value(d, "reason") },
                );
                setRevising(false);
                await reload();
              }}
            >
              <Field
                label="Reason for prescription correction"
                name="reason"
                minLength={3}
              />
            </Form>
          )}
        </>
      ) : (
        <>
          <div className="editor-toolbar">
            <p className="hint">
              A 120-second inactivity lease protects this draft. Expiry releases
              editing; it never signs or deletes the prescription.
            </p>
            <div>
              <button
                className="button secondary"
                disabled={busy || !active}
                onClick={() => void lease(false)}
              >
                <LockKeyhole size={14} />
                Acquire edit lease
              </button>
              <button
                className="button secondary"
                disabled={busy || !locked}
                onClick={() => void lease(true)}
              >
                Renew edit lease
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw size={14} />
                Reload latest (discard edits)
              </button>
            </div>
          </div>
          <Form
            submit="Save prescription draft"
            onSubmit={async () => {
              if (!locked)
                throw new Error("Acquire an active edit lease before saving.");
              const result = await api<Prescription>(
                "PATCH",
                `/prescriptions/${rx.id}`,
                { expected_version: rx.version, items, notes },
              );
              receive(result);
              setDirty(false);
              setNotice("Prescription draft saved.");
              setSigning(false);
              await reload();
            }}
          >
            <fieldset disabled={!locked || busy}>
              <div className="medicine-lines">
                {items.map((m, index) => (
                  <article className="medicine-line" key={index}>
                    <div className="panel-heading">
                      <h3>Medicine {index + 1}</h3>
                      <button
                        type="button"
                        aria-label={`Remove medicine ${index + 1}`}
                        className="text-button"
                        onClick={() => {
                          setItems(items.filter((_, i) => i !== index));
                          setDirty(true);
                        }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="form-grid">
                      {fields.map((f) => (
                        <label className="field" key={f}>
                          {f === "medicine"
                            ? "Medicine name"
                            : f[0].toUpperCase() + f.slice(1)}
                          <input
                            value={m[f]}
                            required
                            maxLength={f === "medicine" ? 160 : 160}
                            onChange={(e) => {
                              setItems(
                                items.map((line, i) =>
                                  i === index
                                    ? { ...line, [f]: e.target.value }
                                    : line,
                                ),
                              );
                              setDirty(true);
                              setSigning(false);
                            }}
                          />
                        </label>
                      ))}
                      <label className="field">
                        Quantity (optional)
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={m.quantity ?? ""}
                          onChange={(e) => {
                            setItems(
                              items.map((line, i) =>
                                i === index
                                  ? {
                                      ...line,
                                      quantity: e.target.value
                                        ? Number(e.target.value)
                                        : undefined,
                                    }
                                  : line,
                              ),
                            );
                            setDirty(true);
                          }}
                        />
                      </label>
                      <label className="field">
                        Medicine instructions (optional)
                        <input
                          value={m.instructions ?? ""}
                          maxLength={1000}
                          onChange={(e) => {
                            setItems(
                              items.map((line, i) =>
                                i === index
                                  ? { ...line, instructions: e.target.value }
                                  : line,
                              ),
                            );
                            setDirty(true);
                          }}
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={items.length >= 20}
                onClick={() => {
                  setItems([...items, blank()]);
                  setDirty(true);
                }}
              >
                <Plus size={15} />
                Add medicine
              </button>
              <label className="field prescription-notes">
                Prescription notes (optional)
                <textarea
                  value={notes}
                  maxLength={4000}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </fieldset>
            <p className="hint">
              Medicine fields are manually entered. Verify the medicine, dose,
              route, frequency and duration yourself; no dosing or interaction
              checker is provided.
            </p>
          </Form>
          <button
            className="text-button danger-text"
            disabled={!locked}
            onClick={() => setDiscarding((v) => !v)}
          >
            Discard unsigned draft
          </button>
          {discarding && (
            <Form
              submit="Confirm draft discard"
              onSubmit={async (d) => {
                const next = await mutate<Prescription>(
                  `discard:${rx.id}`,
                  `/prescriptions/${rx.id}/discard`,
                  {
                    expected_version: rx.version,
                    reason: value(d, "discard_reason"),
                  },
                );
                receive(next);
                setDiscarding(false);
                await reload();
              }}
            >
              <Field
                label="Reason for discarding unsigned draft"
                name="discard_reason"
                minLength={3}
              />
              <p className="hint">
                The draft is retained for audit and is never issued as a
                prescription.
              </p>
            </Form>
          )}
          <div className="signature-box">
            <div>
              <h3>Review and sign</h3>
              <p>
                Signing locks this revision permanently. Save all edits first.
              </p>
            </div>
            <button
              className="button primary"
              disabled={!locked || dirty || !rx.items.length}
              onClick={() => setSigning((v) => !v)}
            >
              <Check size={16} />
              Review & sign
            </button>
          </div>
          {signing && (
            <Form
              submit="Sign prescription permanently"
              onSubmit={async (d) => {
                if (dirty) throw new Error("Save your changes before signing.");
                const signed = await mutate<Prescription>(
                  `sign:${rx.id}`,
                  `/prescriptions/${rx.id}/sign`,
                  {
                    expected_version: rx.version,
                    password: value(d, "password"),
                  },
                );
                receive(signed);
                setSigning(false);
                setNotice(
                  "Prescription signed. This revision is now immutable.",
                );
                await reload();
              }}
            >
              <Field
                label="Current password to confirm prescription signing"
                name="password"
                type="password"
                autoComplete="current-password"
              />
              <label className="checkbox">
                <input type="checkbox" required />I have reviewed this
                prescription and intend to sign this revision.
              </label>
            </Form>
          )}
        </>
      )}
    </section>
  );
}
