# Phase 2 — reception review

Phase 2 implements A03 (reception), the reception portion of A10 (queue), A12's opening cash float, and the shared tenancy/idempotency requirements in A07. The user authorized Phase 2 after testing Phase 1 and reporting the MongoDB DNS issue resolved. No Atlas connection or DNS configuration was changed by Phase 2.

## Approved field decisions

The user explicitly approved full name plus a unique email or international mobile contact; optional date of birth; optional temperature (°C), systolic/diastolic blood pressure (mmHg), pulse (bpm), SpO₂ (%), weight (kg), and height (cm). The user selected **INR** for cash floats. Shared-contact/family portal access is deferred; separate contacts are required for these accounts. Payment collection and final invoice/cash reconciliation stay in Phase 4, as already specified in the implementation plan and reiterated in the currency question.

## Delivered behavior

- A RECEPTIONIST lands in the reception workspace and can search/register patients, edit name/date of birth, check in, record vitals history, cancel queued visits and record their opening float.
- Patient contacts are normalized and unique inside a tenant. The same contact in separate facilities is a separate identity. Search treats regex characters literally and paginates with opaque UUID cursors.
- Patient demographic edits require the latest version. Contact changes require a separate verification process and cannot be mass-assigned through PATCH.
- Check-in atomically creates one active visit, advances the facility's monotonic ticket sequence, provisions a dormant PATIENT account if needed, links it to the profile and records an audit event. A unique partial index protects against simultaneous different requests creating two active visits.
- PATIENT accounts created at check-in have a cryptographically generated, peppered/hashed PIN that is never returned or logged. They remain unverified and cannot sign in. Patient contact verification/activation and messaging UI belong to the later patient/integration phase; no one can activate an account merely by submitting another person's contact.
- Vitals enforce the approved units, paired blood-pressure measurements, unique observation codes and numeric validity. No automated clinical interpretation, diagnosis or alert thresholds were introduced. Saved entries are immutable history; recording advances the visit version and serializes against cancellation.
- Queued visits can be cancelled with an explicit reason and version. Consultation claim/completion remains Phase 3. Cancelling retains the patient and allows a subsequent check-in with a new ticket.
- INR opening floats convert decimal strings to integer paise using BigInt arithmetic. One open float per receptionist is protected by a unique partial index. OWNER sees tenant floats; receptionists see their own. No payment, cash movement, close, variance review or final reconciliation endpoint is exposed yet.
- Socket.io authenticates full JWTs, role, origin, tenant and session. Events contain only visit ID/state/version. Every emission revalidates authentication; expiry disconnects the socket and revocation is also checked every five seconds. There are no client-selected tenant rooms. The client refetches authorized HTTP data on updates/reconnect and every 15 seconds while mounted.

## Access boundaries

| Resource | RECEPTIONIST | OWNER | DOCTOR | PATIENT | PHARMACIST / LAB |
| --- | --- | --- | --- | --- | --- |
| Patient search/list | Tenant records | Operational name/ID only | Denied | Denied | Denied |
| Patient detail | Tenant records | Operational name/ID only | Assigned patient only | Own linked profile only | Denied until order-based scope exists |
| Patient create/edit | Allowed | Denied | Denied | Denied | Denied |
| Queue | Manage check-in / queued cancellation | Operational view / queued cancellation | IDs/state/tickets only | Denied until own-visit portal exists | Denied |
| Vitals | Record queued visits / read history | Denied | Read assigned visit only | Denied | Denied |
| Cash float | Open/read own | Read tenant floats | Denied | Denied | Denied |

All tenant scope comes from the existing verified JWT; Zod rejects tenant_id, unknown fields and unsupported operations. Raw domain models are not exported. The existing scoped repository now supports bounded sorted reads and counts. New collections are patients, visits, vitals, cash sessions and a transaction retry ledger, all with required tenant_id.

## Retry and concurrency guarantees

A transaction-scoped operation ledger binds actor + tenant + operation + key + request fingerprint. It stores resource references, not patient bodies. Concurrent identical retries return the committed resource; altered input with the same key returns 409; failed callbacks roll back the record, resource and audit together. Ledger entries expire after 24 hours. Visits and cash floats additionally carry durable unique retry references to prevent an expired ledger from duplicating these actions.

Queue numbers are facility-wide monotonic sequence values, not daily invoice numbers. FIFO order follows the committed sequence. Active queue results show at most the oldest 100 visits, with total waiting/in-consultation counts and an explicit UI notice above that limit. Patient pages support 20 default / 50 maximum rows and a next cursor.

## Validation record

The latest successful core run has **90 server tests** (49 Phase 1, 31 Phase 2 integration/socket tests, 10 reception unit cases) and **14 UI tests** (9 existing + 5 reception). Build, lint and formatting checks pass. Dependency audit reports zero vulnerabilities after updating Zod to 4.6.7 for its published constrained-collection advisory.

Both real Chromium journeys passed with clean shutdown: Phase 1 regression and the Phase 2 receptionist → registration → check-in → owner live update → vitals → opening float → cancellation → reload sequence. The final run exited successfully with 2 passing browser tests; earlier harness shutdown failures were diagnosed and fixed.

The browser harness now provisions its own memory-server replica set and forces development/local mailbox delivery. It does not touch Atlas, existing development records or external messaging. The trusted pinned MongoDB binary is reused from the Phase 1 test setup. Browser screenshots contain synthetic data only.

## Limits retained for review

- Payment collection, final EOD reconciliation/variance and shift closing are deliberately disabled until the Phase 4 invoice/payment ledger. Phase 2 does not claim those flows passed.
- Doctor claim-next, consultation and signed prescriptions remain Phase 3. No clinical workflow is silently implemented under reception scope.
- New portal accounts remain dormant pending contact ownership proof; no PIN is displayed to reception or sent through an unconfigured provider.
- Live events currently fan out within one API process. Multiple API instances need the approved shared adapter/outbox deployment work before claiming cross-instance live delivery. The periodic authorized refetch covers missed events, but is not a shared event bus.
- Queue and history views are bounded. Legal consent wording, clinical thresholds, production retention and multi-facility/family account policies are still not invented.
- Atlas is user-verified; this phase's tests use an isolated local replica set. No production deployment or new independent Atlas verification is claimed.
- CodeRabbit CLI 0.9.1 was installed from its signed official Linux release. Its private configuration directory needed narrowly scoped filesystem access, which was granted. Version/auth-status then worked; no existing API-key binding or login was present. The required auth login --agent reports environment_unsupported because browser callbacks are unavailable in this container. The CLI requires an Agentic API key or a browser-enabled terminal on this machine. No review ran and its issue count is unknown; do not attribute the internal checks to CodeRabbit. Supply credentials only through secure environment settings, never chat or Git.

Stop for Phase 2 review. Do not begin Phase 3 without NEXT PHASE.

## Reusable environment and delivery state

Phase 2 startup instructions were saved in the environment draft while preserving install/network settings. This does not execute the instructions, restart services or publish a snapshot. Review/save environment settings and publish when ready; no new-task restoration claim is made. Application credentials, local mailbox data, screenshots, binaries and CodeRabbit configuration are excluded from Git.
