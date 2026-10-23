# Phase 1 review handoff

Phase 1 is implemented and validated locally. The user reports Atlas verified on their own machine and authorizes cloud development/tests without Atlas. **The requested CodeRabbit review remains blocked; no external review sign-off is claimed.** No Phase 2 clinical/reception feature has been started. This document records the original local validation checkpoint. Git history and the remote record subsequent commits/pushes; no PR, deployment or environment publication is claimed here.

## Delivered behavior and traceability

| Requirement | Implementation |
| --- | --- |
| B01–B03, U02, A01/A04 | Five-step Screen 00; out-of-band contact verification; unique normalized subdomain; atomic Tenant/Owner/audit creation; enrollment-only JWT after commit; mandatory TOTP before business access |
| B03–B08, U04, A02/A05/A20 | Six-role credential model; staff password login; doctor invitation/temporary-password change gate; owner TOTP/recovery codes; hashed/peppered lab sign-off PIN at provisioning; patient portal PIN and development-only OTP exchange; 15-minute single-use recovery |
| B10, U03, A07 | Verified JWT tenant scope; purpose/audience/version checks; tenant-scoped repositories; centrally declared route roles; generic cross-tenant 404; strict Zod schemas and no client tenant_id writes |
| Screen 07, A02 | Staff directory, email invitation/acceptance, same-role pharmacist/lab requests with OWNER approval, role/status changes with fresh MFA, session revocation, final-owner protection, licence evidence recording and sanitized audit viewer |
| A08/A09/A21 | npm TypeScript monorepo, navy responsive interface, build/lint/format scripts, local replica-set startup, protected development mailbox, isolated integration tests and Chromium end-to-end journey |

The credential workflow accepts doctor invitations through choosing a permanent password before activation; it does not email shared passwords. Receptionists use the PRD's strong-password alternative. Patient accounts are not created through staff invitations; registration at check-in belongs to Phase 2. No clinical data or real patient records are seeded.

## Validation evidence

- `npm ci --no-audit --no-fund`: lockfile installation succeeded.
- `npm run setup:local`: repeatable; existing keys/configuration retained.
- `npm run db:indexes`: additive index creation succeeded on the local replica set.
- `npm run build`: client TypeScript/Vite and server TypeScript builds passed.
- `npm run lint`: client, server, tests, development scripts and browser tests passed.
- `npm run format:check`: all matched source files passed after correction.
- API integration suite: **43 passed**, real MongoDB replica set, isolated per-run `auracare_test_*` database; no skipped tests in the successful run.
- Cryptographic unit suite: **6 passed** (49 total server tests across 2 passing suites).
- Client UI suite: **9 passed**.
- Chromium E2E: **1 passed**, real owner onboarding → contact proof → TOTP → saved recovery codes → Screen 07 invite → separate doctor browser session → reload/refresh → sign-out. Desktop/mobile screenshots inspected locally.
- `npm audit --audit-level=moderate`: **zero vulnerabilities reported** by the registry at verification time; this is not a full security certification.
- Runtime smoke checks: database readiness 200, unauthenticated identity 401, frontend response 200.
- Credential scan: uploaded credential values absent from all Git-visible files; local credential file mode 0600. No credential values were printed.

Regression coverage includes registration rollback and simultaneous idempotent retries, subdomain races, MFA/TOTP/recovery-code replay, refresh rotation/reuse, credential/session revocation, six-role access boundaries, cross-tenant reads/updates/invitation approval/licence verification, invitation takeover denial, concurrent recovery issuance, concurrent final-owner demotions, expired grants, invalid JSON correlation IDs and request size limits.

## Internal review findings resolved

1. Registration retries initially needed durable request binding: bootstrap records now bind key + request hash to the committed tenant/owner; raw JWTs are not cached. Concurrent identical retries return the same identities.
2. Simultaneous recovery requests could leave two valid links: per-user challenge-version writes serialize issuance before replacing outstanding grants.
3. Limited staff could invalidate an existing owner invitation: same-role requests now conflict with an existing active invitation instead of replacing it.
4. Final-owner updates now serialize through a tenant governance counter, with a concurrent-demotion regression test.
5. Browser select labels needed explicit accessible names; the real-browser test caught this and passes after correction.
6. Parser failures needed a correlation ID: request IDs/no-store headers now precede JSON parsing, and oversized requests receive 413 rather than an opaque 500.
7. Audited initial package pins contained published advisories: maintained versions were selected, builds/tests rerun and the final dependency audit is clean.

This is an internal review record. It is **not** a CodeRabbit review.

## Explicit changes or limits relative to the approved proposal

- React Router v7.18.4 replaces proposed v6 for published security fixes. React remains v18; Tailwind v4, Vitest v5 and maintained package pins are in the lockfile. The declarative routing approach is unchanged.
- MongoDB-backed shared counters avoid introducing Redis solely for Phase 1 limiting. Platform pre-auth rate buckets contain hashes/counts/TTL and are an explicit non-tenant operational collection.
- Registration replay retention follows the 15-minute verified bootstrap record, not the proposed generic 24-hour future resource idempotency policy. After enrollment/expiry, sign in to resume.
- Staff invitation identities are email-based in Phase 1. Alternative mobile/employee/licence login identifiers are not provisioned by this UI yet.
- Lab PIN reset, receptionist shift-PIN/device policy and operator-assisted lost-MFA recovery are not exposed. Existing controls fail closed; no MFA bypass is added.
- No SYSTEM_ADMIN HTTP surface or patient-record/clinical/financial access is exposed. The six business roles remain exact; platform APIs require separate detailed implementation.
- Directory/invitation/audit reads are bounded to 100 newest rows. Cursor pagination and large-directory UX remain outstanding before production scale.
- SMTP delivery is configurable but unverified without a provider; default development mail never sends externally. Patient OTP uses development mail only and returns 503 in production until the Phase 5 WhatsApp integration is implemented.
- Development database and keys are for synthetic local use. Production ingress, secrets management, compliance, backup/restore and rollout gates are not completed by Phase 1.

## External blockers and required actions

**Atlas:** supplied credentials were parsed into ignored local configuration and used for read-only ping/discovery attempts. SRV lookup `_mongodb._tcp.auracare-cluster.wfscyk1.mongodb.net` fails with ECONNREFUSED before authentication, including the retry outside the filesystem sandbox. No Atlas credential validity, access-list permission, transaction or application write is verified. Resolve supported DNS/native MongoDB connectivity, then run `npm run check:atlas`. Once successful, validate transactions and the app using the dedicated development database before claiming Atlas readiness. Do not disable TLS or open Atlas to all IPs.

**CodeRabbit:** the CodeRabbit review skill became available in the follow-up. Its required CLI is missing. Downloading the official installer from `https://cli.coderabbit.ai/install.sh` failed at the environment proxy (`CONNECT tunnel failed, response 403`). The installer was not executed, authentication could not be initiated and no review or source upload occurred. `cli.coderabbit.ai` was added to the saved network draft, preserving the Atlas rule and package-manager presets. Allow access to the installer, then install the CLI and complete `coderabbit auth login --agent` before running the review. This is a prerequisite failure, not a review result; the number of CodeRabbit issues is unknown.

**Reusable environment:** install_script and start_skill were saved as a configuration draft, plus the narrowly scoped network addition `*.wfscyk1.mongodb.net`. Existing package-manager network presets were preserved. Saving is confirmed, but does not apply networking, run scripts or publish. Review and save changes in environment settings, then publish when ready; publication and fresh-task restoration remain unverified.

## Phase gate

Stop here for Phase 1 review. Resolve the Atlas/CodeRabbit blockers and review the recorded deviations before accepting the full handoff. Do not start Phase 2 without the user's `NEXT PHASE` instruction.

## DNS and standard-URI follow-up

At the user's request, `server/src/config/dns.ts` calls `dns.setServers(["8.8.8.8", "1.1.1.1"])` before database connection. Both the real database module (`server/src/db.ts`, not the suggested nonexistent `server/src/config/db.ts`) and the standalone Atlas probe import it first. Node 24's promise resolver was checked and uses the same configured servers. This setting affects `dns.resolve*` queries; Node's `dns.lookup`/OS address resolution is separate.

The forced-resolver SRV probe still failed with `ECONNREFUSED querySrv`. A standard non-SRV URI was then constructed from the three user-supplied `ac-ptbtkip-shard-00-00/01/02.wfscyk1.mongodb.net:27017` seed hosts, existing uploaded credentials, `authSource=admin`, TLS, retryable writes and majority writes. The original SRV binding is preserved in ignored `.local/atlas-srv.env`; active ignored `.local/atlas.env` now uses the standard seed list. No hostnames or replica-set name were invented. Replica-set name is omitted until the driver can discover it from a successful hello response.

The standard connection failed with MongooseServerSelectionError; every seed reported MongoNetworkError with EAI_AGAIN during hostname resolution, including the approved retry outside the filesystem sandbox. Authentication, seed validity, Atlas network access and transaction support remain unverified. The cloud checks do not test the user's separate terminal. Atlas console access is unavailable here; no Atlas IP access rule was changed. Opening all IPs does not solve DNS discovery.

Post-change server build, lint, formatting and all **49 server tests** passed. Existing UI/browser results above are from the preceding Phase 1 validation; these suites were not rerun for this server-only DNS change. The CodeRabbit installer domain addition is saved as a draft only; review/save the environment settings, then publish when ready. No publication or networking activation is claimed.

## User-authorized Atlas-independent Phase 1 continuation

The user reports Atlas working from their own terminal and authorized continuing Phase 1 with mongodb-memory-server. Atlas connectivity is no longer a blocker to this local development workflow; external CodeRabbit review is still outstanding. There is no independent cloud Atlas validation claim.

Added root/server db:ping scripts, a private ignored server/.env using existing credentials, credential-redacted error reporting, and the default disposable memory-server replica-set test runner. The latest ping still reports getaddrinfo EAI_AGAIN for the three user-supplied seed hosts. The broader *.mongodb.net rule was saved to the environment draft as requested; no restart, publication, port change or Atlas IP access-list modification occurred.

Fallback verification: 9 UI tests and 49 server tests passed with the memory-server-managed local replica set. The same transaction, permission and cross-tenant cases ran; no assertions were disabled or MongoDB operations mocked. The MongoDB executable comes from the existing digest-pinned trusted Docker image and is reused locally; no Atlas request is needed for tests. Later phases still require NEXT PHASE.
