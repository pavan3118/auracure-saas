> **Specification baseline approved by the user; Phase 1 implementation is under review.**
> Sources: uploaded PRD v7 sections 1–4, the user's five-point decisions, and the approved draft specifications.
> Original `ASSUMPTION - needs approval` labels remain as provenance for the approved proposals; they do not record a second pending approval. Changes to that baseline are identified in PHASE1-REVIEW.md.
> Original PRD statements override assumptions. Current implementation evidence and external blockers are recorded in PHASE1-REVIEW.md; planned later-phase APIs are not implemented merely because they appear in these documents.

# Architecture

## Confirmed constraints

MERN + TypeScript, MongoDB tenant isolation, six tenant roles, atomic Tenant/Owner bootstrap and four billing meters are authoritative. Everything else in this document is **ASSUMPTION - needs approval (A07, A08, A18, A19, A21)**.

## Proposed components — ASSUMPTION - needs approval (A08)

Use a monorepo with `/client`, `/server`, `/docs`. Proposed client: React 18, TypeScript, Vite, Tailwind, React Router v6, Lucide and Axios. Proposed server: Node.js 24 LTS, Express, TypeScript, Mongoose, Zod, JWT, bcryptjs and Socket.io. Use npm workspaces with one committed lockfile and pinned dependencies after approval. Exact package versions and compatibility must be selected and verified during implementation; no package manifest currently exists.

Start as a modular monolith with controller → service → scoped repository/model boundaries. Modules: onboarding, identity/staff, patients/reception, consultations/prescriptions, pharmacy, laboratory, invoicing/cash, patient portal, usage/platform billing, documents, audit and integrations. Avoid adding separate microservices before evidence requires them.

## Request and event flow — ASSUMPTION - needs approval (A07, A08)

HTTP → request ID/limits → authentication/purpose validation → tenant context → role permission → Zod validation → service transaction → scoped data access → sanitized projection. Enforce ownership/assignment inside services, not only routes. Central error mapping implements API.md.

Commit state plus an outbox event in the same transaction. A worker polls committed pending events, retries with bounded backoff and records terminal failures for review. Workers receive tenant-scoped jobs and use the same scoped repositories. Delivery is at-least-once; consumers/provider callbacks deduplicate by durable event references. Never broadcast before commit. Socket clients refetch after reconnect because events are not the source of truth.

## Runtime services — ASSUMPTION - needs approval (A08, A19, A21)

- MongoDB Atlas with transaction support, least-privilege service identity and controlled network access.
- Redis proposed for shared rate-limit counters and multi-instance Socket.io fan-out; local single-instance development may use an explicit in-memory adapter but never claim multi-instance validation.
- Private S3-compatible object storage for PDFs, with retention and metering adapters.
- Messaging interface: sendOtp, sendTemplate, getDeliveryStatus and verifyWebhook; propose Twilio for WhatsApp/SMS subject to country support and approved templates. Never embed vendor credentials in frontend bundles.
- Platform billing interface: quoteUsage, createInvoice and verifyWebhook; propose Stripe subject to business approval. No real charges until pricing and activation are approved.
- Contact verification delivery may need email as well as messaging; provider and account requirements remain undecided. Do not treat a typed email as verified.

## Deployment and boundaries — ASSUMPTION - needs approval (A08, A21)

Serve the browser and API on one site through TLS reverse proxy; API and worker use the same release image with distinct process commands. Strict production origins replace broad CORS. Runtime secrets come from environment settings/secret manager, not the repository. Separate test, sandbox and production databases/provider credentials. Platform operator authentication uses a separate audience and no implicit tenant access.

Readiness checks validate database and essential dependencies without sensitive output; liveness reports process health only. Structured logs contain request IDs and operational metadata, not healthcare content. Proposed metrics: latency/errors, database failures, worker backlog, denied authorization, meter reconciliation and provider failures. Backups and restore tests need explicit RPO/RTO approval; no availability target is invented.

## Proposed repository layout — ASSUMPTION - needs approval (A08)

```text
client/src/{app,components,features,lib,styles}
server/src/{config,middleware,modules,integrations,workers}
server/tests/{unit,integration,security}
docs/
```

No application folders, executable scripts or vendor resources are created by this documentation draft.

## Phase 1 implementation record

Security-maintained React Router 7.18.4 replaces the proposed v6; declarative BrowserRouter routes remain the same. React stays on 18.3.1. Tailwind 4.3.3, Vitest 5.0.5 and Vite 6.4.5 are pinned. See the repository manifests/lockfile for every exact version. The version change follows actual npm advisories found during implementation, rather than an architectural rewrite.

Phase 1 uses MongoDB-backed shared rate buckets instead of introducing Redis solely for limiting. They are platform-scoped operational records without tenant_id (pre-authentication limits), hold hashes/counters/expiry, and expire through TTL. Tenant repositories scope domain reads/writes; narrow bootstrap/auth resolver methods and the outbox worker are explicit privileged boundaries. No SYSTEM_ADMIN HTTP surface, clinical module or paid integration is exposed in Phase 1.

SMTP contact verification and email invitations/recovery are implemented behind Mailer. Development uses a private local mailbox. Patient OTP uses that development mailbox only; production OTP fails closed pending the approved WhatsApp adapter in Phase 5. No SMS or WhatsApp delivery is claimed.
