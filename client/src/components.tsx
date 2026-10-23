import { useState, type ReactNode, type FormEvent } from "react";
import { HeartPulse, ShieldCheck, ArrowRight } from "lucide-react";
import { errorMessage } from "./api";
export function Brand() {
  return (
    <a className="brand" href="/">
      <span className="brand-icon">
        <HeartPulse size={24} />
      </span>
      <span>
        Aura<span className="brand-light">Care</span>
        <small>CLINIC WORKSPACE</small>
      </span>
    </a>
  );
}
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-layout">
      <aside className="welcome">
        <Brand />
        <div className="welcome-copy">
          <span className="eyebrow light">CARE, CONNECTED.</span>
          <h1>
            A calmer day.
            <br />A clearer workspace.
          </h1>
          <p>
            One place for your facility, your team, and the care you deliver.
          </p>
          <div className="welcome-rule" />
          <div className="welcome-stat">
            <ShieldCheck />
            <span>
              Your facility.
              <br />
              <strong>Your secure workspace.</strong>
            </span>
          </div>
        </div>
        <small className="welcome-footer">
          Built around the people behind better care.
        </small>
      </aside>
      <main className="public-main">{children}</main>
    </div>
  );
}
export function Field({
  label,
  name,
  type = "text",
  required = true,
  autoComplete,
  placeholder,
  minLength,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        maxLength={maxLength}
      />
    </label>
  );
}
export function Form({
  onSubmit,
  children,
  submit = "Continue",
  className = "",
}: {
  onSubmit: (data: FormData) => Promise<void>;
  children: ReactNode;
  submit?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setError("");
    setBusy(true);
    try {
      await onSubmit(d);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={className} onSubmit={(e) => void run(e)}>
      <fieldset disabled={busy}>
        {children}
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        <button className="button primary full" type="submit">
          {busy ? "Please wait…" : submit}
          {!busy && <ArrowRight size={16} />}
        </button>
      </fieldset>
    </form>
  );
}
export const value = (d: FormData, n: string) => String(d.get(n) ?? "");
export function Heading({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <span className="eyebrow">{kicker}</span>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}
