# AuraCare working rules

- Read docs/PRD.md, docs/Authentication & Security.md and docs/PHASE1-REVIEW.md before changing behavior. PRD baseline and explicit user decisions override original assumptions.
- Keep the six tenant roles exact. SYSTEM_ADMIN is platform-only and has no tenant API bypass.
- Derive tenant scope from verified JWTs. Use scoped repositories; do not export raw domain models or accept client tenant_id fields. Public auth/bootstrap routes must use their documented proof boundary.
- Passwords/PINs are hashed; TOTP secrets are encrypted. Never log/upload secrets, clinical details or the uploaded credential file. .local/ and .env files stay ignored.
- Add meaningful role, ownership, validation and cross-tenant tests for new resources. Exercise transactions/concurrency against a replica set. Do not disable assertions or describe skipped tests as passes.
- Run npm run build, npm run lint and npm test for phase gates; use npm run test:e2e for relevant user journeys. Report real counts and external blockers.
- Stop for phase review; do not start the next phase until the user requests NEXT PHASE.
- Use this existing isolated checkout. Do not create a worktree unless explicitly requested.
