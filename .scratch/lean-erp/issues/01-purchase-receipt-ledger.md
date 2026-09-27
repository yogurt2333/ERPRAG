# 01 — Purchase receipt creates stock, cost and payable

**What to build:** Deliver the first complete lean-ERP transaction. An operator can establish the minimum product, supplier and warehouse data, post a purchase receipt, and observe stock, moving weighted-average cost, payable and audit history produced together from a real SQLite transaction.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A fresh database can be initialized and migrated repeatedly without manual repair.
- [x] A product with a name and stock unit, a supplier and a warehouse can be created through public business operations.
- [x] Confirming a purchase receipt increases stock, updates exact moving weighted-average cost and creates the matching payable in one transaction.
- [x] Repeating the same confirmed operation does not duplicate stock, payable or audit effects.
- [x] Invalid quantity, unit or money input fails closed and leaves no partial records.
- [x] Public queries expose the posted receipt, on-hand stock, valuation, open payable and actor/channel audit evidence.
- [x] External-behavior tests use a temporary real SQLite database and do not assert private SQL or helper implementation.

Verification (2026-09-27, Node.js 24.18.0, local Windows):

- `npm run typecheck`: passed.
- `npm test`: 35 passed / 0 failed, including 7 new ERP behavior tests and 28 existing audit-context tests.
- `npm run demo:erp`: passed; synthetic 3-unit / 100-cent receipt yields exact 100/3-cent average cost, one payable and one receipt audit event after duplicate confirmation.
- Real temporary disk SQLite tests cover repeated initialization/reopen, durable idempotency, rejected key reuse, exact fractional quantities, multi-line/product/warehouse isolation, large amounts, malformed input and rollback after all writes before commit.

Implementation: `src/erp/service.ts`, `database.ts`, `exact.ts`, `demo.ts`.
Usage and scope: `docs/lean-erp/PURCHASE-RECEIPT.md`.
No HTTP/authentication, conversational drafts, Hermes, live-model validation or production-readiness claim is included.

Closeout review (2026-09-27):

- Baseline: the repository has no commits; reviewed ticket 01's new purchase implementation and public behavior tests in the current working tree rather than a commit diff. Ticket 02 additions were already present and preserved, not included as new scope for this review.
- Standards axis: no blocking violations; one documentation finding about the outdated migration-version description, corrected in `docs/lean-erp/PURCHASE-RECEIPT.md`.
- Spec axis: all seven acceptance criteria covered; no missing or incorrect ticket 01 behavior found. The same migration-documentation drift was noted and corrected.
- Refreshed verification: `npm run typecheck` passed; `npm test` passed 41/41 (7 purchase, 6 sales, 28 audit-context tests).
- Current `src/erp/demo.ts` also posts ticket 02's delivery: final stock is 2 units, value 200/3 cents, average cost 100/3 cents and payable 100 cents. The original purchase-only verification above is historical; the usage guide now distinguishes these outputs.
- Ticket 01 is reviewed and closed. No Git commit was created; the shared working tree includes other uncommitted project work.
