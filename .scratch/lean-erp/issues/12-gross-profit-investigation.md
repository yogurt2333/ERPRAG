# 12 — Evidence-bound gross-profit investigation

**What to build:** Let an operator ask why a sale's gross profit differs from expectation and receive a deterministic reconstruction backed by ERP records and approved versioned rules. Complete evidence yields a supported explanation; incomplete evidence yields no cause and names only specific investigation targets.

**Blocked by:** 02 — Customer order and delivery create receivable and gross profit; 05 — Posted records are corrected by linked reversal; 06 — Returns use original evidence or quarantined stock; 07 — Stocktake, transfer, loss and concurrent stock protection.

**Status:** ready-for-agent

- [ ] Investigation deterministically reconstructs revenue, stock-ledger cost, return effects and separately reported loss.
- [ ] Every supported amount and causal statement links to stable ERP evidence and an approved versioned rule when a rule is needed.
- [ ] Retrieval distinguishes raw candidates from accepted support and rejects unrelated, expired or out-of-scope material.
- [ ] Complete evidence produces a supported explanation without model-authored arithmetic.
- [ ] Missing or conflicting evidence produces “unable to explain” plus specific records to inspect, never a likely cause.
- [ ] Scripted Agent tests prove fabricated commentary cannot enter the verified explanation.
- [ ] Live-model evaluation, if run, is reported separately and is not treated as deterministic test proof.
