# 08 — Durable follow-ups, reminders and summaries

**What to build:** Give operators one durable queue for incomplete business work and surface it without notification spam. Workflow gaps, incomplete products, unresolved returns, overdue obligations and managed expiry produce actionable follow-ups, immediate notices, a daily digest and a weekly business summary.

**Blocked by:** 04 — Pack units, provisional products and managed expiry; 06 — Returns use original evidence or quarantined stock; 07 — Stocktake, transfer, loss and concurrent stock protection.

**Status:** done

- [x] Follow-ups persist independently of Hermes sessions and link to their business evidence.
- [x] Operators can resolve, defer or ignore a follow-up with a reason and audit history.
- [x] New actionable gaps produce one immediate notification event.
- [x] Unchanged follow-ups are not repeatedly sent during the same day.
- [x] Daily digest covers outstanding gaps, overdue settlement, delivery without receipt, expiry and stock exceptions.
- [x] Weekly summary covers purchase, sales, gross profit, collection, debt, loss, expiry and follow-up trends using deterministic aggregates.
- [x] Scheduler tests use a controllable clock and deterministic delivery adapter rather than real delays or WeChat.

## Verification

Implemented SQLite v8 durable follow-ups/history/outbox, confirmed decisions, atomic source reconciliation, clock-driven daily/weekly scheduling and retryable delivery adapter. See docs/lean-erp/FOLLOWUPS.md for timing, evidence and at-least-once delivery boundaries. Eight behavioral tests cover rollback, restart, migration, all digest sources, exact weekly values and cross-week corrections. Real WeChat delivery remains outside this ticket.

Validation (2026-09-28): npm run typecheck passed; npm test passed 91/91 (including 8 new follow-up behavior tests); git diff --check passed. Existing tickets 06/07 working-tree changes were preserved.
