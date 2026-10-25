import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, downloadDocument } from "./api";
import { useAuth } from "./auth";
import { Brand, Heading, Form } from "./components";
import { rupees } from "./Operations";
interface Overview {
  profile: {
    name: string;
    date_of_birth: string | null;
    contact: { value: string };
  };
  visits: {
    id: string;
    state: string;
    queue_number: number;
    queued_at: string;
  }[];
  prescriptions: { id: string; revision: number; signed_at: string }[];
  lab_orders: {
    id: string;
    state: string;
    tests: { name: string }[];
    released_result_id: string | null;
  }[];
  invoices: {
    id: string;
    number: string;
    state: string;
    total_minor: number;
    paid_minor: number;
    balance_minor: number;
  }[];
  documents: { id: string; kind: string }[];
}
interface Rx {
  revision: number;
  state: string;
  notes: string;
  items: {
    medicine: string;
    strength: string;
    dose: string;
    route: string;
    frequency: string;
    duration: string;
    quantity?: number;
    instructions?: string;
  }[];
}
interface Lab {
  revision: number;
  state: string;
  comments: string;
  observations: {
    name: string;
    value: string;
    unit: string;
    reference_interval: string;
    comments: string;
  }[];
}
interface Receipt {
  id: string;
  method: string;
  amount_minor: number;
  recorded_at: string;
}
export function PatientPortal() {
  const auth = useAuth(),
    [data, setData] = useState<Overview | null>(null),
    [rx, setRx] = useState<Rx | null>(null),
    [lab, setLab] = useState<Lab | null>(null),
    [receipts, setReceipts] = useState<Receipt[]>([]),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setData(await api<Overview>("GET", "/portal"));
    setError("");
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load]);
  const read = async (kind: "rx" | "lab" | "receipts", id: string) => {
    setRx(null);
    setLab(null);
    setReceipts([]);
    try {
      if (kind === "rx") setRx(await api<Rx>("GET", `/prescriptions/${id}`));
      else if (kind === "lab")
        setLab(await api<Lab>("GET", `/lab/results/${id}`));
      else setReceipts(await api<Receipt[]>("GET", `/invoices/${id}/payments`));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  async function pdf(kind: string, id: string) {
    const doc = await api<{ id: string }>(
      "POST",
      "/portal/documents",
      { kind, source_id: id },
      { "Idempotency-Key": crypto.randomUUID() },
    );
    await downloadDocument(doc.id);
    await load();
  }
  return (
    <div className="workspace-main patient-portal">
      <Brand />
      <button
        className="button secondary"
        onClick={() =>
          void auth.logout().catch((e) => setError(errorMessage(e)))
        }
      >
        Sign out
      </button>
      <Heading
        kicker="YOUR PATIENT PORTAL"
        title={data ? `Welcome, ${data.profile.name}` : "Opening your portal"}
      >
        Your visits, signed prescriptions, released results and invoices.
      </Heading>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <button
        className="button secondary"
        onClick={() => {
          setRx(null);
          setLab(null);
          void load().catch((e) => setError(errorMessage(e)));
        }}
      >
        Refresh records
      </button>
      {data && (
        <>
          <section className="panel operations-panel">
            <h2>My details</h2>
            <p>{data.profile.contact.value}</p>
            {data.profile.date_of_birth && (
              <p>Date of birth: {data.profile.date_of_birth}</p>
            )}
            <p>Contact the facility to correct your details.</p>
          </section>
          <section className="panel operations-panel">
            <h2>My visits</h2>
            {data.visits.length ? (
              data.visits.map((v) => (
                <p key={v.id}>
                  Ticket {v.queue_number} · {v.state.replaceAll("_", " ")} ·{" "}
                  {new Date(v.queued_at).toLocaleString()}
                </p>
              ))
            ) : (
              <p>No visits yet.</p>
            )}
          </section>
          <section className="panel operations-panel">
            <h2>Signed prescriptions</h2>
            <p>
              Earlier signed revisions remain in your history. Ask your care
              team which revision currently applies.
            </p>
            {data.prescriptions.map((r) => (
              <article key={r.id}>
                <p>
                  Revision {r.revision} · Signed{" "}
                  {new Date(r.signed_at).toLocaleString()}
                </p>
                <button
                  className="button secondary"
                  onClick={() => void read("rx", r.id)}
                >
                  Read prescription revision {r.revision}
                </button>
                <Form
                  submit="Download prescription PDF"
                  onSubmit={() => pdf("PRESCRIPTION", r.id)}
                >
                  <p>A private copy of this signed revision.</p>
                </Form>
              </article>
            ))}
          </section>
          {rx && (
            <section className="panel operations-panel">
              <h2>Prescription · revision {rx.revision}</h2>
              {rx.items.map((i, n) => (
                <p key={n}>
                  {i.medicine} {i.strength} · {i.dose} · {i.route} ·{" "}
                  {i.frequency} · {i.duration}
                  {i.quantity !== undefined &&
                    ` · Quantity ${i.quantity}`} · {i.instructions}
                </p>
              ))}
              <p>{rx.notes}</p>
            </section>
          )}
          <section className="panel operations-panel">
            <h2>Laboratory</h2>
            {data.lab_orders.map((o) => (
              <article key={o.id}>
                <p>
                  {o.tests.map((t) => t.name).join(", ")} ·{" "}
                  {o.state.replaceAll("_", " ")}
                </p>
                {o.released_result_id ? (
                  <>
                    <button
                      className="button secondary"
                      onClick={() => void read("lab", o.released_result_id!)}
                    >
                      Read released result
                    </button>
                    <Form
                      submit="Download released result PDF"
                      onSubmit={() => pdf("LAB_RESULT", o.released_result_id!)}
                    >
                      <p>
                        This revision has been verified and released by your
                        care team.
                      </p>
                    </Form>
                  </>
                ) : (
                  <p>Your care team has not released a current result.</p>
                )}
              </article>
            ))}
          </section>
          {lab && (
            <section className="panel operations-panel">
              <h2>Released result · revision {lab.revision}</h2>
              {lab.observations.map((o, i) => (
                <p key={i}>
                  {o.name}: {o.value} {o.unit} · Reference interval:{" "}
                  {o.reference_interval} · {o.comments}
                </p>
              ))}
              <p>{lab.comments}</p>
            </section>
          )}
          <section className="panel operations-panel">
            <h2>Invoices & receipts</h2>
            {data.invoices.map((i) => (
              <article key={i.id}>
                <h3>
                  {i.number} · {i.state}
                </h3>
                <p>
                  Total {rupees(i.total_minor)} · Paid {rupees(i.paid_minor)} ·
                  Balance {rupees(i.balance_minor)}
                </p>
                <button
                  className="button secondary"
                  onClick={() => void read("receipts", i.id)}
                >
                  View receipts for {i.number}
                </button>
                {i.state !== "VOID" && (
                  <Form
                    submit="Download invoice PDF"
                    onSubmit={() => pdf("INVOICE", i.id)}
                  >
                    <p>Issued invoice copy.</p>
                  </Form>
                )}
              </article>
            ))}
            {receipts.map((r) => (
              <p key={r.id}>
                {r.method} · {rupees(r.amount_minor)} ·{" "}
                {new Date(r.recorded_at).toLocaleString()}
              </p>
            ))}
          </section>
          <p>
            Each section shows up to 100 recent records. Contact your facility
            for older records.
          </p>
        </>
      )}
    </div>
  );
}
