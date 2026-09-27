# Lean distribution ERP

A small operational system for one business and one or two equal-privilege operators. It owns purchasing, sales, inventory, settlement and follow-up state; Hermes and Web/PWA are interaction surfaces.

## Interaction

**Operator**:
One of at most two internal business users. Operators have equal permissions, but every action retains its actor identity.
_Avoid_: Customer, tenant, administrator

**Conversational handle**:
The Hermes and WeChat surface used to request, review and confirm ERP operations. It does not own business state or rules.
_Avoid_: ERP database, autonomous accountant

**Operation draft**:
A validated structured proposal derived from natural language. It has no business effect until confirmed.
_Avoid_: Command, posted transaction

**Current draft**:
The single latest operation draft awaiting confirmation in one operator conversation. Corrections replace its version, and repeated confirmation posts it once.

**Business operation**:
A narrowly defined query or action available through the ERP API. Arbitrary database or document mutation is outside the contract.

## Stock and products

**Stock unit**:
The smallest unit in which a product's on-hand quantity and moving weighted-average cost are maintained.

**Pack unit**:
A transaction-facing unit with a versioned exact conversion to the stock unit. Historical conversions never change.

**Provisional product**:
A product created with only a name and stock unit. Missing optional master data becomes a follow-up and is never inferred retroactively.

**Inventory valuation**:
Moving weighted-average cost maintained by the stock ledger, independent of the physical batch fulfilled.

**Backorder**:
The unfulfilled portion of a customer order. Orders may create backorders; posted delivery never creates negative on-hand stock.

**Quarantined stock**:
Physically held goods unavailable for sale because their source, condition or financial treatment is unresolved. It may be a logical location.

**Stock adjustment**:
A confirmed reasoned ledger entry for a physical-count difference that cannot be restored as a missing purchase, sale, return or loss.

## Shelf life

**Shelf-life days**:
The product-level duration used for expiry management.

**Managed production date**:
The earliest production date recorded for an inbound batch; it may conservatively represent a production-date range.

**Managed expiry date**:
The operational reminder date derived from the managed production date and shelf-life days, not an exact claim for every unit.

## Sales and settlement

**Delivery confirmation**:
The operator's confirmation that goods reached the customer. The MVP has no loading or vehicle-stock stage; confirmation posts stock issue and receivable.

**Transaction amount**:
The actual CNY amount agreed for a transaction. The MVP does not split VAT, manage invoices or claim tax-accounting profit.

**Payment allocation**:
The confirmed distribution of a receipt or payment across open obligations, defaulting to earliest-due items. Excess remains an advance or prepayment.

**Gross profit**:
Recognized sales revenue minus stock-ledger cost, adjusted for returns. It excludes tax, payroll, rent, utilities, depreciation and finance costs.

**Return cost**:
The originating sale's recorded cost reversed for returned quantity, rather than current weighted-average cost.

**Unresolved return**:
A received return not confidently linked to its origin. It creates quarantined stock and a follow-up but does not change settlement, cost or gross profit.

## Integrity and follow-up

**Posted record**:
A confirmed record that affected stock or money. It is corrected by a linked reversal or adjustment, never overwritten or deleted.

**Workflow gap**:
A missing expected record, such as received goods without a purchase order. It does not invalidate a separately confirmed event.

**Backfilled record**:
A record created after the event it describes, explicitly marked as late-entered.

**Business follow-up**:
A durable ERP record for a workflow gap, overdue obligation, expiry warning or operator action. Conversation history is not its source of truth.

**Supported explanation**:
A gross-profit explanation whose amounts and cause trace to ERP records and approved versioned rules.

**Investigation target**:
A specific record worth manual review when evidence is incomplete. It is not presented as a probable cause.

## Retention

**Closed period**:
A complete month with no open obligation, active batch or unresolved exception depending on the records selected for archival.

**Cold archive**:
An encrypted verified off-server package of a closed period. The live ERP retains its index and current balances.
