# 10 — Passkey-protected Web/PWA business fallback

**What to build:** Provide a responsive deterministic business interface that remains usable without Hermes or a model. One or two equal-privilege operators enroll and sign in with passkeys, then perform the confirmed daily ERP operations and inspect stock, settlement, follow-ups and audit history.

**Blocked by:** 09 — Operation drafts, confirmation and idempotency.

**Status:** ready-for-agent

- [ ] There is no public self-service registration; first enrollment uses a short-lived one-time bootstrap.
- [ ] Passkey registration and authentication verify challenge, expected origin, relying-party identity and user verification.
- [ ] Server-side sessions use a host-only Secure, HttpOnly, SameSite=Strict cookie and expire/revoke predictably.
- [ ] Backup credential or one-time offline recovery codes prevent a single-device lockout.
- [ ] Recent passkey verification is required for credential administration and sensitive retention/recovery actions.
- [ ] The responsive UI can complete product, purchase, sale, settlement, stock-control, return and follow-up workflows through operation drafts.
- [ ] Web contract tests cover authentication, authorization, request validation, CSRF/origin defenses and business-boundary mapping without duplicating ledger algorithms.
