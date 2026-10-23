# Setup and development environment

The specification was approved; these instructions describe the actual Phase 1 implementation. Run commands from `/workspace/auracure-saas`. Use the existing isolated checkout; do not create a Git worktree unless explicitly requested.

## Install and start

Prerequisites: Node 24 (observed 24.19.0), npm 11 (observed 11.9.0), Docker daemon and Chromium for browser checks. The lockfile pins dependencies; use `npm ci`.

```sh
npm ci
npm run setup:local
npm run dev
```

`setup:local` creates private RSA signing keys, independent 32-byte TOTP encryption and PIN pepper keys, and development environment configuration under ignored `.local/`. It preserves existing files. Generated key paths are absolute. `dev` loads that configuration, starts the development replica set, then starts API port 3000 and Vite port 5173. External process environment overrides local development defaults. Keep startup in an execution session; do not assume processes survive snapshots. Ctrl-C stops application process groups; the reusable MongoDB container stays available.

MongoDB image is pinned by digest in scripts/local-db.ts. It is loopback-published only and explicitly for synthetic development data. Never use this unauthenticated local deployment for production. `npm run db:local` repeats replica-set readiness; `npm run db:indexes` applies additive indexes against the configured development database. No destructive index synchronization or production seed runs. No production data is permitted in tests.

For internal readiness, request GET /api/v1/health/ready through API port 3000 and verify `{data:{status:"ready"}}`. GET /api/v1/me without a token must return 401. `npm run test:e2e` proves the onboarding-to-staff functional workflow against running services; a listening port alone is not validation. These loopback endpoints are for local checks, not shareable preview links.

## Development mailbox

Without SMTP_URL, messages go to `.local/mail/` with directory mode 0700 and file mode 0600. Read only the synthetic account message you need. Contact challenges contain a verification proof; invitation/recovery links are single-use. The browser test reads this mailbox automatically. No real messages are sent in this mode. Production refuses startup without SMTP and HTTPS; SMTP requires TLS certificate verification.

## Runtime configuration

All implemented keys are documented without values in `.env.example`: MONGODB_URI; APP_ORIGIN; PORT; JWT_PRIVATE_KEY_FILE; JWT_PUBLIC_KEY_FILE; MFA_ENCRYPTION_KEY_FILE; PIN_PEPPER_FILE; JWT_ISSUER; JWT_AUDIENCE; MAIL_DIR; MAIL_FROM; SMTP_URL; NODE_ENV. CHROMIUM_PATH selects the browser binary; TEST_MONGODB_URI selects a test server, but each test run uses an isolated auracare_test_* database. Never point tests at production.

Signing/encryption/PIN keys must be actual protected local key material or a separately implemented managed-crypto integration. HTTPS proxy placeholders cannot sign JWTs or authenticate a native MongoDB driver. Do not print environment values, connection URIs, mailbox contents or credential files when diagnosing configuration. No credentials belong in VITE_* variables.

Production must separately configure safe ingress/origins, scoped Atlas credentials/networking, managed key storage, SMTP, backup/restore and approved data policies. Redis is not required for Phase 1: MongoDB stores shared rate-limit buckets. Payment, storage, WhatsApp/SMS and prices remain unconfigured; no real charge, PDF handling or WhatsApp delivery is enabled.

## Atlas credentials and outstanding connectivity

The supplied upload was parsed without printing values and its URI stored in ignored, mode-0600 `.local/atlas.env`. `npm run check:atlas` makes read-only authenticated ping/hello attempts using it and redacts failure output. The current attempts fail at SRV discovery with ECONNREFUSED, before authentication. Credentials, Atlas access-list status and transactions on Atlas are therefore unverified. Do not weaken TLS or add unrestricted Atlas access to work around this.

Resolve supported SRV DNS/native MongoDB network routing to the cluster, then rerun check:atlas before starting `npm run dev:atlas`. That command selects the uploaded binding and uses a dedicated auracare_phase1_dev database unless one was explicitly supplied. Tests default to the local replica set; do not claim local passes validate Atlas. No writes to Atlas have succeeded or been claimed.

## Checks

```sh
npm run build
npm run lint
npm test
npm run test:e2e
npm audit
```

CI-style unit/API tests require the local replica set or explicit test connection. Browser tests require Chromium and run against development services using synthetic contacts. Fresh-task restoration/publication is not verified by this task; saved environment instructions are separate from running commands and publishing the environment.

## Applied DNS and standard connection fallback

The application and Atlas probe now import a shared DNS initializer that forces `8.8.8.8` and `1.1.1.1` before SRV discovery. The actual connection module is `server/src/db.ts`. These public resolvers still return ECONNREFUSED here; forcing them cannot override blocked DNS traffic. This global resolver choice can also conflict with private/VPN DNS and should be revisited if such networking is introduced. Node `dns.lookup` uses OS resolution separately.

Using the supplied seed hosts, the active local Atlas binding is now a standard `mongodb://` seed-list URI with `authSource=admin`, `tls=true` and the existing credentials. The original SRV binding is preserved separately in `.local/atlas-srv.env`; both files are ignored and private. Replica-set name is omitted for driver discovery, not guessed. Standard URI testing fails with EAI_AGAIN on all three hosts even in the approved run; no password/Atlas access validation succeeded. A standard string avoids SRV/TXT lookup but still needs hostname resolution and native MongoDB connectivity.

To test on your own machine, supply that machine's protected configuration/key paths and SMTP/development-mail settings, load them through your environment, and run the server there. This cloud task cannot operate a terminal on your machine or compare that result automatically. Keep Atlas access limited to the actual connecting client IP; opening all IPs does not fix DNS.

CodeRabbit CLI installation is blocked by a proxy HTTP 403 for cli.coderabbit.ai. Its domain is saved in the environment network draft; the CLI must be installed and authenticated before a review can run. No external review result exists yet.
