# ADR 0002: Generate audit prose from computed facts

Accepted. A live model invented discounts and missing data despite correct tools.
Keep its commentary unverified; generate the audit explanation deterministically
from validated input and the audit result. No natural-language model claim is certified.
Stable reason codes separate failure meaning from wording. Exact fraction prices
are rendered without rounding; unbounded decimals fall back to rational cents.

Rule ID/version citations must be unique within an audit snapshot. Duplicate sources
are inconclusive, including collisions in another ledger, rather than allowing an
explanation to associate a citation with the wrong record.

Agent and retrieval evaluation share a single acceptance operation. Generic-token
filtering remains an explicit heuristic. Negative examples and scope exclusions are
reported separately from positive Top-1; no threshold is calibrated on this tiny set.
