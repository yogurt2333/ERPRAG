# 02 — Customer order and delivery create receivable and gross profit

**What to build:** Let an operator record customer demand before stock is available, then confirm actual delivery. Orders may expose backorders, while delivery atomically issues available stock, records sales cost, creates receivable and reports operating gross profit without any vehicle-stock stage.

**Blocked by:** 01 — Purchase receipt creates stock, cost and payable.

**Status:** done

- [x] A customer and sales order can be created through public business operations.
- [x] Ordered quantity above available stock is accepted as a backorder without changing on-hand stock or receivable.
- [x] Delivery confirmation issues stock, records the valuation cost, creates receivable and exposes gross profit together.
- [x] Delivery that would make stock negative is rejected with no partial effects.
- [x] An unfulfilled order can be changed or cancelled without ledger reversal.
- [x] The MVP exposes no loading, vehicle-stock or in-transit delivery state.
- [x] Behavior tests cover weighted-cost sale, equality at available stock, partial fulfillment and competing delivery attempts.

Verification (2026-09-27, local Windows, real temporary SQLite):

- `npm run typecheck`: passed.
- `npm test`: 41 passed / 0 failed: 13 ERP behavior tests (6 sales + 7 purchase), plus 28 existing audit-context tests.
- `npm run demo:erp`: passed. Synthetic purchase of 3 units for 100 cents, order for 5, delivery of 1 for 50 cents: cost 100/3 cents, gross profit 50/3 cents, remaining stock 2, backorder 4 and receivable 50 cents.
- Tests cover weighted-cost changes after partial sale, historical cost stability, exact-stock equality, fractional quantities, large amounts, zero revenue, revision conflicts, cancellation, repeated-product overdraw, malformed requests, durable idempotency and rollback after all writes.
- Two synchronized worker threads with independent SQLite connections compete for the last unit: one posts and the other receives insufficient_stock; no duplicate stock issue or receivable.

Implementation: `src/erp/service.ts`, `database.ts`, `exact.ts`, `demo.ts`.
Behavior tests: `test/erp-sales.test.ts`.
Usage, explicit actual delivery amounts and scope: `docs/lean-erp/SALES-DELIVERY.md`.
No settlement, HTTP/authentication, Hermes or production-readiness claim is included.
