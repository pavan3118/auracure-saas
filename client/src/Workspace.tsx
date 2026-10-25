import { PlatformUsage } from "./PlatformUsage";
import { Billing, Pharmacy, Laboratory } from "./Operations";
import { Doctor } from "./Doctor";
import { Reception } from "./Reception";
import { useCallback, useEffect, useState } from "react";
import {
  Users,
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  ArrowUpRight,
  Activity,
  Building2,
  ClipboardList,
  Plus,
  X,
} from "lucide-react";
import {
  api,
  errorMessage,
  type User,
  type Invitation,
  type AuditEvent,
  type Role,
} from "./api";
import { useAuth } from "./auth";
import { Brand, Heading, Form, Field, value } from "./components";
const staffRoles: Role[] = [
  "OWNER",
  "DOCTOR",
  "RECEPTIONIST",
  "PHARMACIST",
  "LAB",
];
const roleName = (r: Role) =>
  ({
    OWNER: "Owner / Admin",
    DOCTOR: "Doctor",
    RECEPTIONIST: "Receptionist",
    PHARMACIST: "Pharmacist",
    LAB: "Lab technician",
    PATIENT: "Patient",
  })[r];
export function Workspace() {
  const auth = useAuth(),
    me = auth.me!;
  const [page, setPage] = useState<
      | "overview"
      | "staff"
      | "audit"
      | "reception"
      | "doctor"
      | "billing"
      | "pharmacy"
      | "laboratory"
      | "usage"
    >(
      me.user.role === "RECEPTIONIST"
        ? "reception"
        : me.user.role === "DOCTOR"
          ? "doctor"
          : me.user.role === "PHARMACIST"
            ? "pharmacy"
            : me.user.role === "LAB"
              ? "laboratory"
              : "overview",
    ),
    [users, setUsers] = useState<User[]>([]),
    [invites, setInvites] = useState<Invitation[]>([]),
    [events, setEvents] = useState<AuditEvent[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loaded, setLoaded] = useState(false),
    [inviteOpen, setInviteOpen] = useState(false),
    [selected, setSelected] = useState<User | null>(null),
    [licence, setLicence] = useState<User | null>(null);
  const owner = me.user.role === "OWNER";
  const load = useCallback(async () => {
    if (!owner) return;
    try {
      const [u, i, e] = await Promise.all([
        api<User[]>("GET", "/staff"),
        api<Invitation[]>("GET", "/staff/invitations"),
        api<AuditEvent[]>("GET", "/audit-events"),
      ]);
      setUsers(u);
      setInvites(i);
      setEvents(e);
      setLoaded(true);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [owner]);
  useEffect(() => {
    void load();
  }, [load]);
  async function signout() {
    try {
      await auth.logout();
    } catch {
      setError(
        "Signed out locally. The server could not confirm session revocation.",
      );
    }
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">FACILITY WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === "overview" ? "selected" : ""}
            onClick={() => setPage("overview")}
          >
            <LayoutDashboard size={19} />
            Overview
          </button>
          {["RECEPTIONIST", "OWNER", "DOCTOR"].includes(me.user.role) && (
            <button
              className={page === "reception" ? "selected" : ""}
              onClick={() => setPage("reception")}
            >
              <Activity size={19} />
              {me.user.role === "RECEPTIONIST" ? "Reception" : "Live queue"}
            </button>
          )}
          {me.user.role === "DOCTOR" && (
            <button
              className={page === "doctor" ? "selected" : ""}
              onClick={() => setPage("doctor")}
            >
              <ClipboardList size={19} />
              Doctor workspace
            </button>
          )}
          {["OWNER", "RECEPTIONIST"].includes(me.user.role) && (
            <button
              className={page === "billing" ? "selected" : ""}
              onClick={() => setPage("billing")}
            >
              Invoices & receipts
            </button>
          )}
          {["PHARMACIST", "DOCTOR"].includes(me.user.role) && (
            <button
              className={page === "pharmacy" ? "selected" : ""}
              onClick={() => setPage("pharmacy")}
            >
              {me.user.role === "DOCTOR" ? "Generic approvals" : "Pharmacy"}
            </button>
          )}
          {["LAB", "DOCTOR"].includes(me.user.role) && (
            <button
              className={page === "laboratory" ? "selected" : ""}
              onClick={() => setPage("laboratory")}
            >
              Laboratory
            </button>
          )}
          {owner && (
            <button
              className={page === "usage" ? "selected" : ""}
              onClick={() => setPage("usage")}
            >
              Usage & credits
            </button>
          )}
          {owner && (
            <>
              <button
                className={page === "staff" ? "selected" : ""}
                onClick={() => setPage("staff")}
              >
                <Users size={19} />
                Team & access
              </button>
              <button
                className={page === "audit" ? "selected" : ""}
                onClick={() => setPage("audit")}
              >
                <ClipboardList size={19} />
                Audit trail
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="secure-label">
            <ShieldCheck size={16} />
            Tenant-isolated workspace
          </span>
          <button onClick={() => void signout()}>
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <span>
            <Building2 size={16} />
            {me.tenant.name}
          </span>
          <div className="identity">
            <span>
              {me.user.name}
              <small>{roleName(me.user.role)}</small>
            </span>
            <div className="avatar">
              {me.user.name.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>
        <main className="workspace-main">
          {error && (
            <div role="alert" className="alert error">
              {error}
              <button className="text-button" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {page === "reception" && <Reception />}
          {page === "doctor" && <Doctor />}
          {page === "billing" && <Billing />}
          {page === "usage" && owner && <PlatformUsage />}
          {page === "pharmacy" && <Pharmacy />}
          {page === "laboratory" && <Laboratory />}
          {page === "overview" && (
            <>
              <div className="heading-row">
                <Heading
                  kicker="YOUR FACILITY AT A GLANCE"
                  title={`Welcome, ${me.user.name.split(" ")[0]}.`}
                >
                  A clear start for your team and the day ahead.
                </Heading>
                <span className="status-chip">
                  <i />
                  Workspace active
                </span>
              </div>
              <section className="overview-banner">
                <div>
                  <span className="eyebrow light">READY FOR YOUR TEAM</span>
                  <h2>
                    Good care starts
                    <br />
                    with a connected team.
                  </h2>
                  <p>
                    Your facility is registered. Build your team with secure,
                    role-based invitations.
                  </p>
                  {owner && (
                    <button
                      className="button white"
                      onClick={() => {
                        setPage("staff");
                        setInviteOpen(true);
                      }}
                    >
                      Invite a team member
                      <ArrowUpRight size={17} />
                    </button>
                  )}
                </div>
                <div className="banner-illustration" aria-hidden="true">
                  <div className="orbit one" />
                  <div className="orbit two" />
                  <div className="care-cross">+</div>
                  <span className="floating-icon">
                    <ShieldCheck size={27} />
                  </span>
                </div>
              </section>
              <div className="stat-grid">
                <article className="stat-card">
                  <Users />
                  <span>Active team members</span>
                  <strong>
                    {owner
                      ? loaded
                        ? users.filter((u) => u.status === "ACTIVE").length
                        : "—"
                      : "Restricted"}
                  </strong>
                  <small>
                    {owner
                      ? "Across your facility"
                      : "Visible to facility owners"}
                  </small>
                </article>
                <article className="stat-card">
                  <Activity />
                  <span>Pending invitations</span>
                  <strong>
                    {owner ? (loaded ? invites.length : "—") : "Restricted"}
                  </strong>
                  <small>
                    {owner
                      ? "Secure links expire after 24 hours"
                      : "Visible to facility owners"}
                  </small>
                </article>
                <article className="stat-card">
                  <ShieldCheck />
                  <span>Account security</span>
                  <strong>
                    {me.user.mfa_enabled ? "MFA enabled" : "Role protected"}
                  </strong>
                  <small>Server-enforced access boundaries</small>
                </article>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Your facility setup</h2>
                  <span className="badge">Phase 4</span>
                </div>
                <div className="setup-row">
                  <span className="setup-check">✓</span>
                  <div>
                    <strong>Facility registration complete</strong>
                    <p>
                      {me.tenant.name} · {me.tenant.subdomain}
                    </p>
                  </div>
                </div>
                <div className="setup-row">
                  <span className="setup-check">✓</span>
                  <div>
                    <strong>Secure role-based access</strong>
                    <p>
                      Only authorized team members can enter your workspace.
                    </p>
                  </div>
                </div>
                <div className="setup-row">
                  <span className="setup-pending">2</span>
                  <div>
                    <strong>Reception and clinical workflows</strong>
                    <p>
                      Reception, doctor, pharmacy, laboratory and billing
                      workspaces are available according to your role.
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}
          {page === "staff" && owner && (
            <>
              <div className="heading-row">
                <Heading
                  kicker="SCREEN 07 · STAFF MANAGEMENT"
                  title="Your team. The right access."
                >
                  Invite staff and manage their facility permissions.
                </Heading>
                <button
                  className="button primary"
                  onClick={() => setInviteOpen(true)}
                >
                  <Plus size={17} />
                  Invite staff
                </button>
              </div>
              {inviteOpen && (
                <section className="panel form-panel">
                  <div className="panel-heading">
                    <h2>Invite a team member</h2>
                    <button
                      aria-label="Close invitation form"
                      onClick={() => setInviteOpen(false)}
                    >
                      <X />
                    </button>
                  </div>
                  <Form
                    submit="Send secure invitation"
                    onSubmit={async (d) => {
                      await api("POST", "/staff/invitations", {
                        login: value(d, "login"),
                        role: value(d, "role"),
                      });
                      setInviteOpen(false);
                      setNotice("Invitation queued for delivery.");
                      await load();
                    }}
                  >
                    <Field label="Staff email" name="login" type="email" />
                    <label className="field">
                      Role
                      <select aria-label="Role" name="role">
                        {staffRoles.map((r) => (
                          <option key={r} value={r}>
                            {roleName(r)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="hint">
                      Staff choose their own password. Owner invitations require
                      MFA enrollment.
                    </p>
                  </Form>
                </section>
              )}
              <section className="panel table-panel">
                <div className="panel-heading">
                  <h2>Team directory</h2>
                  <span className="subtle">{users.length} members</span>
                </div>
                {!loaded ? (
                  <p className="empty-state">Loading team…</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Team member</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Access</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id}>
                            <td>
                              <strong>{u.name}</strong>
                              <small>{u.login}</small>
                            </td>
                            <td>{roleName(u.role)}</td>
                            <td>
                              <span
                                className={`badge ${u.status === "ACTIVE" ? "good" : ""}`}
                              >
                                {u.status === "ACTIVE" ? "Active" : "Disabled"}
                              </span>
                            </td>
                            <td>
                              {u.role === "PHARMACIST"
                                ? u.licence_status === "VERIFIED"
                                  ? "Licence verified"
                                  : "Licence pending"
                                : u.role === "OWNER"
                                  ? u.mfa_enabled
                                    ? "MFA enabled"
                                    : "MFA pending"
                                  : "Role protected"}
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => {
                                  setSelected(u);
                                  setLicence(null);
                                }}
                              >
                                Manage
                              </button>
                              {u.role === "PHARMACIST" &&
                                u.licence_status !== "VERIFIED" && (
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      setLicence(u);
                                      setSelected(null);
                                    }}
                                  >
                                    Verify licence
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              {selected && (
                <section className="panel form-panel">
                  <h2>Manage {selected.name}</h2>
                  <p>
                    Role and status changes revoke existing sessions. A fresh
                    MFA code is required.
                  </p>
                  <Form
                    submit="Confirm access change"
                    onSubmit={async (d) => {
                      await api("PATCH", `/staff/${selected.id}`, {
                        role: value(d, "role"),
                        status: value(d, "status"),
                        mfa_proof: value(d, "proof"),
                      });
                      setSelected(null);
                      setNotice("Staff access updated.");
                      await load();
                    }}
                  >
                    <label className="field">
                      Role
                      <select
                        aria-label="Role"
                        name="role"
                        defaultValue={selected.role}
                      >
                        {staffRoles.map((r) => (
                          <option key={r} value={r}>
                            {roleName(r)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Status
                      <select
                        aria-label="Status"
                        name="status"
                        defaultValue={selected.status}
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="DISABLED">Disabled</option>
                      </select>
                    </label>
                    <Field
                      label="Fresh owner authenticator or recovery code"
                      name="proof"
                      autoComplete="one-time-code"
                    />
                  </Form>
                  <button
                    className="text-button"
                    onClick={() => setSelected(null)}
                  >
                    Cancel
                  </button>
                </section>
              )}
              {licence && (
                <section className="panel form-panel">
                  <h2>Verify licence · {licence.name}</h2>
                  <Form
                    submit="Record licence verification"
                    onSubmit={async (d) => {
                      await api(
                        "POST",
                        `/staff/${licence.id}/licence-verification`,
                        {
                          evidence_ref: value(d, "evidence"),
                          mfa_proof: value(d, "proof"),
                        },
                      );
                      setLicence(null);
                      setNotice("Licence verification recorded.");
                      await load();
                    }}
                  >
                    <Field
                      label="Verification evidence reference"
                      name="evidence"
                      minLength={3}
                    />
                    <Field
                      label="Fresh owner authenticator or recovery code"
                      name="proof"
                    />
                  </Form>
                  <button
                    className="text-button"
                    onClick={() => setLicence(null)}
                  >
                    Cancel
                  </button>
                </section>
              )}
              <section className="panel">
                <div className="panel-heading">
                  <h2>Pending invitations</h2>
                  <span className="subtle">{invites.length} pending</span>
                </div>
                {invites.length ? (
                  invites.map((i) => (
                    <div className="invitation-row" key={i.id}>
                      <div>
                        <strong>{i.login}</strong>
                        <small>
                          {roleName(i.role)} ·{" "}
                          {i.approved
                            ? "Awaiting acceptance"
                            : "Owner approval needed"}
                        </small>
                      </div>
                      {!i.approved && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            void api(
                              "POST",
                              `/staff/invitations/${i.id}/approve`,
                              {},
                            )
                              .then(async () => {
                                setNotice("Invitation approved and queued.");
                                await load();
                              })
                              .catch((e) => setError(errorMessage(e)));
                          }}
                        >
                          Approve
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="empty-state">
                    No pending invitations. Your next team member starts here.
                  </p>
                )}
              </section>
            </>
          )}
          {page === "audit" && owner && (
            <>
              <Heading
                kicker="ACCOUNTABILITY"
                title="An audit trail you can follow."
              >
                Security and staff changes, without clinical details.
              </Heading>
              <section className="panel table-panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Outcome</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => (
                        <tr key={e.id}>
                          <td>{e.action.replaceAll("_", " ").toLowerCase()}</td>
                          <td>
                            <span className="badge">{e.outcome}</span>
                          </td>
                          <td>{new Date(e.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!events.length && (
                  <p className="empty-state">No events available yet.</p>
                )}
              </section>
            </>
          )}
          {!owner &&
            (me.user.role === "PHARMACIST" || me.user.role === "LAB") && (
              <section className="panel form-panel">
                <h2>Request a same-role invitation</h2>
                <p>
                  Your facility owner must approve this request before the
                  invitation is sent.
                </p>
                <Form
                  submit="Request owner approval"
                  onSubmit={async (d) => {
                    await api("POST", "/staff/invitations", {
                      login: value(d, "login"),
                      role: me.user.role,
                    });
                    setNotice(
                      "Invitation requested. Your owner can review it in Screen 07.",
                    );
                  }}
                >
                  <Field label="Colleague email" name="login" type="email" />
                </Form>
              </section>
            )}
          <footer className="workspace-footer">
            AuraCare · Facility workspace
            <span>Phase 5 — Patient portal & usage</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
