# 06 — Returns use original evidence or quarantined stock

**What to build:** Support customer and supplier returns without guessing their financial meaning. The ERP searches candidate originating records, reverses a uniquely confirmed origin using its historical cost, or records ambiguous physical goods in quarantined stock until an operator resolves their source and condition.

**Blocked by:** 04 — Pack units, provisional products and managed expiry; 05 — Posted records are corrected by linked reversal.

**Status:** ready-for-agent

- [ ] Return candidate search uses counterparty, product, quantity and date without silently choosing among ambiguous results.
- [ ] A confirmed sales return restores stock at originating sales cost and adjusts receivable/refund and gross profit.
- [ ] A confirmed purchase return adjusts stock and payable/payment consistently with the originating purchase.
- [ ] An unresolved return creates quarantined stock and a follow-up but leaves available stock, valuation and settlement unchanged.
- [ ] Quarantined goods can later become a linked return, return-to-sender outcome or confirmed loss.
- [ ] Damaged or unsaleable return handling retains the physical and financial evidence chain.
- [ ] Tests cover partial returns, repeated returns beyond original quantity and ambiguous origins.
