# 08 — Durable follow-ups, reminders and summaries

**What to build:** Give operators one durable queue for incomplete business work and surface it without notification spam. Workflow gaps, incomplete products, unresolved returns, overdue obligations and managed expiry produce actionable follow-ups, immediate notices, a daily digest and a weekly business summary.

**Blocked by:** 04 — Pack units, provisional products and managed expiry; 06 — Returns use original evidence or quarantined stock; 07 — Stocktake, transfer, loss and concurrent stock protection.

**Status:** ready-for-agent

- [ ] Follow-ups persist independently of Hermes sessions and link to their business evidence.
- [ ] Operators can resolve, defer or ignore a follow-up with a reason and audit history.
- [ ] New actionable gaps produce one immediate notification event.
- [ ] Unchanged follow-ups are not repeatedly sent during the same day.
- [ ] Daily digest covers outstanding gaps, overdue settlement, delivery without receipt, expiry and stock exceptions.
- [ ] Weekly summary covers purchase, sales, gross profit, collection, debt, loss, expiry and follow-up trends using deterministic aggregates.
- [ ] Scheduler tests use a controllable clock and deterministic delivery adapter rather than real delays or WeChat.
