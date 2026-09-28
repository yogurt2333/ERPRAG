# 07 — Stocktake, transfer, loss and concurrent stock protection

**What to build:** Let operators reconcile and move physical stock without overwriting history. Stocktake shows differences before confirmation, transfer moves quantity atomically between warehouses, loss is separately visible, and competing issues cannot oversell the same stock.

**Blocked by:** 05 — Posted records are corrected by linked reversal.

**Status:** done

- [x] Stocktake records physical count and displays the ledger difference before any adjustment.
- [x] The operator can restore a known missing source transaction instead of using a generic adjustment.
- [x] An irreducible difference posts a reasoned stock adjustment without rewriting prior entries.
- [x] Warehouse transfer atomically decreases the source and increases the destination without changing total stock or value.
- [x] Confirmed loss reduces stock and is reported separately from sales cost.
- [x] Two competing stock-issuing operations cannot produce negative inventory.
- [x] SQLite busy/lock outcomes are controlled, leave no partial state and are observable to the caller.

## Verification

Implemented schema 7 with immutable stocktake comparisons, source-operation reconciliation,
reasoned adjustments, exact atomic transfers and separately reported losses.
See docs/lean-erp/INVENTORY.md and test/erp-inventory.test.ts.

2026-09-28: npm run typecheck passed; npm test passed 83/83, including 55 ERP tests.
Eight new inventory behavior tests cover rollback, restart/idempotency, v6 migration,
a real held-writer busy outcome and simultaneous worker transfer/loss contention.
Existing concurrent delivery tests also pass. No live model or production-load claim.
