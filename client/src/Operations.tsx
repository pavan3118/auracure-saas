import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import { useAuth } from "./auth";
import { Field, Form, Heading, value } from "./components";
export const rupees = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    n / 100,
  );
function useActions() {
  const keys = useRef(new Map<string, string>()),
    [notice, setNotice] = useState("");
  const post = async <T,>(path: string, body: unknown) => {
    const k = keys.current.get(path) ?? crypto.randomUUID();
    keys.current.set(path, k);
    const result = await api<T>("POST", path, body, { "Idempotency-Key": k });
    keys.current.delete(path);
    setNotice("Saved successfully.");
    return result;
  };
  return { post, notice };
}
interface Invoice {
  id: string;
  patient_id: string;
  patient_name: string;
  number: string | null;
  state: string;
  version: number;
  total_minor: number;
  paid_minor: number;
  balance_minor: number;
  lines: {
    description: string;
    quantity: number;
    unit_price_minor: number;
    tax_basis_points: number;
    total_minor: number;
  }[];
}
interface Receipt {
  id: string;
  method: string;
  amount_minor: number;
  external_reference: string;
}
export function Billing() {
  const role = useAuth().me!.user.role,
    { post, notice } = useActions();
  const [rows, setRows] = useState<Invoice[]>([]),
    [patients, setPatients] = useState<{ id: string; name: string }[]>([]),
    [selected, setSelected] = useState<Invoice | null>(null),
    [receipts, setReceipts] = useState<Receipt[]>([]),
    [error, setError] = useState(""),
    [lineCount, setLineCount] = useState(1);
  const load = useCallback(async () => {
    const [list, pat] = await Promise.all([
      api<Invoice[]>("GET", "/invoices"),
      api<{ items: { id: string; name: string }[] }>("GET", "/patients"),
    ]);
    setRows(list);
    setPatients(pat.items);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load]);
  async function choose(i: Invoice) {
    setSelected(i);
    setReceipts(await api<Receipt[]>("GET", `/invoices/${i.id}/payments`));
  }
  async function refresh(id: string) {
    await load();
    await choose(await api<Invoice>("GET", `/invoices/${id}`));
  }
  function lines(d: FormData) {
    return Array.from({ length: lineCount }, (_, i) => ({
      description: value(d, `description${i}`),
      quantity: Number(value(d, `quantity${i}`)),
      unit_price: value(d, `price${i}`),
      tax_percent: value(d, `tax${i}`),
    }));
  }
  return (
    <>
      <Heading kicker="INR · INVOICES & RECEIPTS" title="Billing">
        Record prices and taxes explicitly. UPI and card receipts record
        payments already collected.
      </Heading>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section className="panel form-panel">
        <h2>New invoice</h2>
        <Form
          submit="Find patient"
          onSubmit={async (d) => {
            const found = await api<{ items: { id: string; name: string }[] }>(
              "GET",
              `/patients?q=${encodeURIComponent(value(d, "search"))}&limit=50`,
            );
            setPatients(found.items);
          }}
        >
          <Field
            label="Search patient by name or contact"
            name="search"
            required={false}
          />
        </Form>
        <Form
          submit="Create invoice draft"
          onSubmit={async (d) => {
            const i = await post<Invoice>("/invoices", {
              patient_id: value(d, "patient"),
              lines: lines(d),
            });
            await load();
            await choose(i);
          }}
        >
          <label className="field">
            Patient
            <select name="patient" required>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {Array.from({ length: lineCount }, (_, i) => (
            <fieldset key={i}>
              <legend>Line {i + 1}</legend>
              <Field label="Description" name={`description${i}`} />
              <Field label="Quantity" name={`quantity${i}`} type="number" />
              <Field label="Unit price (₹)" name={`price${i}`} />
              <Field label="Tax (%)" name={`tax${i}`} />
            </fieldset>
          ))}
          {lineCount < 50 && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setLineCount((n) => n + 1)}
            >
              Add invoice line
            </button>
          )}
        </Form>
      </section>
      <section className="panel operations-panel">
        <h2>Invoices</h2>
        <p>
          Latest 100 invoices. Search patients when they are absent from the
          choices.
        </p>
        {rows.map((i) => (
          <button
            className="button secondary"
            key={i.id}
            onClick={() =>
              void choose(i).catch((e) => setError(errorMessage(e)))
            }
          >
            {i.number ?? "Draft"} · {i.patient_name} · {i.state} ·{" "}
            {rupees(i.total_minor)}
          </button>
        ))}
      </section>
      {selected && (
        <section
          className="panel operations-panel"
          key={`${selected.id}:${selected.version}`}
        >
          <h2>
            {selected.number ?? "Invoice draft"} · {selected.patient_name}
          </h2>
          {selected.lines.map((l, i) => (
            <p key={i}>
              {l.description} · {l.quantity} × {rupees(l.unit_price_minor)} ·
              Tax {l.tax_basis_points / 100}% · {rupees(l.total_minor)}
            </p>
          ))}
          <p>
            Total {rupees(selected.total_minor)} · Paid{" "}
            {rupees(selected.paid_minor)} · Balance{" "}
            {rupees(selected.balance_minor)}
          </p>
          {selected.state === "DRAFT" && (
            <>
              <Form
                submit="Save draft changes"
                onSubmit={async (d) => {
                  await api("PATCH", `/invoices/${selected.id}`, {
                    expected_version: selected.version,
                    lines: selected.lines.map((l, i) => ({
                      description: value(d, `editDescription${i}`),
                      quantity: Number(value(d, `editQuantity${i}`)),
                      unit_price: value(d, `editPrice${i}`),
                      tax_percent: value(d, `editTax${i}`),
                    })),
                  });
                  await refresh(selected.id);
                }}
              >
                {selected.lines.map((l, i) => (
                  <fieldset key={i}>
                    <legend>Line {i + 1}</legend>
                    {[
                      ["Description", `editDescription${i}`, l.description],
                      ["Quantity", `editQuantity${i}`, String(l.quantity)],
                      [
                        "Unit price (₹)",
                        `editPrice${i}`,
                        (l.unit_price_minor / 100).toFixed(2),
                      ],
                      [
                        "Tax (%)",
                        `editTax${i}`,
                        String(l.tax_basis_points / 100),
                      ],
                    ].map(([label, name, v]) => (
                      <label className="field" key={name}>
                        {label}
                        <input name={name} defaultValue={v} required />
                      </label>
                    ))}
                  </fieldset>
                ))}
              </Form>
              <Form
                submit="Issue invoice"
                onSubmit={async () => {
                  await post(`/invoices/${selected.id}/issue`, {
                    expected_version: selected.version,
                  });
                  await refresh(selected.id);
                }}
              >
                <p>Issuing assigns a sequential number and locks the lines.</p>
              </Form>
            </>
          )}
          {role === "RECEPTIONIST" &&
            ["ISSUED", "PARTIALLY_PAID"].includes(selected.state) && (
              <Form
                submit="Record receipt"
                onSubmit={async (d) => {
                  await post(`/invoices/${selected.id}/payments`, {
                    amount: value(d, "amount"),
                    method: value(d, "method"),
                    external_reference: value(d, "reference"),
                  });
                  await refresh(selected.id);
                }}
              >
                <Field label="Received amount (₹)" name="amount" />
                <label className="field">
                  Payment method
                  <select name="method">
                    <option>CASH</option>
                    <option>UPI</option>
                    <option>CARD</option>
                  </select>
                </label>
                <Field
                  label="Transaction reference (noncash only; never card details)"
                  name="reference"
                  required={false}
                />
                <p>
                  Cash requires your open shift. Record only money already
                  received.
                </p>
              </Form>
            )}
          {role === "OWNER" &&
            selected.paid_minor === 0 &&
            ["DRAFT", "ISSUED"].includes(selected.state) && (
              <Form
                submit="Void unpaid invoice"
                onSubmit={async (d) => {
                  await post(`/invoices/${selected.id}/void`, {
                    expected_version: selected.version,
                    reason: value(d, "reason"),
                    mfa_proof: value(d, "proof"),
                  });
                  await refresh(selected.id);
                }}
              >
                <Field label="Void reason" name="reason" />
                <Field
                  label="Fresh authenticator or recovery code"
                  name="proof"
                />
              </Form>
            )}
          <h3>Receipts</h3>
          {receipts.map((r) => (
            <p key={r.id}>
              {r.method} · {rupees(r.amount_minor)} · {r.external_reference}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
interface Batch {
  id: string;
  medicine: string;
  strength: string;
  route: string;
  unit: string;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  version: number;
}
interface Rx {
  id: string;
  patient_name: string;
  revision: number;
  dispensed: boolean;
  dispense?: {
    id: string;
    allocations: {
      batchNumber: string;
      expiryDate: string;
      medicine: string;
      quantity: number;
      unit: string;
    }[];
  } | null;
  items: {
    medicine: string;
    strength: string;
    route: string;
    dose: string;
    frequency: string;
    duration: string;
    quantity?: number;
  }[];
}
interface Swap {
  id: string;
  prescription_id: string;
  line_index: number;
  medicine: string;
  strength: string;
  route: string;
  unit: string;
  reason: string;
  state: string;
  original: Rx["items"][number] | null;
}
const productFields = (
  <>
    <Field label="Medicine" name="medicine" />
    <Field label="Strength" name="strength" />
    <Field label="Route" name="route" />
    <Field label="Dispensing unit (e.g. tablet)" name="unit" />
  </>
);
const product = (d: FormData) => ({
  medicine: value(d, "medicine"),
  strength: value(d, "strength"),
  route: value(d, "route"),
  unit: value(d, "unit"),
});
export function Pharmacy() {
  const doctor = useAuth().me!.user.role === "DOCTOR",
    { post, notice } = useActions();
  const [batches, setBatches] = useState<Batch[]>([]),
    [rxs, setRxs] = useState<Rx[]>([]),
    [swaps, setSwaps] = useState<Swap[]>([]),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    setSwaps(await api<Swap[]>("GET", "/pharmacy/substitutions"));
    if (!doctor) {
      setBatches(await api<Batch[]>("GET", "/pharmacy/batches"));
      setRxs(await api<Rx[]>("GET", "/pharmacy/prescriptions"));
    }
  }, [doctor]);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load]);
  return (
    <>
      <Heading
        kicker="PHARMACY"
        title={doctor ? "Review generic substitutions" : "Stock & dispensing"}
      >
        Exact medicine, strength, route and unit. Stock uses earliest expiry
        first in Asia/Kolkata.
      </Heading>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!doctor && (
        <>
          <section className="panel form-panel">
            <h2>Receive stock batch</h2>
            <p>
              A verified pharmacist licence is required for stock and dispensing
              actions.
            </p>
            <Form
              submit="Receive batch"
              onSubmit={async (d) => {
                await post("/pharmacy/batches", {
                  ...product(d),
                  batch_number: value(d, "batch"),
                  expiry_date: value(d, "expiry"),
                  quantity: Number(value(d, "quantity")),
                });
                await load();
              }}
            >
              {productFields}
              <Field label="Batch number" name="batch" />
              <Field label="Expiry date" name="expiry" type="date" />
              <Field
                label="Integer stock quantity"
                name="quantity"
                type="number"
              />
            </Form>
          </section>
          <section className="panel operations-panel">
            <h2>Stock batches</h2>
            <p>Earliest 100 batches. Expired stock cannot be dispensed.</p>
            {batches.map((b) => (
              <article key={`${b.id}:${b.version}`}>
                <h3>
                  {b.medicine} · {b.strength} · {b.route}
                </h3>
                <p>
                  {b.batch_number} · Expires {b.expiry_date} · {b.quantity}{" "}
                  {b.unit}
                </p>
                <Form
                  submit="Adjust quantity"
                  onSubmit={async (d) => {
                    await post(`/pharmacy/batches/${b.id}/adjustments`, {
                      delta: Number(value(d, "delta")),
                      reason: value(d, "reason"),
                      expected_version: b.version,
                    });
                    await load();
                  }}
                >
                  <Field
                    label="Quantity change (+ or − integer)"
                    name="delta"
                    type="number"
                  />
                  <Field label="Adjustment reason" name="reason" />
                </Form>
              </article>
            ))}
          </section>
          <section className="panel operations-panel">
            <h2>Signed prescriptions</h2>
            <p>
              Latest applicable revisions from the latest 100 signed
              prescriptions. Full dispensing requires an integer quantity on
              every line.
            </p>
            {rxs.map((rx) => (
              <article key={rx.id}>
                <h3>
                  {rx.patient_name} · Revision {rx.revision} ·{" "}
                  {rx.dispensed ? "Dispensed" : "Awaiting dispensing"}
                </h3>
                {rx.items.map((l, i) => (
                  <p key={i}>
                    Line {i + 1}: {l.medicine} {l.strength} · {l.dose} ·{" "}
                    {l.route} · {l.frequency} · {l.duration} · Quantity{" "}
                    {l.quantity ?? "not prescribed"}
                  </p>
                ))}
                {rx.dispense && (
                  <div>
                    <h4>Dispense record</h4>
                    {rx.dispense.allocations.map((a, i) => (
                      <p key={i}>
                        {a.medicine} · Batch {a.batchNumber} · Expires{" "}
                        {a.expiryDate} · {a.quantity} {a.unit}
                      </p>
                    ))}
                  </div>
                )}
                {!rx.dispensed && (
                  <>
                    <Form
                      submit="Dispense full prescription"
                      onSubmit={async (d) => {
                        await post(`/prescriptions/${rx.id}/dispense`, {
                          line_units: rx.items.map((_l, i) => ({
                            line_index: i,
                            unit: value(d, `unit${i}`),
                            ...(value(d, `swap${i}`)
                              ? { substitution_id: value(d, `swap${i}`) }
                              : {}),
                          })),
                        });
                        await load();
                      }}
                    >
                      {rx.items.map((_l, i) => (
                        <fieldset key={i}>
                          <legend>Line {i + 1}</legend>
                          <Field
                            label={`Line ${i + 1} dispensing unit`}
                            name={`unit${i}`}
                          />
                          <label className="field">
                            Approved alternative
                            <select name={`swap${i}`}>
                              <option value="">Exact prescribed product</option>
                              {swaps
                                .filter(
                                  (s) =>
                                    s.prescription_id === rx.id &&
                                    s.line_index === i &&
                                    s.state === "APPROVED",
                                )
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.medicine} · {s.strength} · {s.route} ·{" "}
                                    {s.unit}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </fieldset>
                      ))}
                    </Form>
                    <Form
                      submit="Request doctor approval for alternative"
                      onSubmit={async (d) => {
                        await post(`/prescriptions/${rx.id}/substitutions`, {
                          ...product(d),
                          line_index: Number(value(d, "line")) - 1,
                          reason: value(d, "reason"),
                        });
                        await load();
                      }}
                    >
                      <Field
                        label="Prescription line number"
                        name="line"
                        type="number"
                      />
                      {productFields}
                      <Field label="Substitution reason" name="reason" />
                      <p>
                        Strength and route must stay the same. A dose conversion
                        needs a new prescription.
                      </p>
                    </Form>
                  </>
                )}
              </article>
            ))}
          </section>
        </>
      )}
      <section className="panel operations-panel">
        <h2>Generic substitution approvals</h2>
        {swaps.map((s) => (
          <article key={s.id}>
            <h3>
              Line {s.line_index + 1} · {s.state}
            </h3>
            <p>
              Prescribed: {s.original?.medicine} · {s.original?.strength} ·{" "}
              {s.original?.route} · {s.original?.dose} · {s.original?.frequency}
            </p>
            <p>
              Alternative: {s.medicine} · {s.strength} · {s.route} · {s.unit}
            </p>
            <p>Reason: {s.reason}</p>
            {doctor && s.state === "REQUESTED" && (
              <Form
                submit="Approve exact alternative"
                onSubmit={async (d) => {
                  await post(`/pharmacy/substitutions/${s.id}/approve`, {
                    password: value(d, "password"),
                  });
                  await load();
                }}
              >
                <Field
                  label="Current doctor password"
                  name="password"
                  type="password"
                />
              </Form>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
interface Order {
  id: string;
  patient_name: string;
  tests: { name: string; instructions?: string }[];
  state: string;
  version: number;
  current_result_id: string | null;
}
interface Result {
  id: string;
  revision: number;
  version: number;
  state: string;
  comments: string;
  correction_reason: string;
  observations: {
    name: string;
    value: string;
    unit: string;
    reference_interval: string;
    comments: string;
  }[];
}
export function Laboratory() {
  const doctor = useAuth().me!.user.role === "DOCTOR",
    { post, notice } = useActions();
  const [orders, setOrders] = useState<Order[]>([]),
    [selected, setSelected] = useState<Order | null>(null),
    [results, setResults] = useState<Result[]>([]),
    [error, setError] = useState(""),
    [count, setCount] = useState(1);
  const load = useCallback(async () => {
    const list = await api<Order[]>("GET", "/lab/orders");
    setOrders(list);
    return list;
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load]);
  async function choose(o: Order) {
    setSelected(o);
    setResults(await api<Result[]>("GET", `/lab/orders/${o.id}/results`));
  }
  async function refresh() {
    const list = await load();
    if (selected) {
      const o = list.find((o) => o.id === selected.id);
      if (o) await choose(o);
    }
  }
  const current = results.find((r) => r.id === selected?.current_result_id);
  function observations(d: FormData, n: number, prefix = "") {
    return Array.from({ length: n }, (_, i) => ({
      name: value(d, `${prefix}name${i}`),
      value: value(d, `${prefix}value${i}`),
      unit: value(d, `${prefix}unit${i}`),
      reference_interval: value(d, `${prefix}range${i}`),
      comments: value(d, `${prefix}comment${i}`),
    }));
  }
  function fields(n: number) {
    return Array.from({ length: n }, (_, i) => (
      <fieldset key={i}>
        <legend>Analyte {i + 1}</legend>
        <Field label="Analyte name" name={`name${i}`} />
        <Field label="Result value" name={`value${i}`} />
        <Field label="Unit" name={`unit${i}`} required={false} />
        <Field label="Reference interval" name={`range${i}`} required={false} />
        <Field label="Analyte comment" name={`comment${i}`} required={false} />
      </fieldset>
    ));
  }
  return (
    <>
      <Heading
        kicker="LABORATORY"
        title={doctor ? "Verify laboratory results" : "Samples & results"}
      >
        Manual observations. Technician sign-off, requesting doctor
        verification, then explicit lab release.
      </Heading>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section className="panel operations-panel">
        <h2>Latest 100 orders</h2>
        {orders.map((o) => (
          <button
            className="button secondary"
            key={o.id}
            onClick={() =>
              void choose(o).catch((e) => setError(errorMessage(e)))
            }
          >
            {o.patient_name} · {o.tests.map((t) => t.name).join(", ")} ·{" "}
            {o.state}
          </button>
        ))}
      </section>
      {selected && (
        <section
          className="panel operations-panel"
          key={`${selected.id}:${selected.version}`}
        >
          <h2>
            {selected.patient_name} · {selected.state}
          </h2>
          {selected.tests.map((t, i) => (
            <p key={i}>
              {t.name} · {t.instructions}
            </p>
          ))}
          {!doctor && selected.state === "ORDERED" && (
            <Form
              submit="Mark sample collected"
              onSubmit={async () => {
                await post(`/lab/orders/${selected.id}/collect`, {
                  state: "COLLECTED",
                  expected_version: selected.version,
                });
                await refresh();
              }}
            >
              <p>Confirm the requested sample was collected.</p>
            </Form>
          )}
          {!doctor &&
            [
              "COLLECTED",
              "TECH_SIGNED",
              "DOCTOR_VERIFIED",
              "RELEASED",
            ].includes(selected.state) && (
              <Form
                submit={
                  current ? "Create correction draft" : "Create result draft"
                }
                onSubmit={async (d) => {
                  await post(`/lab/orders/${selected.id}/results`, {
                    observations: observations(d, count),
                    comments: value(d, "comments"),
                    correction_reason: value(d, "reason"),
                  });
                  await refresh();
                }}
              >
                {fields(count)}
                {count < 50 && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setCount((n) => n + 1)}
                  >
                    Add analyte
                  </button>
                )}
                <Field
                  label="Result comments"
                  name="comments"
                  required={false}
                />
                <Field
                  label="Correction reason (required for a new revision)"
                  name="reason"
                  required={!!current}
                />
              </Form>
            )}
          {results.map((r) => (
            <article key={`${r.id}:${r.version}`}>
              <h3>
                Revision {r.revision} · {r.state}
                {r.id === selected.current_result_id
                  ? " · Current"
                  : " · Retained history"}
              </h3>
              {r.observations.map((o, i) => (
                <p key={i}>
                  {o.name}: {o.value} {o.unit} · Reference{" "}
                  {o.reference_interval} · {o.comments}
                </p>
              ))}
              <p>
                {r.comments} {r.correction_reason}
              </p>
              {!doctor &&
                r.id === selected.current_result_id &&
                r.state === "RESULT_DRAFT" && (
                  <>
                    <Form
                      submit="Save result draft changes"
                      onSubmit={async (d) => {
                        await api("PATCH", `/lab/results/${r.id}`, {
                          expected_version: r.version,
                          observations: observations(
                            d,
                            r.observations.length,
                            "edit",
                          ),
                          comments: value(d, "editComments"),
                        });
                        await refresh();
                      }}
                    >
                      {r.observations.map((o, i) => (
                        <fieldset key={i}>
                          <legend>Analyte {i + 1}</legend>
                          {[
                            ["Analyte", `editname${i}`, o.name],
                            ["Value", `editvalue${i}`, o.value],
                            ["Unit", `editunit${i}`, o.unit],
                            [
                              "Reference interval",
                              `editrange${i}`,
                              o.reference_interval,
                            ],
                            ["Comment", `editcomment${i}`, o.comments],
                          ].map(([label, name, v]) => (
                            <label className="field" key={name}>
                              {label}
                              <input
                                name={name}
                                defaultValue={v}
                                required={
                                  label === "Analyte" || label === "Value"
                                }
                              />
                            </label>
                          ))}
                        </fieldset>
                      ))}
                      <label className="field">
                        Result comments
                        <input name="editComments" defaultValue={r.comments} />
                      </label>
                    </Form>
                    <Form
                      submit="Sign result with PIN"
                      onSubmit={async (d) => {
                        await post(`/lab/results/${r.id}/sign`, {
                          expected_version: r.version,
                          signoff_pin: value(d, "pin"),
                        });
                        await refresh();
                      }}
                    >
                      <Field
                        label="Six-digit diagnostic sign-off PIN"
                        name="pin"
                        type="password"
                        minLength={6}
                        maxLength={6}
                      />
                    </Form>
                  </>
                )}
              {doctor &&
                r.id === selected.current_result_id &&
                r.state === "TECH_SIGNED" && (
                  <Form
                    submit="Verify this result revision"
                    onSubmit={async (d) => {
                      await post(`/lab/results/${r.id}/verify`, {
                        expected_version: r.version,
                        password: value(d, "password"),
                      });
                      await refresh();
                    }}
                  >
                    <Field
                      label="Current doctor password"
                      name="password"
                      type="password"
                    />
                  </Form>
                )}
              {!doctor &&
                r.id === selected.current_result_id &&
                r.state === "DOCTOR_VERIFIED" && (
                  <Form
                    submit="Release verified result"
                    onSubmit={async () => {
                      await post(`/lab/results/${r.id}/release`, {
                        expected_version: r.version,
                      });
                      await refresh();
                    }}
                  >
                    <p>
                      Release this exact verified revision to the patient API.
                    </p>
                  </Form>
                )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}
