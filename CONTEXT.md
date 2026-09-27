# ERP price-rule audit

Purpose: a single-user portfolio demonstration of evidence-backed sales-price
investigation, using TypeScript/Node and Pi. The provided ERP HTML establishes
fields and module names, not server behavior. All committed fixtures are synthetic.

- Order: a dated sales document belonging to one ledger (账套).
- Price floor: a dated, ledger/product-scoped minimum exclusive-of-tax base-unit price.
- Effective price: line price after discount and proportional order discount,
  normalized to exclusive-of-tax base units.
- Evidence: stable source ID, version and locator; never an invented citation.
  A single audit snapshot must have unique rule ID/version citations; collisions
  across ledgers or products are inconclusive rather than silently misattributed.
- Violation: comparable effective price is strictly below its single applicable floor.
- Compliant: every line is comparable and meets its floor; not a claim about all ERP rules.
- Inconclusive: missing scope, conversion, tax basis or ambiguous applicable rules.

Synthetic policy: customer price overrides default product price when constructing
an order; the auditor checks the actual order price (does not silently replace it).
Order discounts are allocated proportionally after line discounts, before tax.
No rounding before threshold comparison. One ledger per run; inclusive date ranges.
Gifts and unsupported/invalid inputs are inconclusive. Overlapping floors are
inconclusive; no invented precedence. Audit is read-only and never blocks real ERP.
