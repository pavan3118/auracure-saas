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

## Phase 1 fallback authorized by the user

Atlas is verified on the user's own machine according to their report; this is not an independent cloud verification. Phase 1 development and tests may continue without Atlas. Do not repeatedly retry Atlas while cloud DNS/networking remains unavailable.

`npm run db:ping` is now available from root or server. It loads ignored `server/.env`, performs read-only ping and outputs SUCCESS or a credential-redacted exact driver error with nested seed errors. Existing bindings were copied into a private server/.env (0600); existing user files are preserved. The latest run reports getaddrinfo EAI_AGAIN for all three supplied seed hosts, before authentication. The generic driver access-list suggestion is not evidence of an Atlas whitelist failure.

Default `npm test` now starts mongodb-memory-server as a disposable replica set. It injects an ephemeral local TEST_MONGODB_URI into the test subprocess and never loads server/.env or Atlas credentials. `npm run setup:test-db` prepares the executable from the pinned MongoDB Docker image without starting a database container. The binary is retained under ignored .local/mongodb/bin and its actual version is passed to memory-server. A trusted MONGOMS_SYSTEM_BINARY can be provided instead. No package postinstall binary download is needed; TLS, image digest verification and memory-server version checks remain enabled. Memory-server stops and removes its temporary data on completion. Production server behavior still uses the normal Mongoose driver.

The environment draft now additionally includes *.mongodb.net as explicitly requested, preserving CodeRabbit and existing Atlas rules. This is a saved draft, not evidence of active egress, native TCP 27017 reachability or restart. The available configuration API does not expose port controls, unrestricted-access toggles or sandbox restart. Review/save settings in the UI and publish when ready; restart/recreate and new-task launch are user actions. Atlas console IP settings cannot be changed from this session. No 0.0.0.0/0 rule was added.

## Phase 2 runtime changes

Socket.io runs on the same API HTTP server; local Vite proxies /socket.io with WebSocket support. Deployments must route that path and set the exact APP_ORIGIN. No new secret is required. New patient/visit/vitals/cash/retry indexes are created additively by the existing database initialization. Single-process live delivery is tested; production multi-instance fan-out requires the shared adapter work.

`npm run test:e2e` now starts its own disposable memory-server replica set and supervised API/frontend, with SMTP disabled and synthetic mailbox delivery. It refuses to reuse an existing application on port 5173; stop your own dev instance first or use a separate environment. Test startup does not read Atlas credentials into its database connection. Graceful shutdown stops owned app process groups before the disposable replica set. Test screenshots are ignored synthetic artifacts under .local/.
