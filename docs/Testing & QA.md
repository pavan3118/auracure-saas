> **Specification baseline approved by the user; Phase 1 implementation is under review.**
> Sources: uploaded PRD v7 sections 1–4, the user's five-point decisions, and the approved draft specifications.
> Original `ASSUMPTION - needs approval` labels remain as provenance for the approved proposals; they do not record a second pending approval. Changes to that baseline are identified in PHASE1-REVIEW.md.
> Original PRD statements override assumptions. Current implementation evidence and external blockers are recorded in PHASE1-REVIEW.md; planned later-phase APIs are not implemented merely because they appear in these documents.

# Testing & QA

## Status

This is a proposed test strategy, **ASSUMPTION - needs approval (A21)**. All application tests below are planned and unrun. Documentation checks are not evidence of working application behavior.

## Tooling — ASSUMPTION - needs approval (A08, A21)

Propose Vitest for TypeScript unit/client tests, React Testing Library for UI, Supertest for API integration and Playwright for browser journeys. Integration tests use a disposable transaction-capable MongoDB replica set or isolated Atlas test database, never production. Use actual scoped persistence for isolation/concurrency tests; mocking MongoDB cannot validate unique indexes or transaction rollback. Fake provider adapters cover deterministic failure cases; sandbox tests separately validate real provider signatures/delivery.

## Requirement-to-evidence matrix — ASSUMPTION - needs approval (A21)

| Requirement | Required meaningful evidence |
| --- | --- |
| B01, B02, U02 | Facility-type validation; verified contact required; registration rollback on owner failure; duplicate-subdomain race yields one tenant; retry after timeout |
| B03–B08, U04 | Each role's credential provision/login/change flow; owner MFA gating; licence restriction; lab sign-off PIN; patient PIN/OTP ownership |
| B09, A17 | Boundary values 0/1/99/100/101 consultations; seat activation intervals; storage units; messaging retries/failures; duplicate/late usage and correction reconciliation |
| B10, U03 | Six-role allow/deny matrix; forged/missing/expired JWTs; body/query tenant injection rejected; second-tenant resource inaccessible |
| B11, A09 | Navy token usage; keyboard/focus/error states; mobile portal; contrast checks; no accessibility claim based on automation alone |
| A02 | Invite tampering/expiry/replay; owner-approved delegation; self-escalation denied; final owner retained; disabling invalidates sessions |
| A03, A10 | Duplicate check-in; concurrent claim-next; invalid state changes; stale/reconnected queue does not leak another tenant |
| A11 | Lease holder/stale version/expiry conflicts; explicit signing; immutable signed revision; audit event; no automatic signature on timeout |
| A12, A15 | Minor-unit arithmetic; duplicate/overpayment; cash shift isolation; variance reason; void permission; reconciliation to ledger |
| A13 | FEFO eligibility; expired stock rejected; concurrent allocation cannot go negative; unauthorized substitution denied |
| A14 | Wrong sign-off PIN; verification of exact revision; patient cannot read draft/technician-only result; correction invalidates prior release approval |
| A16 | Two patients in one tenant cannot access each other's data; duplicate contacts do not merge identities; signed/released filters on API and PDFs |
| A04, A05, A20 | Token audience/purpose checks; refresh reuse; PIN rate limit across instances; generic recovery response; exact 15-minute expiry; single-use reset; MFA not bypassed |
| A06 | Tenant token cannot access platform scope; operator token cannot access clinical APIs; no implicit impersonation |
| A18, A19 | Signed callback verification over raw body; replay deduplication; unknown provider references ignored; out-of-order events; unset pricing blocks charges |

## Mandatory resource test template — ASSUMPTION - needs approval (A21)

For each implemented resource: permitted success, 401 without valid auth, 403 for wrong role, 400 invalid payload, 404 for a different tenant's identifier, and same-tenant ownership/assignment denial where applicable. Cover list, detail, mutation, aggregation, populate, bulk, exported PDFs, WebSocket rooms and background jobs. Tests need at least two tenants and two patients in one tenant. A passing “different tenant” test alone does not prove patient-level isolation.

## Security and resilience — ASSUMPTION - needs approval (A05, A21)

Test malformed operators/unknown fields, overlong payloads, CORS/CSRF, request limits, stored-script rendering, log redaction, signed download expiry, provider outages and worker retries. Ensure logs exclude contact data, clinical text, passwords/PINs/tokens and MFA secrets. Simulate interrupted registration, database transaction retries and process crashes between commit and outbox delivery. Assert durable deduplication, not exactly-once network transport.

Use a controllable clock for challenge/lease/expiry boundaries, but do not replace transaction or concurrency tests with mocked time-only assertions. Verify backups by restoring synthetic records into an isolated environment and checking access boundaries, not merely checking that a backup job exists.

## Acceptance gates — ASSUMPTION - needs approval (A21)

Each phase requires actual client and server builds, lint and nonzero executed tests. Report passed, failed, skipped and unrun separately; record command, exit status, counts and current-run artifacts. Test coverage percentages cannot replace critical permission/concurrency cases. No disabled assertion or zero-test run can satisfy a gate.

Before release, exercise the representative end-to-end path: verified facility registration → owner MFA → staff provisioning → patient check-in → doctor claim/sign/order → pharmacy dispense → lab sign/doctor verify/release → invoice/payment → patient view → four-meter reconciliation. Use synthetic fixtures, sandbox external services and evidence tied to the tested release. Clinical, legal, pricing, retention and production-provider approvals remain separate from test success.

## Original documentation-only evidence (historical)

Only the nine Markdown drafts and their references/assumption labels are checked in this task. No application builds, lint, unit/API/browser tests, provider requests, database checks or deployment checks have run. Do not call the application or environment production-ready.

## Phase 1 evidence

See PHASE1-REVIEW.md for executed commands/counts. Server tests run against a real MongoDB replica set with an isolated auracare_test_* database and drop only that database. Browser testing exercises both the real API and UI with synthetic contacts, owner MFA and a separate doctor browser context. Integration tests deliberately bypass providers with an injected mailbox; external SMTP/WhatsApp/Atlas behavior remains unverified.

## Default test runner update

The user authorized an Atlas-independent fallback. Root npm test now provisions a mongodb-memory-server replica set and injects its local URI into the suites. It exercises the same real transaction/index/concurrency behavior, with no Atlas connection. The earlier standalone Docker replica-set results remain historical evidence; the fallback run passed 9 UI and 49 server tests.

## Phase 2 evidence

90 server tests and 14 UI tests pass in the disposable replica-set runner. The additional 31 integration/socket tests cover new role boundaries, cross-tenant access, patient ownership, registration/check-in concurrency, retry rollback, vitals lifecycle and live-event isolation/revocation; 10 unit cases cover exact rupee-to-paise conversion and the approved field contract. Five UI tests cover reception actions and forbidden controls. Two Chromium browser journeys pass against their own isolated application, including live updates between receptionist and owner tabs. Startup/shutdown use explicit process ownership, graceful termination and a detached test MongoDB process so teardown does not kill the database before the supervisor closes it. All artifacts use synthetic data only.

## Phase 3 validation scope

The Phase 3 suite adds actual replica-set tests for concurrent claim ownership, same-doctor active-visit uniqueness, note/version finalization, session-bound 120-second leases, expiry/stale updates, password-confirmed signing, immutable revisions, retained draft discard, order RBAC/assignment scope, duplicate completion metering and append-only corrections. Unit cases validate the approved clinical payloads without asserting clinical safety. UI cases enforce explicit leasing/signing/completion intent and preserve unsaved input on failure. The third browser journey exercises the real doctor workflow with synthetic data. Final counts and executed commands are recorded in PHASE3-REVIEW.md.
