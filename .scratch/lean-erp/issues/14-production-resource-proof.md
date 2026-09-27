# 14 — Production deployment and 2-core, 2-GB resource proof

**What to build:** Package and run the complete MVP under the target resource constraint with public HTTPS, process isolation, health monitoring and evidence-based limits. The result either proves the supported operating envelope or records a failed constraint without weakening ledger safeguards.

**Blocked by:** 10 — Passkey-protected Web/PWA business fallback; 11 — Hermes WeChat tool integration; 12 — Evidence-bound gross-profit investigation; 13 — Off-server backup, recovery and cold archive.

**Status:** ready-for-agent

- [ ] Production configuration runs the ERP, SQLite, reverse proxy and restricted Hermes without ERPNext, external database or local model.
- [ ] Public exposure is limited to HTTPS Web/business surfaces; database, internal tools and Hermes administration are not generically exposed.
- [ ] Services have explicit memory/process limits, health checks, bounded logs and controlled restart behavior.
- [ ] Hermes production profile disables browser automation, local inference and nonbusiness execution capabilities.
- [ ] Measurements record idle and peak RSS, CPU, request latency, WAL growth, backup load and swap activity.
- [ ] The system completes 100 sequential draft/confirm loops and concurrent Web query, Hermes write and backup without duplicate posting or ledger mismatch.
- [ ] A 24–72-hour soak has no OOM or unbounded growth, or the ticket reports the 2-GB target as unproven with measured evidence and recommended capacity.
