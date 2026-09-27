# 07 — Stocktake, transfer, loss and concurrent stock protection

**What to build:** Let operators reconcile and move physical stock without overwriting history. Stocktake shows differences before confirmation, transfer moves quantity atomically between warehouses, loss is separately visible, and competing issues cannot oversell the same stock.

**Blocked by:** 05 — Posted records are corrected by linked reversal.

**Status:** ready-for-agent

- [ ] Stocktake records physical count and displays the ledger difference before any adjustment.
- [ ] The operator can restore a known missing source transaction instead of using a generic adjustment.
- [ ] An irreducible difference posts a reasoned stock adjustment without rewriting prior entries.
- [ ] Warehouse transfer atomically decreases the source and increases the destination without changing total stock or value.
- [ ] Confirmed loss reduces stock and is reported separately from sales cost.
- [ ] Two competing stock-issuing operations cannot produce negative inventory.
- [ ] SQLite busy/lock outcomes are controlled, leave no partial state and are observable to the caller.
