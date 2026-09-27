# 04 — Pack units, provisional products and managed expiry

**What to build:** Reduce first-use product setup without weakening stock meaning. Operators can transact with versioned pack units, create a provisional product from only a name and stock unit, and manage shelf life from the earliest production date while incomplete information remains visible as durable work.

**Blocked by:** 01 — Purchase receipt creates stock, cost and payable.

**Status:** done

- [x] Purchase input can use an exact pack-unit conversion while stock and valuation remain in the stock unit.
- [x] Changing a future pack conversion does not reinterpret historical transactions.
- [x] An unknown product can be created provisionally with only name and stock unit and used in a receipt.
- [x] Missing optional product data creates a durable follow-up rather than inferred values.
- [x] Product aliases, specification and optional barcode can be added without duplicating the product.
- [x] Shelf-life days plus earliest managed production date derive a managed expiry date.
- [x] Queries and summaries label managed expiry as an operational estimate, not an exact unit-level fact.

Verification (2026-09-28, local Windows, real temporary SQLite, synthetic records):

- `npm run typecheck`: passed.
- `npm test`: 57 passed / 0 failed (29 ERP tests, 28 audit-context tests).
- `npm run demo:erp`: passed.
- Six new product behavior tests cover exact rational packs, immutable receipt snapshots,
  revision conflicts, durable follow-ups, leap/year boundaries, invalid input, rollback and schema 3 migration.
- Contract and limits: `docs/lean-erp/PRODUCT-PACKS-EXPIRY.md`.
  Expiry summaries count receipt lines, not remaining batch stock. Reminder delivery and batch fulfillment remain later work.
