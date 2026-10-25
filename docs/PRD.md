> **Specification baseline approved by the user; Phase 4 implementation is under review.**
> Sources: uploaded PRD v7 sections 1–4, the user's five-point decisions, and the approved draft specifications.
> Original `ASSUMPTION - needs approval` labels remain as provenance for the approved proposals; they do not record a second pending approval. Changes to that baseline are identified in PHASE1-REVIEW.md.
> Original PRD statements override assumptions. Current implementation evidence and external blockers are recorded in PHASE4-REVIEW.md (earlier reviews retain historical evidence); planned later-phase APIs are not implemented merely because they appear in these documents.

# AuraCare — completed PRD draft

## 1. Baseline: system overview and scope

**PRD v7 sections 1–4, retained as authoritative requirements:** AuraCare is a cloud-native healthcare management SaaS for outpatient clinics, polyclinics and diagnostic centers. It uses MERN + TypeScript, strict MongoDB tenant isolation and a unified navy interface (`#102A38`) to consolidate clinical, operational, financial and multi-role workflows.

| ID | Authoritative baseline requirement |
| --- | --- |
| B01 | Support the three facility types above using a multi-tenant MERN + TypeScript system. |
| B02 | Screen 00 is a self-service facility onboarding wizard capturing facility metadata and capacity metrics, configuring pay-as-you-go billing, and provisioning credentials for six actor roles. |
| B03 | Owner/Admin registers directly in Step 5 using an email-format user ID; master password plus mandatory 2FA/MFA setup. |
| B04 | Doctor is batch-seeded by Owner or invited; user ID may be `dr.lastname@clinic.com` or mobile; secure generated link or temporary password with mandatory change on login. |
| B05 | Receptionist is created by Owner in Screen 07; user ID may be `rec.firstname@clinic.com` or employee ID; shift PIN or strong alphanumeric password with audit logging. |
| B06 | Pharmacist is provisioned by Owner / Pharmacy Admin; user ID may be `pharm.firstname@clinic.com` or licence ID; password and licence verification check. |
| B07 | Laboratory Technician is provisioned by Lab Partner / Owner; user ID may be `lab.tech@clinic.com` or lab ID; password plus diagnostic sign-off PIN. |
| B08 | Patient account is automatically created at check-in / booking; primary mobile or email is the user ID; four-digit portal PIN or one-click WhatsApp OTP authentication link. |
| B09 | No upfront licence commitment; four meters: active clinician seats, completed consultation slabs per 100 encounters, WhatsApp/SMS credit wallet, PDF cloud storage. |
| B10 | Six system actor roles have strict operational boundaries enforced by server-side RBAC and HTTP 403 responses. |
| B11 | Unified interface uses navy `#102A38`. |

The PRD calls staff passwords “encrypted.” Secure password storage must be one-way hashing rather than reversible encryption: **ASSUMPTION - needs approval (A05)** interprets that wording as the password protection objective; confirm this interpretation before implementation.

## 2. Approved additions from the user

| ID | Approved decision |
| --- | --- |
| U01 | Draft missing PRD sections and the eight accompanying specifications; no application code before APPROVED. |
| U02 | Public `POST /api/v1/onboarding/register` at Screen 00 Step 5 creates Tenant and Owner atomically, then issues a JWT containing tenant_id. Require rate limiting, contact verification and unique subdomain validation. |
| U03 | All other tenant operations obtain tenant_id exclusively from a verified JWT, never request body, path or query. |
| U04 | Exactly six business roles: OWNER, DOCTOR, RECEPTIONIST, PHARMACIST, LAB, PATIENT. Pharmacy Admin and Lab Partner are provisioning actors acting through these existing roles, never additional roles. |
| U05 | Propose internal SYSTEM_ADMIN for platform operators only, as an assumption. |
| U06 | Prices/provider are undefined: use configuration placeholders and propose a provider. Propose MFA method, messaging abstraction and recovery rules with a 15-minute expiry, all as assumptions. |

## 3. Screen 00 — facility onboarding

**Approved:** U02 transaction and security boundaries; B02–B03 onboarding and owner authentication.

**ASSUMPTION - needs approval (A01):** Wizard steps: (1) facility identity/contact and subdomain, (2) capacity, (3) enabled operational services, (4) usage/billing acknowledgement and staff invite preparation, (5) verified owner registration. Proposed required fields are facility name/type, owner name/email, verified contact reference, desired subdomain and password; capacity and service fields require business sign-off. Staff invitations are sent only after tenant creation; never return temporary credentials in normal API responses.

Acceptance proposal (A01): duplicate normalized subdomains cannot create two tenants under concurrent requests; failed transactions leave neither a partial tenant nor owner. No paid activation or price is implied by onboarding.

**ASSUMPTION - needs approval (A04):** Step 5 issues an MFA-enrollment-only JWT after commit. Owner cannot access business operations until MFA is enrolled. Authentication challenge endpoints are narrowly scoped exceptions to the general authenticated-route rule; see Authentication & Security.md.

## 4. Roles and staff management — Screen 07

**Baseline:** B03–B08 and U04 govern credentials and actors.

**ASSUMPTION - needs approval (A02):** OWNER invites, disables and changes permitted staff roles; PHARMACIST and LAB may initiate invitations only for their own role under OWNER approval. No actor can promote itself. STAFF invitation acceptance provisions the invited role, forces any temporary password change and records an audit event. Licence verification gates pharmacist dispensing. Disabling staff revokes active sessions; disabling the final active owner is rejected. Patient accounts have no staff provisioning rights. See the proposed permission matrix in Authentication & Security.md.

## 5. Reception workspace

**ASSUMPTION - needs approval (A03):** Reception can search/register patients, collect vitals, create a visit, place it in a live queue, record payments and reconcile cash. Required demographic fields, vital types/units, duplicate detection, appointment scheduling and consent language require approval; do not infer these from clinical conventions.

Proposed acceptance (A03): retrying check-in creates one visit; the queue refreshes after committed changes; reception cannot edit clinical notes or see other tenants' patients. Proposed cash workflow (A12): opening float, immutable cash movement records and end-of-day reconciliation with a variance reason and OWNER review. Cash accounting and billing integration remain proposed.

## 6. Doctor workspace

**ASSUMPTION - needs approval (A10):** Doctor atomically claims the next eligible queued visit, records consultation details, drafts prescriptions and orders additional services. Proposed states: QUEUED → IN_CONSULTATION → COMPLETED, with CANCELLED permitted before completion. Corrections after completion are appended, not destructive edits.

**ASSUMPTION - needs approval (A11):** Prescription drafts use optimistic versions and a 120-second inactivity edit lease renewable by the holder; expiry releases editing ownership, not a clinical signature. Signing is explicit and makes the revision immutable. Exact mandatory prescription fields, drug catalog source, legal signing and clinical safety rules need approval; no automated diagnosis/dosing is proposed.

Proposed acceptance (A10–A11): two doctors cannot claim the same visit; a stale prescription update returns conflict; signed revisions remain auditable. Consultation completion emits one metering event regardless of retries.

## 7. Pharmacy workspace

**ASSUMPTION - needs approval (A13):** Verified pharmacists receive signed prescriptions, allocate eligible stock by first-expiry-first-out, record dispensing and handle substitutions only with documented doctor approval. Expired stock cannot be dispensed. Allocation is atomic and cannot make stock negative. Stock quantities use approved units; batch number, expiry and quantity rules require review. Returns, controlled drugs, supplier purchasing and valuation are not specified and remain outside the proposed first release unless approved.

## 8. Laboratory workspace

**ASSUMPTION - needs approval (A14):** LAB tracks orders through ORDERED → COLLECTED → RESULT_DRAFT → TECH_SIGNED → DOCTOR_VERIFIED → RELEASED. Sign-off requires the technician's diagnostic PIN; a doctor verifies before patient release. Corrections create a new revision and repeat verification. Units, reference intervals, critical-result escalation, verifier eligibility and report content need clinical approval. Unreleased results are unavailable to patients.

## 9. Invoicing and payments

**ASSUMPTION - needs approval (A15):** Tenant patient invoices are separate from platform subscription/usage bills. Proposed states: DRAFT → ISSUED → PARTIALLY_PAID → PAID, with VOID requiring OWNER authority and a reason. Issued line items and prices are immutable; corrections use auditable adjustments. Use integer minor currency units and one configured currency per tenant. Taxes, numbering, refunds, legal retention and rounding require jurisdiction-specific approval. Payment retries cannot duplicate a receipt.

## 10. Patient view

**ASSUMPTION - needs approval (A16):** Patient sees only their linked profile, visit status, signed prescriptions, released lab reports and own invoices/receipts. Tenant-scoped identity and patient linkage are required even when two accounts share contact details. Family/dependent access and cross-facility identity are not defined. No clinical editing, staff visibility or tenant switching based on unverified contact matching.

## 11. Metered platform billing

**Baseline:** B09 four meters; rates/provider are not supplied.

**ASSUMPTION - needs approval (A17):** Monthly UTC billing periods; clinician seats count active DOCTOR accounts using daily prorated seat-days; consultation slabs equal ceil(completed billable encounters / 100) per period, with zero encounters producing zero slabs; messaging wallet debits on provider acceptance with compensating credits for definitive failure; PDF storage uses daily average retained bytes converted to GB-month. These definitions are proposals, not PRD facts.

**ASSUMPTION - needs approval (A18):** Propose Stripe for platform billing subject to supported country, currency and business requirements. Price IDs/rates, tax settings and wallet funding remain unset configuration placeholders. Missing pricing disables charge execution and displays “pricing not configured”; never assume zero-cost service. Usage events are idempotent, tenant-scoped and auditable; invoice calculations record rate versions. Provider integration is sandbox-only until separately authorized.

## 12. Assumption register and review gates

Every detail under an assumption-labelled section is proposed, including its acceptance criteria. Cross-document references preserve this status.

| ID | ASSUMPTION - needs approval |
| --- | --- |
| A01 | Wizard steps, fields, staff invite sequencing and verification mechanism. |
| A02 | Staff lifecycle, provisioning delegation and detailed permission matrix. |
| A03 | Reception/patient registration, vitals and queue details. |
| A04 | Owner TOTP, challenge routes, token lifecycle and pre-MFA enrollment restriction. |
| A05 | Password hashing, PIN controls, recovery, rate-limit thresholds and other security parameters. |
| A06 | Internal SYSTEM_ADMIN role, platform scope and operator access controls. |
| A07 | Proposed collections, fields, indexes, API contracts and transaction/idempotency mechanisms. |
| A08 | Proposed stack versions, deployment architecture and development tooling from the master prompt. |
| A09 | Layout, navigation, design tokens beyond navy, and accessibility target. |
| A10 | Consultation/queue states and claim/completion rules. |
| A11 | Prescription lease, signing, revisions and clinical documentation fields. |
| A12 | Cash float, reconciliation and variance workflow. |
| A13 | Pharmacy inventory, FEFO allocation and substitution workflow. |
| A14 | Laboratory lifecycle and doctor-first release. |
| A15 | Invoicing, payment accounting and financial corrections. |
| A16 | Patient portal content and account linkage. |
| A17 | Meter definitions, billing period, retries and adjustments. |
| A18 | Stripe proposal, configurable pricing and payment activation policy. |
| A19 | Messaging adapter, OTP delivery and webhook behavior. |
| A20 | Recovery expiry of 15 minutes, proof requirements and session invalidation. |
| A21 | Testing gates, build order, operations, hosting, backups and retention. |

## 13. Explicit unresolved decisions

**ASSUMPTION - needs approval (A21):** Before implementation, approve or amend A01–A21. Before production use, decide jurisdiction/compliance obligations, data residency, consent, record retention/deletion, breach response, clinical safety, accessibility requirements, taxes/currency and vendor suitability. No compliance certification or production readiness is claimed by these drafts.

Decide specifically whether the public verification/login/recovery routes proposed in A04/A20 are approved exceptions to U03. Without those exceptions, unauthenticated contact verification, login and recovery cannot operate. They must never accept a client-supplied tenant_id as authority; verified tenant-bound challenges supply scope.

## Phase 2 approved implementation decisions

The user approved full name, a unique email or international mobile contact, optional birth date, and optional temperature °C, paired systolic/diastolic mmHg, pulse bpm, SpO₂ %, weight kg and height cm. The user selected INR. These decisions resolve the reception field/unit and opening-float currency questions for A03/A12. No diagnostic thresholds, consent language or family-access model is inferred. See PHASE2-REVIEW.md for the implemented scope and deferred Phase 4 reconciliation.

## Phase 3 approved clinical field decisions

The user approved complaint and assessment as required at consultation completion, optional plan, and manually entered prescription medicine/strength/dose/route/frequency/duration with optional quantity/instructions. The user also approved manual test/service names, optional clinical instructions and the assigned doctor's current password for signing reauthentication. No catalogue, automated dosing or legal signature certification is assumed. See PHASE3-CONTRACT.md and PHASE3-REVIEW.md for the technical contract and evidence. Discarded unsigned drafts are retained administratively; signed revisions and completed notes remain immutable, with explicit revisions/amendments.

## Phase 4 approved decisions and implementation

The user explicitly authorized Phase 4 and approved its INR invoice/tax/receipt rules, full FEFO dispensing and doctor-approved substitutions, lab sign-off/verification/release, and owner-reviewed cash close. These decisions refine A04/A05/A06/A12; the original uploaded baseline remains authoritative. PHASE4-CONTRACT.md specifies the implemented endpoint and state contracts; PHASE4-REVIEW.md records validation and limits. Patient portal UI, external messaging, SaaS subscription prices/provider charges, refunds and deployment remain outside this phase.
