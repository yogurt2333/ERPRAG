# 09 — Operation drafts, confirmation and idempotency

**What to build:** Put a safe confirmation protocol in front of ERP writes. Each operator conversation has one current structured draft showing business impact; corrections replace its version, a plain confirmation posts only the latest version, cancellation has no effect, and duplicate channel delivery can never repeat a write.

**Blocked by:** 03 — Receipts and payments allocate open obligations; 05 — Posted records are corrected by linked reversal; 06 — Returns use original evidence or quarantined stock; 07 — Stocktake, transfer, loss and concurrent stock protection.

**Status:** ready-for-agent

- [ ] Supported writes can be proposed as validated drafts without changing stock or money.
- [ ] Draft summaries expose counterparty, products, units, amounts, warehouse, stock impact, settlement impact and validation findings.
- [ ] Each conversation has at most one current draft and natural-language correction replaces its version.
- [ ] A plain confirmation resolves to the conversation's latest draft without requiring an operator-visible identifier.
- [ ] Confirmation posts once inside one transaction and records actor, channel, draft version and result references.
- [ ] Duplicate message/event delivery returns the original posting result.
- [ ] Cancellation, stale version, changed balances or failed validation cannot post the draft and return a controlled next action.
