# AuraCare

Multi-tenant clinic workspace. Phase 1 provides verified onboarding, owner TOTP, staff credentials and tenant isolation. Phase 2 adds patient registration/search, check-in, vitals history, a live queue and INR opening floats. Phase 3 adds the assigned doctor workspace, consultation notes, leased prescription drafts/signing/revisions, test/service orders and completion metering. Phase 4 adds FEFO stock/dispensing, doctor-approved generic swaps, lab sign-off/verification/release, INR invoices/manual receipts and owner-reviewed cash close.

## Development

Requires Node 24, npm 11 and Docker. From the repository root:

```sh
npm ci
npm run setup:local
npm run dev
```

`dev` starts a local MongoDB replica set, the API and Vite. Development verification/invitation/recovery messages are private JSON files in ignored `.local/mail/`; no real email is sent without SMTP configuration. Never expose that directory through HTTP or commit its contents. There are no seeded shared passwords: register a synthetic facility, verify its contact using the mailbox and enroll TOTP.

```sh
npm run build
npm run lint
npm test
npm run test:e2e
npm audit
```

The browser test uses the installed Chromium executable; set CHROMIUM_PATH for another location. `npm test` starts a disposable mongodb-memory-server replica set; unit/API tests isolate and delete their own test database. The runner never loads Atlas credentials. The first run obtains its MongoDB binary from the pinned Docker image; later runs reuse the local executable. Set MONGOMS_SYSTEM_BINARY to use an existing trusted executable. E2E uses synthetic records in its own disposable replica set. See [Setup](docs/Setup.md), [approved PRD](docs/PRD.md) and [Phase 1 review](docs/PHASE1-REVIEW.md).

The user reports Atlas and the MongoDB DNS issue tested and resolved; Phase 4 uses isolated test databases and does not alter that fix. Uploaded credentials are stored only in ignored local configuration, never repository files. The read-only `npm run check:atlas` command can retry after network access is fixed; `npm run dev:atlas` selects that local binding. Atlas-backed readiness and CodeRabbit review are pending; do not treat this as a production release.

`npm run db:ping` works from either the root or server directory, loads ignored `server/.env` and reports success or a credential-redacted connection error. The private environment file is not included in Git; recreate it through secure configuration on another machine. Run `npm test` to continue Phase 1 independently of Atlas.

See [Phase 2 review](docs/PHASE2-REVIEW.md) for approved fields, test evidence, account activation limits and cash deferrals. Browser tests now provision an isolated replica set and stop their own services; no running development app is reused.

See [Phase 3 review](docs/PHASE3-REVIEW.md) and [clinical contract](docs/PHASE3-CONTRACT.md). Prescription fields are manually entered; no drug catalogue or dosing/safety recommendation is supplied. Signing creates an authenticated immutable clinical revision, not an externally certified digital-signature service.

See [Phase 4 review](docs/PHASE4-REVIEW.md) and [operations contract](docs/PHASE4-CONTRACT.md). Manual receipts record previously collected payments; no gateway charge or automated clinical interpretation is performed. Phase 5 waits for NEXT PHASE.
