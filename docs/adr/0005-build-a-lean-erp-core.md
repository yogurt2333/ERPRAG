# ADR 0005: Build a lean ERP core instead of running ERPNext

Accepted, superseding ADR 0003. The product will implement its own small ERP core
for the confirmed distribution workflow and may use ERPNext as a product and domain
reference. It will not copy ERPNext source code or reproduce its database schema.
The new ERP, not ERPNext or Hermes, owns inventory, receivables, payables,
payments, gross-profit facts and business follow-ups. This accepts the cost of
implementing and validating the required accounting and stock invariants in exchange
for a runtime designed for a single operator on a 2-core, 2-GB server.
