# 04 — Pack units, provisional products and managed expiry

**What to build:** Reduce first-use product setup without weakening stock meaning. Operators can transact with versioned pack units, create a provisional product from only a name and stock unit, and manage shelf life from the earliest production date while incomplete information remains visible as durable work.

**Blocked by:** 01 — Purchase receipt creates stock, cost and payable.

**Status:** ready-for-agent

- [ ] Purchase input can use an exact pack-unit conversion while stock and valuation remain in the stock unit.
- [ ] Changing a future pack conversion does not reinterpret historical transactions.
- [ ] An unknown product can be created provisionally with only name and stock unit and used in a receipt.
- [ ] Missing optional product data creates a durable follow-up rather than inferred values.
- [ ] Product aliases, specification and optional barcode can be added without duplicating the product.
- [ ] Shelf-life days plus earliest managed production date derive a managed expiry date.
- [ ] Queries and summaries label managed expiry as an operational estimate, not an exact unit-level fact.
