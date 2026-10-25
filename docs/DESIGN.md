> **Specification baseline approved by the user; Phase 4 implementation is under review.**
> Sources: uploaded PRD v7 sections 1–4, the user's five-point decisions, and the approved draft specifications.
> Original `ASSUMPTION - needs approval` labels remain as provenance for the approved proposals; they do not record a second pending approval. Changes to that baseline are identified in PHASE1-REVIEW.md.
> Original PRD statements override assumptions. Current implementation evidence and external blockers are recorded in PHASE4-REVIEW.md (earlier reviews retain historical evidence); planned later-phase APIs are not implemented merely because they appear in these documents.

# Design specification

## Baseline

The PRD mandates a unified navy interface using `#102A38`, Screen 00 facility onboarding and Screen 07 staff management. All remaining design proposals are **ASSUMPTION - needs approval (A09)**; workflow content also inherits its PRD assumption IDs.

## Proposed foundations — ASSUMPTION - needs approval (A09)

Use navy `#102A38` for primary navigation and key actions; proposed supporting tokens: canvas `#F5F7FA`, surface `#FFFFFF`, text `#172B36`, muted text `#526571`, border `#D6DFE5`, success `#166534`, warning `#92400E`, danger `#B91C1C`, focus `#2563EB`. Validate actual foreground/background contrast in implementation before approving combinations. Never convey clinical or financial state by color alone.

Propose system sans-serif type, 16px body, 14px labels, 24px page headings, 4px spacing grid, 8px input/card radius and 44px minimum touch targets. Use 200ms transitions only where helpful; respect reduced motion. Target WCAG 2.2 AA with keyboard navigation, visible focus, explicit labels, accessible errors and screen-reader announcements. This is a target, not a verified conformance claim.

## Navigation and screens — ASSUMPTION - needs approval (A09)

| Workspace | Proposed content |
| --- | --- |
| Screen 00 | Five-step wizard as PRD A01, verification status, duplicate-subdomain error, MFA enrollment continuation |
| Owner | Operational overview, Screen 07 staff, facility settings, usage/platform billing, audit and cash review |
| Reception | Patient search/register, check-in, vitals, queue, patient invoicing and cash close |
| Doctor | Assigned queue, consultation, prescription revisions, orders and result verification |
| Pharmacy | Prescription worklist, batches/expiry and dispensing |
| Laboratory | Order worklist, result entry, sign-off and verified release |
| Patient mobile | Own visit status, signed prescriptions, released reports and invoices |

Only Screen 00/07 numbering is authoritative; no new numeric screen IDs are asserted. Navigation is capability-based but all permissions remain enforced by the API. Do not show OWNER a clinical dashboard by default.

## Interaction rules — ASSUMPTION - needs approval (A09, A11–A16)

Every screen specifies loading, empty, error, success and forbidden states. Preserve form input on recoverable failures; mask confidential fields on shared screens. Use explicit confirmation for signing, releasing, voiding and disabling; name the irreversible effect. Prescription lease expiry displays read-only/conflict guidance, never an automatic signature. Reconnect queue state from the server and label stale data instead of suggesting a live connection.

Patient views are mobile-first; proposed breakpoints are 640/1024px, with desktop tables converting to readable cards. Avoid layout shift with stable loading placeholders. Lab drafts and unreleased files never appear in portal responses or hidden client components. Show unconfigured pricing explicitly rather than a fabricated price. Avoid patient details in notifications visible on lock screens.

## Design review needed — ASSUMPTION - needs approval (A09)

Approve token palette, brand assets, screen wireframes, patient identity/recovery UX, clinical field layouts and role-specific projections before treating screenshots as acceptance evidence. No mockup or design asset has been generated or approved in this draft.

## Phase 4 workspace delivery

Verified PHARMACIST accounts land on Stock & dispensing with batch receipt, reasoned adjustments, exact prescription lines, FEFO full fulfillment and retained allocation snapshots. Generic requests show original and alternative product labels; doctors explicitly approve with their current password. LAB lands on Samples & results with collection, manual analytes, draft editing, PIN sign-off, attributed revision history and verified-result release. DOCTOR navigation adds laboratory verification and generic approvals.

OWNER/RECEPTIONIST navigation adds invoices and receipts. Patient search feeds the invoice chooser; multi-line drafts display explicit prices/taxes and can be edited before issuance. Receipt forms distinguish cash from manually recorded noncash references. Reception cash shows expected/count/variance and offers own-shift close; owners review CLOSED records with fresh MFA. Server errors remain visible without success claims; state transitions refetch authorized projections. No portal result UI is delivered before Phase 5.
