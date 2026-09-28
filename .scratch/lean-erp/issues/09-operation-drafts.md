# 09 — Operation drafts, confirmation and idempotency

**What to build:** Put a safe confirmation protocol in front of ERP writes. Each operator conversation has one current structured draft showing business impact; corrections replace its version, a plain confirmation posts only the latest version, cancellation has no effect, and duplicate channel delivery can never repeat a write.

**Blocked by:** 03 — Receipts and payments allocate open obligations; 05 — Posted records are corrected by linked reversal; 06 — Returns use original evidence or quarantined stock; 07 — Stocktake, transfer, loss and concurrent stock protection.

**Status:** done

- [x] Supported writes can be proposed as validated drafts without changing stock or money.
- [x] Draft summaries expose counterparty, products, units, amounts, warehouse, stock impact, settlement impact and validation findings.
- [x] Each conversation has at most one current draft and natural-language correction replaces its version.
- [x] A plain confirmation resolves to the conversation's latest draft without requiring an operator-visible identifier.
- [x] Confirmation posts once inside one transaction and records actor, channel, draft version and result references.
- [x] Duplicate message/event delivery returns the original posting result.
- [x] Cancellation, stale version, changed balances or failed validation cannot post the draft and return a controlled next action.

## Verification — 2026-09-28

- SQLite schema v9 and `ErpService.handleDraft` implement durable proposal/correction/confirmation/cancellation and event replay.
- `npm run typecheck`: passed. `npm test`: 102/102 passed, including 11 draft protocol behavior tests. `git diff --check`: passed.
- Real SQLite tests include independent worker connections confirming the same event, failure before outer commit, restart and v8 migration, changed business state, and UTC-date invalidation.
- Summary uses deterministic rollback-only business execution; writes and draft/event audit commit together.
- Natural-language corrections are accepted as structured replacements from the future adapter. Actual Hermes/WeChat parsing, authentication and message delivery remain outside this ticket.
- See `docs/lean-erp/DRAFTS.md` for operation names, scope, conservative global-state invalidation and runtime limits.
