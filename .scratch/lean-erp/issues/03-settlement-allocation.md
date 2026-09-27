# 03 — Receipts and payments allocate open obligations

**What to build:** Allow operators to settle customer receivables and supplier payables with or without naming the originating documents. The ERP proposes earliest-due allocation, supports partial settlement and preserves excess as an advance or prepayment. A delivery and receipt described together post atomically but remain separate linked ledger entries.

**Blocked by:** 01 — Purchase receipt creates stock, cost and payable; 02 — Customer order and delivery create receivable and gross profit.

**Status:** done

- [x] Customer receipts and supplier payments can target explicit open obligations.
- [x] Unspecified settlement produces a reviewable earliest-due allocation before posting.
- [x] Partial settlement leaves the correct open balance.
- [x] Excess receipt/payment becomes an explicit customer advance or supplier prepayment.
- [x] Operator allocation overrides are validated and preserved in audit history.
- [x] Combined delivery and receipt either post both linked entries or post neither.
- [x] Duplicate settlement confirmation returns the original result without changing balances again.

Verification (2026-09-27, local Windows, real temporary SQLite, synthetic records):

- `npm run typecheck`: passed.
- `npm test`: 51 passed / 0 failed (23 ERP tests including 10 new settlement tests; 28 existing audit-context tests).
- `npm run demo:erp`: passed; receivable 50 cents minus collection 30 leaves 20; payable 100 with payment 120 leaves prepayment 20.
- Both settlement directions cover earliest-due proposals, explicit overrides, partial/excess amounts, party isolation and durable idempotency.
- Competing connections allocating the same debt produce one posted settlement and one conflict.
- Injected failure after all writes leaves no delivery, settlement, allocation, stock issue, audit or retry key from the failed operation.
- Schema 2 databases upgrade in place while preserving purchase and sales documents and obligations.

Implementation: `src/erp/service.ts`, `database.ts`, `demo.ts`; tests: `test/erp-settlement.test.ts`.
Contract and limits: `docs/lean-erp/SETTLEMENT.md`. Missing due dates use explicitly labeled UTC posting dates.
Combined cash-on-delivery settles the current delivery; older debts require a separate explicit allocation.
Advance application, reversals, persistent conversational drafts, HTTP/authentication and Hermes remain outside this ticket.
