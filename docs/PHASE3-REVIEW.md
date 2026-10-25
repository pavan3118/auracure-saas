# Phase 3 — doctor workspace review

Phase 3 implements A10/A11: FIFO claim-next, assigned consultation records, prescription draft leases/signing/revisions, test/service requests, encounter completion and exactly-once completion metering. The user explicitly authorized Phase 3 from the Phase 2 baseline and approved the clinical fields, manual orders and current-password reauthentication. No Phase 4 processing, billing or dispensing is started.

## Approved contract and delivered behavior

See PHASE3-CONTRACT.md for the complete endpoint contract. Consultation drafts contain complaint, assessment and optional plan. Completion requires saved nonempty complaint and assessment. Prescription lines contain manually entered medicine, strength, dose, route, frequency and duration, with optional quantity/instructions. No drug catalogue, dose calculation, diagnosis recommendation, pricing or automated interaction/safety claim is introduced.

- Only DOCTOR can claim the earliest waiting ticket. Transaction/state guards plus unique indexes prevent two doctors from taking the same visit or one doctor from holding two active encounters. A replay returns the original assignment, never advances the queue.
- Patient context, vitals, notes and encounter history require both verified tenant scope and assignment. OWNER is not a clinician and receives no new clinical access. The doctor workspace shows the latest 50 assigned visits; per-encounter revision/order/history lists are bounded to 100 records.
- Saving notes is versioned and serialized against completion. Completed notes become FINAL. Corrections append separately attributed records with reason, password proof and audit event; the base note, completion and meter remain unchanged.
- Prescription edit leases last 120 seconds, bind to the doctor and authenticated session, and require explicit acquisition. Successful content saves or explicit renewal extend expiry. No unattended browser heartbeat extends the lease. Expiry never signs, deletes or changes prescription content.
- Saving/signing requires the active lease and current optimistic version. Signing reauthenticates the current password and validates the credential version inside the transaction. Only failed password proofs consume the clinical reauthentication limit (five failures per 15 minutes), and failures are audited without credential values.
- Signing records immutable revision content, signer/time and a SHA-256 content fingerprint. That fingerprint is an integrity record, not a certified legal digital signature or external e-prescribing integration. Signed source revisions cannot be edited or discarded.
- A correction creates a new DRAFT from the latest signed source and retains the original. Only one draft exists per encounter. Discarding an unsigned draft requires its current edit lease and an explicit reason; the record is retained as DISCARDED and is never issuable/dispensable. This administrative action avoids forcing medication merely to complete a no-medication encounter.
- Lab and additional-service requests are manual ORDERED records, transactionally coupled to audit and retry records. Pricing, specimen/result workflows and service fulfillment remain Phase 4. LAB receives only scoped order projections; consultation notes are not included.
- Completing an encounter requires the latest visit version and no remaining DRAFT prescription. A consultation with no prescription, or with explicitly discarded drafts, can complete. Completion atomically finalizes notes, transitions the visit, audits the action and inserts one COMPLETED_CONSULTATION usage event (quantity 1 encounter), uniquely keyed by tenant/meter/visit.
- Same-key completion retries require the identical original payload. Different keys or altered payloads cannot recount or reopen a completed encounter. Corrections likewise do not increment usage. Prices/slab aggregation remain future billing work; no charge is made.
- Pharmacy can read signed prescription projections; a patient can read only their linked signed record. Drafts/discarded records and other patients' records return inaccessible responses. OWNER, reception and LAB cannot read prescriptions through this API. Phase 4 must choose the latest applicable signed revision for dispensing rather than treating retained older signed revisions as new orders.

## Security/concurrency review details

All new domain collections require tenant_id and use the same scoped repositories. Client tenant_id and unknown fields are rejected by Zod. Critical mutations serialize through visit state/version and, when needed, prescription version/lease. Sign/amend credential checks serialize with credential changes. All resource/audit/retry writes occur in transactions; no clinical content is published in queue notices.

The shared scope guard now inspects update field paths and rename targets rather than searching string values. The literal word tenant_id may appear in clinical text, while actual tenant mutation and rename-to-tenant attempts remain forbidden. Aggregation update pipelines are not accepted through that helper.

Retry ledgers contain request fingerprints and resource references, not passwords, password hashes, clinical notes or medication bodies. Signing fingerprints intentionally exclude password proofs. Completion and claim keep durable source references, in addition to the standard 24-hour operation ledger. No patient material is written to logs or review artifacts; screenshots/tests contain synthetic data only.

## Validation

Final checks passed: **131 server tests** across 6 suites, **22 UI tests** across 3 suites, and **3 Chromium browser journeys**, all with clean completion. The Phase 3 additions are 36 integration/concurrency cases, 5 domain unit cases, 8 UI cases and one browser journey. `npm run build`, `npm run lint`, `npm run format:check`, `git diff --check` and `npm audit --audit-level=moderate` passed; the audit reports zero vulnerabilities. Tests run against disposable local replica sets, not Atlas.

Coverage includes all six role boundaries, assignment vs same-tenant access, cross-tenant reads/writes, concurrent competing claims, simultaneous same-doctor claims, idempotent claim replay, lease expiry/reacquisition, session-bound leases, stale edits, password failure limiting, explicit signing, signed immutability, correction/discard lifecycle, lab/service scope, duplicate completion, transactional rollback, one meter event and append-only corrections.

Browser validation exercises actual owner/staff provisioning and the doctor flow: claim → patient/vitals → save note → acquire lease → manual medicine fields → save → explicit password-confirmed signing → order test → complete → append correction → reload. Phase 1 and Phase 2 browser journeys are retained. Tests use the isolated memory-server replica set and private synthetic mailbox; no Atlas connection, live messaging, real prescribing or payment occurs.

## Limits and phase gate

- Atlas was reported verified by the user. This phase does not alter the DNS fix, reconnect to Atlas or claim new cloud Atlas evidence.
- No clinical decision support, approved drug catalogue, legal e-signature certification, prescribing licence checks or clinical alert thresholds are inferred from manually entered fields.
- Completed encounters accept append-only note amendments; new prescribing after completion requires a new encounter, rather than mutating the completed record.
- Pharmacy dispensing, lab results, invoicing, payment collection and final cash reconciliation are still Phase 4. Existing live fan-out remains single-process as documented in Phase 2.
- CodeRabbit authentication was not supplied in this phase; no CodeRabbit review ran. The previously recorded container login prerequisite remains separate from internal test evidence.
- Review Phase 3 before starting Phase 4; NEXT PHASE is required.

## Delivery and reusable setup

The Phase 3 startup instructions were saved to the environment draft, preserving installation and networking settings. Saving does not execute, publish, restart or establish fresh-task restoration. Review/save environment settings and publish when ready. Phase 3 is delivered on its own review branch derived from Phase 2; earlier branches are not automatically merged. Credentials, keys, local mailbox messages, screenshots and private configuration remain excluded from Git.
