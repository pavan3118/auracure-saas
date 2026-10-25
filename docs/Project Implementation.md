> **Specification baseline approved by the user; Phase 1 implementation is under review.**
> Sources: uploaded PRD v7 sections 1–4, the user's five-point decisions, and the approved draft specifications.
> Original `ASSUMPTION - needs approval` labels remain as provenance for the approved proposals; they do not record a second pending approval. Changes to that baseline are identified in PHASE1-REVIEW.md.
> Original PRD statements override assumptions. Current implementation evidence and external blockers are recorded in PHASE1-REVIEW.md; planned later-phase APIs are not implemented merely because they appear in these documents.

# Project implementation plan

## Authorization boundary

This change delivers documentation only. Wait for the user's explicit **APPROVED** before application code. The plan below is **ASSUMPTION - needs approval (A21)** and incorporates the pasted master prompt's proposed phases. Completion of a phase must have evidence; drafting a section does not complete that feature.

## Ordered specification review

Review PRD → DATABASE → API → Authentication & Security → ARCHITECTURE → DESIGN → Project Implementation → Setup → Testing & QA. Original PRD scope overrides assumptions; security requirements take priority over implementation convenience. Resolve contradictions explicitly before coding. Approval may accept or amend individual A01–A21 items; silence never accepts a proposal.

## Phase plan — ASSUMPTION - needs approval (A21)

| Phase | Scope and dependencies | Definition of done |
| --- | --- | --- |
| 1 Foundation/onboarding | Approve docs/public exceptions; monorepo/tooling; Atlas transaction connectivity; Tenant/Owner bootstrap; six-role auth, MFA/recovery, scoped repositories; Screen 00 and Screen 07 | Atomic registration/unique-subdomain races tested; owner MFA blocks normal access until enrolled; credential lifecycle and permission tests pass; cross-tenant isolation proven; client/server build, lint and nonzero tests pass |
| 2 Reception | Phase 1; patient identity rules, demographics and vital schemas approved; registration/check-in, queue, reception cash workflow | Duplicate retries create one visit; queue updates verified; cash arithmetic/variance audit tested; prohibited clinical access blocked; required checks pass |
| 3 Doctor | Phase 2; consultation and prescription fields approved; claim-next, encounter completion, draft lease, signing and lab orders | Concurrent claim conflict tested; expired/stale draft writes rejected; signing immutable; consultation meter event deduplicated; required checks pass |
| 4 Pharmacy/lab/invoicing | Phase 3; clinical release, stock units and invoice/tax rules approved; FEFO, substitutions, result verification/release, invoices/receipts | No negative stock under concurrency; unverified results unavailable to patients; invoice/payment reconciliation and retry behavior tested; required checks pass |
| 5 Patient/metering/operations | Prior workflows; provider/pricing/legal decisions; portal, four meters, provider adapters, sandbox integrations, deploy configuration | Patient ownership tests; usage replay/reconciliation; webhook auth/replay tests; dependency/secret review; backup/restore evidence; deployment smoke test and all required checks pass |

Lab order creation is defined in Phase 3 with schema/contracts prepared in Phase 1; processing/release arrives in Phase 4. Usage event contracts are defined before billable features, not retrofitted in Phase 5. Phase 2 may create an open cash session, but collecting payments and final reconciliation depend on Phase 4's invoice/payment ledger; do not claim the full cash workflow done early. Patient accounts are created at Phase 2 check-in, while their portal UI comes in Phase 5. Deferred functionality is explicitly disabled until its dependent phase is complete.

## Build loop — ASSUMPTION - needs approval (A21)

For each approved requirement: cite its B/U/A ID; finalize schema/API/acceptance contract; implement model → service → route → UI; add meaningful unit, API, permission and cross-tenant tests; run affected checks; report changed files, commands and results. Enforce strict TypeScript and central validation/errors. Stop after each phase for review; start the next only after “NEXT PHASE,” per the proposed master-prompt workflow.

## Production gate — ASSUMPTION - needs approval (A21)

Required evidence: all-role permission matrix coverage, tenant isolation across HTTP/workers/Socket/PDFs, authentication/recovery review, clinical signing/release integrity, financial and stock concurrency, usage reconciliation, provider sandbox verification, no leaked secrets/PII, approved index deployment, documented configuration, synthetic seed process, CI/container checks and backup restoration. Record known issues separately. Missing legal, pricing, provider, retention or clinical approvals block production activation; passing unit tests alone does not establish readiness.

## Original documentation checkpoint (historical)

Nine draft specifications exist. No application dependencies installed, no application tests run, no Atlas connection verified and no provider resource created. That was the documentation-only checkpoint; see PHASE1-REVIEW.md for the later implementation state.

## Phase 2 checkpoint

The user tested Phase 1, reported the MongoDB DNS issue resolved and authorized NEXT PHASE. Phase 2 reception is implemented; see PHASE2-REVIEW.md for exact approved fields, evidence and deferred cash reconciliation. CodeRabbit authentication remains an external prerequisite. Stop for Phase 2 review; do not start Phase 3 until NEXT PHASE.

## Phase 3 checkpoint

Phase 3 was explicitly authorized and its open clinical field/signing/order questions approved by the user. The doctor workspace, prescribing lifecycle, completion metering and append-only corrections are implemented. See PHASE3-REVIEW.md for checks and limits. Stop for review; Phase 4 remains gated by NEXT PHASE.
