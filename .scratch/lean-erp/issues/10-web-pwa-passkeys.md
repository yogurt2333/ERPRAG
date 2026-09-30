# 10 — Passkey-protected Web/PWA business fallback

**What to build:** Provide a responsive deterministic business interface that remains usable without Hermes or a model. One or two equal-privilege operators enroll and sign in with passkeys, then perform the confirmed daily ERP operations and inspect stock, settlement, follow-ups and audit history.

**Blocked by:** 09 — Operation drafts, confirmation and idempotency.

**Status:** done

- [x] There is no public self-service registration; first enrollment uses a short-lived one-time bootstrap.
- [x] Passkey registration and authentication verify challenge, expected origin, relying-party identity and user verification.
- [x] Server-side sessions use a host-only Secure, HttpOnly, SameSite=Strict cookie and expire/revoke predictably.
- [x] Backup credential or one-time offline recovery codes prevent a single-device lockout.
- [x] Recent passkey verification is required for credential administration and sensitive retention/recovery actions.
- [x] The responsive UI can complete product, purchase, sale, settlement, stock-control, return and follow-up workflows through operation drafts.
- [x] Web contract tests cover authentication, authorization, request validation, CSRF/origin defenses and business-boundary mapping without duplicating ledger algorithms.

## Verification — 2026-09-28

- Schema v10; SimpleWebAuthn verification, durable hashed sessions/grants/recovery codes and security audit.
- `npm run typecheck` passed; `npm run test:web` 8/8; `npm test` 110/110; `git diff --check` passed.
- Real CBOR/P-256 contract harness covers invalid origin/RP/challenge/UV/signature, challenge replay, expiry,
  credential revocation, one-time recovery, recent authentication, simultaneous invitations and actor isolation.
- Chromium virtual authenticator passed actual enrollment/login and draft UI workflows for product, purchase,
  sale, settlement, return, loss and follow-ups, plus 390px layout and offline refusal.
- Credential/recovery administration uses a five-minute recent-authentication guard. Offline recovery only
  permits replacement Passkey enrollment; business access follows verified registration. Retention/restore
  execution remains ticket 13: no public execution endpoint is exposed here.
- See `docs/lean-erp/WEB-PASSKEYS.md` for HTTPS startup, bootstrap, limits and reproduction.
- No real-device compatibility, production HTTPS deployment, Hermes integration or resource-capacity claim.
