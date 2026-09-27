# 15 — Dual-run import, reconciliation and pilot readiness

**What to build:** Prepare the operator to run a small seven-day paper-and-ERP pilot without hiding differences. The system supports verified opening data, daily reconciliation, difference reasons, recovery rehearsal and a clear handoff for expanding only after evidence gates pass.

**Blocked by:** 14 — Production deployment and 2-core, 2-GB resource proof.

**Status:** ready-for-agent

- [ ] Opening import supports the selected products, customers, suppliers, stock, valuation, receivables and payables with a reviewable confirmation summary.
- [ ] Import is idempotent or safely restartable and preserves source/provenance evidence.
- [ ] Daily reconciliation compares stock, purchase, sales, settlement, returns, loss and gross profit without overwriting differences.
- [ ] Every difference can be assigned a reason, investigation target and resolution status.
- [ ] A pilot runbook defines the 10–20 product scope, small counterparty set, seven-day dual entry and three-day unexplained-difference gate.
- [ ] The runbook includes a clean restore rehearsal before the ERP becomes authoritative.
- [ ] Documentation clearly assigns the real seven-day operating pilot to the user and does not claim it was completed by an Agent.
