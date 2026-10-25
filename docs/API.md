> **Specification baseline approved by the user; Phase 5 local/sandbox implementation is under review; production activation gates remain open.**
> Sources: uploaded PRD v7 sections 1–4, the user's five-point decisions, and the approved draft specifications.
> Original `ASSUMPTION - needs approval` labels remain as provenance for the approved proposals; they do not record a second pending approval. Changes to that baseline are identified in PHASE1-REVIEW.md.
> Original PRD statements override assumptions. Current implementation evidence and external blockers are recorded in PHASE5-REVIEW.md (earlier reviews retain historical evidence); planned later-phase APIs are not implemented merely because they appear in these documents.

# API specification

## Contract status

**Approved:** `POST /api/v1/onboarding/register`, its transaction and protections, JWT tenant scope and the six business roles. All other contracts here are **ASSUMPTION - needs approval (A07)**, with related behavior inherited from PRD assumptions. Paths below are relative to `/api/v1`; no endpoint below has been implemented.

## Conventions — ASSUMPTION - needs approval (A07)

JSON success: `{ "data": ..., "meta": { "request_id": "..." } }`. Errors: `{ "error": { "code": "...", "message": "...", "fields": [] }, "meta": { "request_id": "..." } }`. Never include stack traces, tokens or patient details in errors/logs. Validate with Zod and reject unknown writable fields, including tenant_id.

Use ISO 8601 UTC timestamps, opaque cursor pagination (`cursor`, `limit`, proposed maximum 100), allowlisted sorting, integer minor monetary units and explicit currency. Create returns 201, successful reads/commands 200, empty deletion/revocation 204. 400 validation, 401 missing/invalid authentication, 403 role/scope denial, 404 inaccessible resource, 409 version/state/uniqueness conflict, 429 rate limit, 503 missing provider configuration.

Proposed error codes: VALIDATION_ERROR, AUTH_REQUIRED, AUTH_INVALID, FORBIDDEN, NOT_FOUND, CONFLICT, SUBDOMAIN_UNAVAILABLE, CONTACT_UNVERIFIED, CHALLENGE_INVALID, MFA_REQUIRED, CREDENTIAL_CHANGE_REQUIRED, LICENCE_UNVERIFIED, INSUFFICIENT_STOCK, INSUFFICIENT_CREDIT, PRICING_NOT_CONFIGURED, PROVIDER_UNAVAILABLE, RATE_LIMITED. Do not expose whether an account exists through recovery responses.

## Onboarding and authentication — ASSUMPTION - needs approval (A01, A04, A05, A20)

| Method/path | Access | Proposed payload / response |
| --- | --- | --- |
| POST /onboarding/contact-challenges | Public exception proposed | contact, desired_subdomain → generic acknowledgement + opaque challenge handle; delivery out of band |
| POST /onboarding/contact-challenges/verify | Public exception proposed | challenge handle, proof → short-lived verified registration grant |
| POST /onboarding/register | **Approved public exception** | facility{name,type,subdomain,capacity}, owner{name,email,password}, verification_grant → owner summary + tenant summary + MFA-enrollment JWT |
| POST /auth/login | Public exception proposed | facility_subdomain, login, password or portal_pin → limited MFA/credential-change challenge or authenticated session |
| POST /auth/otp-requests | Public exception proposed | facility_subdomain, contact → generic acknowledgement; WhatsApp OTP link sent out of band |
| POST /auth/otp-exchange | Public exception proposed | single-use opaque code → tenant-bound PATIENT session |
| POST /auth/mfa/enroll | Enrollment JWT only | begin TOTP enrollment; returns secret/URI once over TLS; Cache-Control no-store |
| POST /auth/mfa/confirm | Enrollment JWT only | TOTP proof → activated MFA + full session |
| POST /auth/mfa/verify | Login challenge JWT only | TOTP or recovery code → full session |
| POST /auth/password/change | Credential-change JWT or full session | current proof, new password → rotate/revoke session credentials |
| POST /auth/invitations/accept | Public exception proposed | single-use invitation, new password → limited/full session per role activation requirements |
| POST /auth/refresh | Refresh-cookie proof; proposed exception | rotate cookie and session; tenant scope comes from verified stored session |
| POST /auth/logout | Authenticated or refresh-session proof | revoke session, clear cookie |
| POST /auth/recovery/request | Public exception proposed | facility_subdomain, login → generic response |
| POST /auth/recovery/complete | Public exception proposed | single-use recovery token, new credential → reset; does not bypass MFA |

Only registration is already authorized as a public exception. The additional exception routes above require approval. Login subdomain selects a candidate tenant but is never trusted authorization; successful credential verification creates the tenant-bound signed context. Recovery/invitation grants are server-issued, purpose-bound and tenant-bound. Enrollment/challenge tokens cannot call ordinary resource endpoints.

Registration uses `Idempotency-Key`; identical retries return the same outcome without creating another tenant, but must not replay raw tokens from an insecure persistent cache. A timed-out successful registration resumes through authentication, not repeated credential issuance. Exact resume UX is A01/A04. Unique indexes resolve registration races with 409; rate limits also apply to failed requests.

## Resource endpoints — ASSUMPTION - needs approval (A02, A03, A07, A10–A16)

All rows below require a verified full session and the permission matrix in Authentication & Security.md. Request schemas must be finalized before code; the named payload concepts below are not approval of unspecified clinical fields.

| Resource | Proposed endpoints | Payload / access boundaries |
| --- | --- | --- |
| Session | GET /me | current user, role, tenant and allowed capability summary |
| Staff | GET/POST /staff/invitations; GET /staff; PATCH /staff/:id | invite{role,login}; changes{role?,status?}; OWNER full management; constrained pharmacist/lab invitation proposals |
| Licence | POST /staff/:id/licence-verification | OWNER records evidence reference/status; never a self-verification |
| Patients | GET/POST /patients; GET/PATCH /patients/:id | approved demographic schema; reception writes; clinical reads only where necessary |
| Vitals | GET/POST /visits/:id/vitals | observations[{code,value,unit}]; reception records, doctor reads |
| Visits | POST /visits; GET /queue; POST /queue/claim-next | patient_id and approved visit metadata; claim assigns authenticated doctor atomically |
| Completion | POST /visits/:id/complete | expected_version; assigned doctor; one billable completion event |
| Cancellation | POST /visits/:id/cancel | expected_version, reason; reception/owner before completion |
| Prescriptions | POST /visits/:id/prescriptions; GET/PATCH /prescriptions/:id | approved items/notes, expected_version; assigned doctor writes |
| Prescription lease | POST /prescriptions/:id/lease; POST /prescriptions/:id/lease/renew | expected_version; current editor; 409 if another active lease |
| Signing | POST /prescriptions/:id/sign | expected_version, reauthentication proof; explicit immutable revision |
| Stock | GET/POST /stock/batches; PATCH /stock/batches/:id | item_id,batch_no,expiry,quantity,unit; approved pharmacy permissions |
| Dispensing | POST /prescriptions/:id/dispenses | allocations + optional doctor-approved substitution reference |
| Lab | POST /lab/orders; GET /lab/orders; PATCH /lab/orders/:id | approved tests and allowed state transition; doctor orders, LAB processes |
| Results | POST /lab/orders/:id/results; POST /lab/results/:id/sign | approved result schema; sign-off PIN proof; never log proof |
| Verification/release | POST /lab/results/:id/verify; POST /lab/results/:id/release | doctor verifies; LAB releases only verified revision |
| Invoices | GET/POST /invoices; GET /invoices/:id; POST /invoices/:id/issue; POST /invoices/:id/void | approved item amounts, version, void reason; roles per matrix |
| Payments | POST /invoices/:id/payments | amount_minor,currency,method; prevents overpayment unless approved |
| Cash | POST /cash/sessions; POST /cash/sessions/:id/close; POST /cash/sessions/:id/review | opening float; counted amount/reason; owner review |
| Portal | GET /portal/me; GET /portal/visits; GET /portal/prescriptions; GET /portal/lab-results; GET /portal/invoices | PATIENT own linked records only; signed/released filters |
| PDFs | POST /documents/:id/download-grant | authorize tenant, patient and release state; short-lived private download grant |
| Usage | GET /billing/usage; GET /billing/platform-bills | OWNER only; separate from patient invoices |
| Audit | GET /audit-events | OWNER operational audit; no raw clinical payloads |

Mutating commands involving creation, completion, dispensing, payments, cash close and provider charges require an `Idempotency-Key` bound to actor, tenant, operation and request hash. Reuse with different payload returns 409. Proposed retention 24 hours is **ASSUMPTION - needs approval (A07)**; durable domain/provider unique keys remain authoritative after expiry.

## Integrations and live events — ASSUMPTION - needs approval (A18, A19)

`POST /webhooks/messaging/:provider` and `POST /webhooks/billing/:provider` are proposed authenticated-provider exceptions: verify signatures over raw bodies, timestamp tolerance and replay IDs; map tenant from stored provider references, never an unsigned tenant parameter. Ignore unknown references safely. These exceptions also require approval.

Socket.io connections verify full JWTs, tenant scope and role; disconnect at session expiry/revocation. Proposed `queue.updated` event contains a minimal visit identifier and state/version, not patient demographics; clients refetch authorized data. No client-selected tenant rooms. GET /health/live is a proposed public operational exception returning no secrets; GET /health/ready is deployment-internal and checks dependencies without patient data. Internal SYSTEM_ADMIN APIs remain unexposed until separately specified (A06).

## Phase 1 implemented contract and scope

Implemented: contact challenge request/verification; registration; login; MFA enrollment/confirmation/verification; refresh/logout; password change; recovery request/completion; invitation acceptance; development-only patient OTP request/exchange; me; staff listing/invitations/approval/update/licence verification; sanitized audit listing; liveness/readiness. Every clinical, billing, cash, PDF, Socket.io and operator endpoint above remains planned and returns 404.

Exact onboarding request keys: contact challenge `{email, desired_subdomain}`, verify `{challenge_id, proof}`, registration `{facility:{name,type,subdomain,capacity},owner:{name,email,password},verification_grant}` plus an Idempotency-Key header (16–128 characters). Registration replay records are bound to the verified contact grant and retained with that 15-minute bootstrap record; after MFA completion or grant expiry, sign in rather than expecting a cached session. Raw session tokens are never cached in the database. Concurrent identical retries return one tenant/owner; a changed payload using the same key returns 409.

Login accepts exactly one of password or portal_pin, together with facility_subdomain and login. Recovery completion uses new_password for a staff password or a patient four-digit PIN; the service enforces the account's credential type. Invitation acceptance adds optional signoff_pin, required as six digits for LAB. Doctors choose their permanent password during invite acceptance; temporary-password accounts remain restricted until password change.

`POST /staff/invitations/:id/approve` implements OWNER approval of a pharmacy/lab invitation request. `PATCH /staff/:id` adds mfa_proof to role/status; licence verification requires `{evidence_ref,mfa_proof}`. Invitations use email logins in Phase 1; alternate employee/mobile/licence login formats remain future extensions. Staff, invitations and audit lists return at most 100 rows, newest first; cursor pagination is not yet implemented.

Cookie-authenticated refresh requires an exact matching Origin header. Browser cookie is HttpOnly, SameSite=Lax, auth-path scoped and Secure in production; local HTTP development omits Secure intentionally. Access JWTs stay in browser memory and expire after 15 minutes; the client attempts renewal after 14 minutes. Health responses contain status only; deployment must restrict readiness at its ingress.

## Phase 2 implemented contract

The following approved routes are now implemented in addition to Phase 1. All require full JWT authentication and the Phase 2 permission matrix in PHASE2-REVIEW.md.

| Endpoint | Payload / response |
| --- | --- |
| GET /patients | q (literal name/contact search), cursor (UUID), limit (1–50); data={items,next_cursor}; tenant-scoped projections |
| POST /patients | {name,contact:{type:EMAIL or MOBILE,value},date_of_birth?}; Idempotency-Key required; returns 201 |
| GET /patients/:id | Reception/operational owner, assigned doctor or linked patient projection |
| PATCH /patients/:id | {name?,date_of_birth?: YYYY-MM-DD or null,expected_version}; clear optional DOB with null; no contact/tenant writes |
| POST /visits | {patient_id}; Idempotency-Key; 201 visit with queue_number, state and version |
| GET /queue | No scope query; {items,queued_count,in_consultation_count,limit}; oldest 100 active tickets; doctors receive no patient names |
| POST /visits/:id/cancel | {expected_version,reason}; Idempotency-Key; queued visits only |
| GET /visits/:id/vitals | Reception or assigned doctor; immutable history |
| POST /visits/:id/vitals | {observations:[{code,value,unit}]}; Idempotency-Key; queued visit only |
| GET /cash/sessions | Reception own / owner tenant opening floats |
| POST /cash/sessions | {opening_float:decimal string,currency:INR}; Idempotency-Key; exact integer paise |

Vitals codes/units: TEMPERATURE/°C, SYSTOLIC_BP/mmHg, DIASTOLIC_BP/mmHg, PULSE/bpm, SPO2/%, WEIGHT/kg, HEIGHT/cm. Duplicate codes and unpaired pressure values return 400. Values are finite; physical quantities are nonnegative and percentages are 0–100; no clinical alert thresholds are asserted. Full names are 2–120 characters, email contacts are lowercased, mobile contacts require international +country-code format, and DOB must be a valid non-future calendar date. Shared-contact accounts are not merged.

Socket.io uses its standard /socket.io transport path with auth.token and exact permitted Origin. After authenticated connection, queue.updated contains {visit_id,state,version} only; clients refetch authorized queue data. Client-supplied tenant rooms are not supported. Vite proxies this WebSocket path to the API during local development.

Cash closing/review, payments, clinical claim-next/completion and patient-record portal APIs stay deferred to their approved later phases. Phase 2 records the opening float, not a completed cash ledger.

## Phase 3 implementation

The Phase 3 endpoints in PHASE3-CONTRACT.md are now implemented. That contract adds the assigned doctor workspace/history, consultation saves, explicit 120-second session-bound draft leases, password-confirmed signing, retained unsigned draft discard, correction revisions, lab/service order creation, completion and append-only post-completion note amendments. All use the existing JWT/purpose/role guards, strict schemas and request/error envelopes. Read projections and retry semantics are detailed in PHASE3-REVIEW.md. No pharmacy dispense, lab result, payment or final cash-close API is exposed.

## Phase 4 implemented endpoints

The concrete Phase 4 API in PHASE4-CONTRACT.md supersedes earlier proposed paths for these resources. GET collections reject unknown queries. All mutations validate strict bodies; tenant_id is rejected. POST operations require Idempotency-Key (16–128 characters); patches use expected_version. Responses retain the existing data/error envelope.

| Resource | Endpoints under /api/v1 | Roles |
| --- | --- | --- |
| Invoices | GET/POST /invoices; GET/PATCH /invoices/:id; POST /invoices/:id/issue | OWNER/RECEPTIONIST; linked PATIENT read issued own only |
| Void | POST /invoices/:id/void | OWNER + fresh MFA; unpaid draft/issued only |
| Receipts | GET/POST /invoices/:id/payments | POST RECEPTIONIST; read invoice scope |
| Cash | GET /cash/sessions/:id; POST /cash/sessions/:id/close, /review | own RECEPTIONIST close; OWNER read/review + MFA |
| Stock | GET/POST /pharmacy/batches; POST /pharmacy/batches/:id/adjustments | OWNER/PHARMACIST read; verified PHARMACIST mutation |
| Fulfillment | GET /pharmacy/prescriptions; POST /prescriptions/:id/dispense | PHARMACIST; licence verification for mutation |
| Substitutions | GET /pharmacy/substitutions; POST /prescriptions/:id/substitutions; POST /pharmacy/substitutions/:id/approve | PHARMACIST request; prescribing DOCTOR password-approved alternative |
| Sample/result | GET /lab/orders; POST /lab/orders/:id/collect; GET/POST /lab/orders/:id/results; GET/PATCH /lab/results/:id | LAB process; requesting DOCTOR read; linked PATIENT current released result GET only |
| Sign/verify/release | POST /lab/results/:id/sign, /verify, /release | LAB + six-digit signoff_pin; requesting DOCTOR + password; LAB explicit release |

Lists are bounded to 100; patients retain existing search/cursor pagination. No arbitrary query/filter/tenant selector is accepted. Invoice lines require description, quantity, unit_price and tax_percent. Close requires expected_version, counted_cash and variance_reason if different. Review requires expected_version, review_note and mfa_proof. Result bodies require observations with name/value, optional unit/reference_interval/comments and overall comments; new signed-result revisions require correction_reason. Stale state/version/stock/overpayments return conflicts, invalid amounts/missing quantities return validation errors; inaccessible resources return 404.

## Phase 5 implemented API

| Endpoint under /api/v1 | Boundary |
| --- | --- |
| POST /auth/patient-activation-requests | Generic public request using facility_subdomain + existing registered login; shared IP/contact rate limits |
| POST /auth/patient-activation | Single-use random token + four-digit portal_pin; no submitted tenant or patient authority |
| GET /portal | Verified PATIENT; linked profile and own recent operational/released records only |
| POST /portal/documents | PATIENT, strict kind/source_id, retry key bound to authorized source, 20 requests/15 min; immutable-source semantic deduplication |
| GET /portal/documents/:id/download | PATIENT ownership plus fresh source authorization; authenticated application/pdf attachment, no public grants/URLs |
| GET /platform/usage?month=YYYY-MM | OWNER; exact consultation count/slabs, observed seat/storage usage, coverage/reconciliation, wallet and unconfigured-price status |
| POST /platform/usage/snapshot | OWNER; records this UTC day's first observation only, never a caller-selected historical date |
| GET/POST /platform/messages | OWNER; nonproduction fixed-template fixture queue; registered verified mobile only, strict patient_id/channel body |
| POST /platform/wallet/test-credits | OWNER + fresh MFA + retry key; explicit test units only, disabled in production |
| POST /platform/bills/preview | OWNER + retry key; closed, fully observed/reconciled month and explicit configured rates; never charges money |
| POST /providers/sandbox/message or /bill | Nonproduction raw-body HMAC + five-minute timestamp tolerance; reference resolves stored tenant resource, tenant_id rejected |

Sandbox-Signature is t=<Unix seconds>,v1=<HMAC-SHA256(secret, t + '.' + raw body)>; secret is at least 32 random characters. Strict fixture callback body is event_id/reference/status. Message status is DELIVERED/FAILED; bill is PAID/FAILED. Duplicate event IDs with identical bytes return duplicate success; changed content conflicts; terminal outcomes cannot reverse. This protocol belongs to the local adapter, not Stripe/Twilio. Production callbacks fail closed. Existing patient OTP and recovery remain purpose-bound; mobile delivery is development-local only until a real messaging provider is configured.
