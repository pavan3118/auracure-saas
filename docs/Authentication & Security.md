> **Specification baseline approved by the user; Phase 4 implementation is under review.**
> Sources: uploaded PRD v7 sections 1–4, the user's five-point decisions, and the approved draft specifications.
> Original `ASSUMPTION - needs approval` labels remain as provenance for the approved proposals; they do not record a second pending approval. Changes to that baseline are identified in PHASE1-REVIEW.md.
> Original PRD statements override assumptions. Current implementation evidence and external blockers are recorded in PHASE4-REVIEW.md (earlier reviews retain historical evidence); planned later-phase APIs are not implemented merely because they appear in these documents.

# Authentication & Security

## Authoritative boundaries

The six tenant roles are OWNER, DOCTOR, RECEPTIONIST, PHARMACIST, LAB and PATIENT. Registration creates Tenant + Owner in one transaction and issues a tenant-bound JWT after commit. Other business requests derive tenant_id only from verified JWTs. Mandatory owner MFA and role-specific credentials follow PRD B03–B08. No provisioning actor becomes a seventh business role.

## Permission matrix — ASSUMPTION - needs approval (A02)

“Own” means verified account/assignment linkage inside the same tenant, never a submitted patient ID alone. “Read” means minimum necessary fields. OWNER is not automatically a clinician and receives no blanket clinical-record access.

| Capability | OWNER | DOCTOR | RECEPTIONIST | PHARMACIST | LAB | PATIENT |
| --- | --- | --- | --- | --- | --- | --- |
| Facility/settings, rates, platform bills | Manage | — | — | — | — | — |
| Staff create/disable/role changes | Manage | — | — | — | — | — |
| Initiate same-role staff invite | Manage | — | — | Request approval | Request approval | — |
| Pharmacist licence verification | Manage | — | — | — | — | — |
| Patient demographics | Operational minimum | Assigned/read | Register/update | Dispensing minimum | Order minimum | Own/read |
| Vitals | — | Assigned/read | Record | — | — | Own approved view* |
| Queue/check-in | Operational/read | Claim next | Manage | — | — | Own status |
| Consultation notes | — | Assigned/manage | — | — | — | —* |
| Prescription draft/sign | — | Assigned/manage | — | — | — | — |
| Signed prescriptions | — | Assigned/read | — | Dispense/read | — | Own/read |
| Stock and dispensing | Summary/read | Approval of substitution | — | Manage | — | — |
| Lab order | — | Assigned/create | Scheduling minimum | — | Process | Own status |
| Draft results/sign-off | — | Assigned/read | — | — | Manage | — |
| Verify results | — | Assigned/verify | — | — | — | — |
| Release verified result | — | — | — | — | Release | — |
| Released results | — | Assigned/read | — | — | Order/read | Own/read |
| Patient invoices/receipts | Manage/void | — | Create/collect | — | — | Own/read |
| Cash float/EOD | Review | — | Own shift/manage | — | — | — |
| Operational audit | Read sanitized | — | — | — | — | — |

*Patient access to raw notes/vitals is deliberately undecided; A16 must be amended if it is required. Mask financial/clinical fields in shared projections. Every route needs a declared permission and applicable resource scope; client hiding is not enforcement. Return 403 for role denial, 404 for inaccessible resource IDs and 401 for invalid authentication.

## Internal operator — ASSUMPTION - needs approval (A06)

SYSTEM_ADMIN is internal only, stored outside tenant users with a distinct token audience, operator authentication and mandatory MFA. Proposed permissions are tenant lifecycle metadata and sanitized platform diagnostics; no impersonation or patient record access. Break-glass access is not implemented or implied. Tenant JWTs cannot acquire operator permissions; operator JWTs cannot enter normal tenant routes.

## Identity lifecycle — ASSUMPTION - needs approval (A04, A05, A20)

| Role | Baseline credential | Proposed controls |
| --- | --- | --- |
| OWNER | Password + mandatory MFA | TOTP; hashed one-time recovery codes; enrollment-only JWT until confirmed |
| DOCTOR | Invite/temp password; forced change | Single-use invite, restricted first-login token; revoke temp credential after change |
| RECEPTIONIST | Shift PIN or strong password; audit | Prefer password; PIN mode requires OWNER enablement, device/session restrictions and rate limiting |
| PHARMACIST | Password + licence verification | Owner-verified evidence reference gates dispensing; record verification actor/date |
| LAB | Password + sign-off PIN | Separate hashed PIN; reenter for result signing; password alone cannot sign |
| PATIENT | Four-digit portal PIN or WhatsApp OTP link | Tenant-bound account, strict guessing controls; PIN alone has inherently limited entropy; approve stronger verification for sensitive access |

Proposed hashing: bcryptjs with cost 12 (benchmark before release), unique salts, secret PIN pepper via managed secrets. Password minimum 12 characters, maximum 72 UTF-8 bytes to avoid bcrypt truncation; allow password managers and no arbitrary composition rules. Proposed shift/sign-off PIN length is six digits; patient PIN remains the PRD's four digits. Never put plaintext credentials into logs, seeded fixtures with real identities or invitation responses. Exact PIN unlock/device rules need review.

TOTP secrets must be recoverably encrypted with a managed key, never hashed like passwords. Recovery codes are individually hashed and consumed atomically. Proposed TOTP skew is ±1 time step with replay protection. Temporary passwords/invites expire after 24 hours; their time limit is distinct from recovery's 15 minutes.

Access JWT lifetime: 15 minutes; rotating refresh session: seven days, HttpOnly Secure SameSite=Lax cookie on the same-site deployment. Access tokens stay in memory. Verify signature algorithm allowlist, issuer, audience, expiry, purpose, tenant, role, account state and credential/session version. Detect refresh reuse and revoke the token family. CSRF protection and Origin checks cover cookie-authenticated actions. Reauthenticate for role changes, MFA changes and clinical signing.

## Public-route exception proposal — ASSUMPTION - needs approval (A04, A19, A20)

Beyond the approved registration exception, API.md proposes contact verification, login, MFA challenges, invitation acceptance, refresh, recovery, provider callbacks and health checks. These are a pending amendment to “all other routes” being JWT-protected. Each uses a purpose-specific verified challenge, session, provider signature or non-sensitive health response; none trusts tenant_id from a request. Tenant selection before login uses a subdomain only to find candidate credentials, never to authorize data access.

Proposed rate limits: registration five attempts/hour/IP plus per-contact limits; login/PIN five failures/15 minutes/account and IP followed by progressive delay; OTP send three/15 minutes/contact and ten/hour/IP; OTP verification five attempts/challenge. Use shared counters across instances and generic account responses. No permanent account lock controllable by an attacker. Verify contacts through a provider-issued one-time code; format validation is not verification.

## Recovery — ASSUMPTION - needs approval (A20)

Return identical request responses whether an account exists. Recovery tokens are random, at least 256 bits, stored hashed, purpose/tenant/account bound, single-use and expire after **15 minutes**. Issuing a new token invalidates previous outstanding tokens. Completion requires verified ownership of the registered contact; changing that contact requires authenticated proof and an audited procedure, not request-body assertion.

Staff password/PIN reset requires verified contact or an OWNER-issued reset invite to a previously verified contact; role restrictions and licence gates remain. Patient PIN reset requires verified contact proof. Owner password recovery does not disable MFA: require TOTP/recovery code; loss of both requires a separately approved manual operator process, with no automatic bypass. Reset revokes existing sessions, invalidates old challenges and sends an out-of-band notice. Diagnostic sign-off PIN recovery must not sign or release a result automatically.

## Defense and audit — ASSUMPTION - needs approval (A05, A21)

Validate with Zod; prevent mass assignment and MongoDB operator injection. Helmet, explicit CORS allowlist, request size limits, TLS, CSRF protection, least-privilege Atlas credentials and private PDF storage are required proposed controls. Do not disable TLS, artifact checksum or package signature verification. Signed download grants are short-lived and authorized on every issuance.

Audit provisioning, role/status changes, auth failures, recovery, licence verification, prescription signing/correction, stock adjustments, cash variance, result verification/release and billing adjustments. Store IDs, action, outcome, time and correlation ID; exclude patient details, clinical free text, credentials and provider payloads. Healthcare record encryption, audit retention, access reviews and residency await a jurisdiction-specific policy; no HIPAA/GDPR compliance claim is made.

## Approval and Phase 1 scope record

The user approved this specification after reviewing its proposals, including the narrowly scoped public/challenge exceptions. The earlier “pending amendment” language records the original draft status, not an authorization to expose arbitrary public routes. Current routes are listed in API.md's Phase 1 record.

Phase 1 implements password credentials for staff, owner TOTP/recovery codes, separate peppered lab sign-off PIN hashing, patient portal PIN authentication and a development-only OTP adapter. Receptionists use the PRD's strong-password option; shift PIN/device policy is not enabled. Licence verification records an owner's evidence reference, not an automated regulator verification. PIN reset for patients uses verified contact recovery; lab sign-off PIN reset and operator-assisted lost-MFA recovery are not exposed yet. No fallback bypasses MFA.

Recovery/OTP requests serialize on a per-user challenge version so concurrent requests cannot leave multiple outstanding active grants. Invitations serialize on tenant governance metadata; limited provisioning actors cannot invalidate an OWNER-approved invitation. Final-owner changes use a tenant governance counter to serialize concurrent demotions. Failed transactions roll back code consumption and audits together.

## Phase 2 security record

See PHASE2-REVIEW.md for route projections. OWNERS receive operational patient names/IDs without contacts, birth dates or vitals; doctors need an assigned visit to read a patient or vitals. PATIENT detail checks the linked user ID, including against other patients in the same tenant. Register/check-in/edit/vitals/float mutations require RECEPTIONIST. Owner cancellation is restricted to a latest-version queued visit.

Check-in creates a dormant account with an undisclosed random, peppered/hashed PIN and unverified contact. Patient login now explicitly rejects unverified contacts; a guessed PIN cannot activate such an account. Activation/WhatsApp delivery is a later-phase ownership-verification flow. Contact edits cannot bypass it. Audits contain actor/resource IDs and action/outcome, never patient bodies, vitals or the cancellation free text. Production access logs must likewise avoid search-query/contact values.

Live subscriptions verify JWT purpose, audience, role, tenant and server-side session. Every emitted notice revalidates authorization; a five-second check also disconnects revoked sessions. Expiry closes the socket. Notices carry no names/contact/vitals; clients refetch permitted HTTP projections.

## Phase 3 clinical authorization

Only an assigned DOCTOR can manage an active encounter, prescribe, order tests/services, complete it or append an audited correction. The full JWT tenant/session/credential context is required; owning the facility grants no clinical bypass. Prescription editing additionally requires the current optimistic version and a 120-second lease bound to doctor and authenticated session. Session expiry/revocation prevents further use of that lease through the normal authorization guard.

Signing and post-completion amendments require the doctor's current password. The transaction checks that credential version, password hash, status and DOCTOR role still match before writing. Only failed password proofs consume the five-failure / 15-minute reauthentication counter, and failures are audited. Password proofs are not stored in idempotency hashes, audit events or clinical content hashes. Signed prescriptions cannot be modified/discarded; corrections produce a linked new draft, and finalized notes accept separate immutable amendments.

PHARMACIST may read a signed prescription projection; PATIENT must additionally match the linked patient user ID. Draft/discarded revisions and unrelated same-tenant patients remain inaccessible. LAB order projections contain requested tests/instructions only, not complaint/assessment/plan. Clinical bodies and passwords never appear in live queue notices.

## Phase 4 permission and proof controls

OWNER sees operational invoices, stock and shift summaries and may void unpaid invoices/review closes with fresh MFA, but receives no lab or prescription clinical access. RECEPTIONIST records invoices/receipts and closes only their own shift. PHARMACIST requires current VERIFIED licence for receiving, adjusting, requesting substitutions and dispensing. LAB drafts/signs/releases lab results; only the requesting DOCTOR can verify and approve their own prescription alternatives. PATIENT reads their own issued invoice/receipts and only their current released lab revision. OWNER is never a clinical bypass.

LAB sign-off uses the existing separate peppered/bcrypt six-digit diagnostic PIN; doctor verification/substitution approval checks the current password. Five failed sensitive password/PIN proofs per user/kind per 15 minutes are enforced in shared Mongo rate storage; successful proofs do not consume the failure budget. Credential hashes/versions are rechecked and locked inside transactions. Owner financial proof routes allow ten attempts per 15 minutes and consume existing replay-protected TOTP/recovery proofs. No credential enters retry fingerprints, clinical records or audit values.

Issued invoice lines, payment/movement records, dispensing allocations and signed result content are immutable through the APIs. Corrections retain original results but require the full sign/verify/release sequence again. Starting a correction withholds the previous patient release until the replacement is released. Existing draft leases and tenant/session revocation controls remain in effect. Audit events contain resource IDs/actions, not observations, card details or credentials. Noncash receipt references identify an existing transaction; never store card PAN/CVV.
