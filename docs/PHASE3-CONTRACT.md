# Phase 3 implementation contract

The user authorized Phase 3 and explicitly approved these clinical fields: consultation complaint and assessment required for completion, optional plan; manually entered prescription medicine name, strength, dose, route, frequency and duration, with optional quantity/instructions. Test/service orders use manual names and optional clinical instructions. Prescription signing reauthenticates the assigned doctor using their current password. No catalogue, automated dose recommendation, legal e-signature certification, price or clinical safety engine is inferred.

## Scope and access

Only DOCTOR can claim, read/write their assigned consultation, create/edit/sign prescriptions, order tests/services and complete/amend their encounters. OWNER is not a clinician. PHARMACIST may read signed prescription projections; LAB may read order projections; PATIENT may read only their linked signed prescription. Draft prescriptions, raw consultation notes and unrelated patients are never exposed to those roles. Later-phase dispensing/result processing remains unavailable.

## Contracts (all /api/v1)

- POST /queue/claim-next `{}` + Idempotency-Key: claim earliest committed queued ticket. One active encounter per doctor; 409 when none is available or a different encounter is already active. Same retry key returns the original assignment.
- GET /doctor/workspace: current assigned encounter plus waiting count; GET /doctor/visits: newest 50 assigned encounters; GET /visits/:id: assigned encounter detail with patient, vitals, consultation, prescription revision list and orders.
- PATCH /visits/:id/consultation `{complaint,assessment,plan?,expected_version}`: save an active encounter note. Empty complaint/assessment may be stored as drafts but must be filled before completion. No raw-note access for reception/owner/patient.
- POST /visits/:id/prescriptions `{}` + Idempotency-Key: initial draft; POST /prescriptions/:id/revisions `{reason}` + Idempotency-Key: create a new draft from a signed revision while the assigned encounter is active. Signed source remains immutable.
- GET /prescriptions/:id: scoped doctor draft/signed detail; permitted pharmacy or linked patient signed projection only.
- POST /prescriptions/:id/lease `{expected_version}`: obtain 120-second editor lease, identified by doctor and authenticated session. POST /prescriptions/:id/lease/renew `{expected_version}`: renew only a still-active lease held by this session. Lease expiry never signs or deletes content; reacquire explicitly.
- PATCH /prescriptions/:id `{expected_version,items,notes?}`: active lease and optimistic version required; a successful content save renews inactivity expiry.
- POST /prescriptions/:id/discard `{expected_version,reason}` + Idempotency-Key: explicitly discard an unsigned draft under the active lease, retaining its content and audit trail; never discard a signed record.
- POST /prescriptions/:id/sign `{expected_version,password}` + Idempotency-Key: reauthenticate, require a valid lease and complete nonempty items, then record immutable content hash, signer and time. Passwords and derived password proofs are never stored in retry/audit records.
- POST /lab/orders `{visit_id,tests:[{name,instructions?}]}` + Idempotency-Key; POST /visits/:id/service-orders `{name,instructions?}` + Idempotency-Key: create ORDERED requests only. GET /lab/orders returns LAB order projections and DOCTOR's own orders, never consultation notes.
- POST /visits/:id/complete `{expected_version}` + Idempotency-Key: require saved complaint/assessment, no unsigned prescription drafts and current visit version; atomically finalize the note, complete the visit, append audit and create exactly one COMPLETED_CONSULTATION usage event. No prescription is mandatory for a no-medication consultation.
- POST /visits/:id/amendments `{complaint,assessment,plan?,reason,password}` + Idempotency-Key: after completion append an immutable note amendment; base note/completion/meter event remain unchanged. No post-completion prescription mutation or new prescribing implied.

## Concurrency and evidence

All mutations use tenant-scoped repositories and version/state guards. Claiming, saving notes, prescription lifecycle, orders and completion serialize through visit versions; editor leases additionally bind to session IDs. Unique indexes enforce one active encounter per doctor, one note per encounter, revision uniqueness, one draft per encounter, one active visit per doctor and one metering source per tenant. Content references, hashes and actor/resource IDs may be audited; clinical bodies/passwords must not be logged or put into live notices. Queue notices remain minimal IDs/state/version and are published only after commit. The standard memory-server replica-set suite must verify concurrent claims, expiry/stale versions, signed immutability, duplicate completion, rollback, tenant/ownership/RBAC boundaries and UI journeys. Phase 4 remains gated.

Completed note correction is append-only; no new prescribing is permitted after encounter completion. Clinical signing attempts count only failed password proofs toward the five-failure / 15-minute limit, so successful clinical work is not rate-limited as a failure. Retained older signed prescription revisions are history; later dispensing must select the latest applicable signed revision.
