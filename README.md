# AuraCare

Multi-tenant clinic workspace. Phase 1 provides verified facility onboarding, owner TOTP, staff credential lifecycle, tenant-scoped access and Screen 07 staff management. Reception, clinical, inventory, billing and patient-record workflows are later phases.

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

The browser test uses the installed Chromium executable; set CHROMIUM_PATH for another location. Unit/API tests isolate and delete their own test database. E2E uses synthetic records in the development database and retains them for review. See [Setup](docs/Setup.md), [approved PRD](docs/PRD.md) and [Phase 1 review](docs/PHASE1-REVIEW.md).

Atlas connection is blocked by SRV DNS discovery in this environment. Uploaded credentials are stored only in ignored local configuration, never repository files. The read-only `npm run check:atlas` command can retry after network access is fixed; `npm run dev:atlas` selects that local binding. Atlas-backed readiness and CodeRabbit review are pending; do not treat this as a production release.
