# Evidence quality iteration

Status: ready-for-agent

## Problem
The live model invented a discount and missing fields despite correct tool findings.
The retrieval smoke set has no negative queries and common-word overlap can admit
unrelated material. A reviewer needs readable, source-bound findings and honest metrics.

## Solution and user stories
1. Investigators receive a Chinese audit explanation generated from validated input
   and deterministic findings, never from model prose.
2. Exact prices carry units, source references and real missing-information reasons.
3. Failed/incomplete agent runs do not claim a completed investigation even if a partial
   deterministic report exists. Model commentary stays explicitly unverified.
4. Retrieval evaluation distinguishes positive Top-1 accuracy from negative false
   acceptance and scope exclusion, separately for lexical/cosine/accepted results.

## Decisions and test seams
Use the public explainAudit(input) boundary; it owns validation/calculation to avoid
accepting an unrelated report paired with different input. Agent returns this only
after the audit tool executes. CLI supports a Markdown demo in addition to JSON.
Use stable machine-readable reason codes for translation, keeping existing English
reasons for compatibility. Never round prices for threshold explanations.
Normalize lexical tokens and ignore generic stopwords; this remains a heuristic,
not a calibrated semantic relevance classifier. Preserve raw cosine candidates.
Extract the accepted-search operation so eval and Agent exercise the same code.
Keep exact-match questions and paraphrases, add unsupported topics, empty/generic
queries, wrong ledger and expired-date cases. No claims of production retrieval quality.

## Out of scope
Arbitrary natural-language fact checking, model-generated verified prose, production
rules, UI, automatic ERP changes, new model downloads. Commit awaits real git identity.
