# Verification — 2026-09-17

## Scope
First synthetic price audit iteration. No production ERP connection or real customer
data. Repository started empty; no git identity is configured, so commits await user
identity. Workflow setup -> spec -> tickets -> TDD -> two-axis review completed locally.

## Automated checks
- Strict TypeScript typecheck passed.
- 21 offline tests passed, 0 failed before final output-label update.
- Demo: conflict=violation, discount=violation, conversion=compliant, overlap=inconclusive.
- Pi uses actual runtime with scripted model transport for repeatable tests.
- Tests cover budget, timeout, cancellation, unsupported tool, source uniqueness,
  tax/unit conversion, exact sub-cent comparison, mixed known/unknown findings,
  scopes, embedding schema and irrelevant semantic candidate handling.

## Live local verification
- Ollama reported qwen3.5:9b with tools capability. embeddinggemma downloaded with approval.
- Initial 30-second run timed out. Minimal native chat completed in 47.5868 s,
  load_duration 22.9322 s. This demonstrates a cold-start budget issue; it does not
  attribute all elapsed time exclusively to loading.
- CLI local budget increased to 180 seconds; two subsequent live Pi runs completed,
  calling two tools and returning deterministic violation for DEMO-001.
- Latest run included semantic retrieval with lexical acceptance gate.
- Raw locally generated runs: artifacts/live-investigation.json (ignored by git).
  This artifact predates the final rename to unverifiedModelCommentary; its old
  commentary field is explicitly unverified, not a certified explanation.
- Three policy passages / six labeled positive queries: lexical Top-1 6/6,
  embeddinggemma cosine Top-1 6/6. No demonstrated vector improvement. No independent
  test set or rejection calibration. artifacts/retrieval-evaluation.json is local.

## Observed explanation failure
The second live response claimed a 10% discount despite discountBps=10000 and said
conversion/tax facts were missing despite baseUnits=1, taxBps=0, taxInclusive=false.
Tool calculation and sources were correct. The output now explicitly labels model
commentary as unverified. Completed is a tool-evidence workflow status, not factual
certification of model prose. Future work must evaluate supported claims and refusal.

## Review
Standards: one finding (reused order source IDs), fixed and rechecked.
Spec: two initial findings (known violation lost on unrelated unknown tax; missing
source scope), fixed and rechecked. Follow-up found semantic candidates accepted as
support; fixed by separating candidates and lexical-gated accepted excerpts, with a
red/green negative test. No remaining blocking findings from these reviews.

## Remaining limits
No UI or production integration; integer quantity/unit factors only; gifts unsupported;
three short synthetic policy chunks only. Semantic ranking re-embeds the tiny corpus
per query; persistence/indexing and calibrated relevance are not implemented. Model
explanations are not trusted. Git commit awaits user-provided name/email.
