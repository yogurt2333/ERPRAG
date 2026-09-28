# 06 — Returns use original evidence or quarantined stock

**What to build:** Support customer and supplier returns without guessing their financial meaning. The ERP searches candidate originating records, reverses a uniquely confirmed origin using its historical cost, or records ambiguous physical goods in quarantined stock until an operator resolves their source and condition.

**Blocked by:** 04 — Pack units, provisional products and managed expiry; 05 — Posted records are corrected by linked reversal.

**Status:** done

- [x] Return candidate search uses counterparty, product, quantity and date without silently choosing among ambiguous results.
- [x] A confirmed sales return restores stock at originating sales cost and adjusts receivable/refund and gross profit.
- [x] A confirmed purchase return adjusts stock and payable/payment consistently with the originating purchase.
- [x] An unresolved return creates quarantined stock and a follow-up but leaves available stock, valuation and settlement unchanged.
- [x] Quarantined goods can later become a linked return, return-to-sender outcome or confirmed loss.
- [x] Damaged or unsaleable return handling retains the physical and financial evidence chain.
- [x] Tests cover partial returns, repeated returns beyond original quantity and ambiguous origins.

## Verification

Implemented schema 6 linked partial sales/purchase returns, exact historical cost,
cumulative integer-cent allocation, separate refund balances and confirmed cash
refunds, durable quarantine/follow-ups and append-only resolution evidence.
Unknown-source loss remains unvalued. Origins with physical returns cannot be fully
reversed; settlements supporting paid refunds cannot be fully reversed.

Validation: `npm run typecheck` passed; `npm test` passed all 75 tests, including
11 return behavior tests in `test/erp-returns.test.ts`. Includes schema 5 migration,
restart idempotency, two-connection stale proposal rejection and injected rollback.
See `docs/lean-erp/RETURNS.md` for operations, monetary allocation and limitations.
Scope: local service; whole-quarantine resolution; Web/Hermes adapters and production
validation remain separate tickets. No live-model validation is claimed.