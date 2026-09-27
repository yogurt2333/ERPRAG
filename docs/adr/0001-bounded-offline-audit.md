# ADR 0001: Evidence-first, read-only price audit

Accepted for the demonstration. Begin with a CLI and four synthetic cases. The
public audit operation is the principal test seam. Retrieval and Pi run boundaries
also receive external behavior tests. No production ERP writes or raw exports.

Deterministic tools own validation and price math; Pi orchestrates read-only tools.
Reports distinguish tool-calculated findings from model commentary. Retrieval
initially uses a transparent local lexical baseline, with exact source citations;
embedding quality and live provider choice remain separately verifiable work.
This avoids treating a keyword baseline as completed semantic RAG.

2026-09-17: user selected local Ollama. Use installed qwen3.5:9b for tool calling
and approved embeddinggemma download for embeddings. Small in-memory cosine
candidate ranking precedes a lexical-overlap acceptance gate in the agent. Raw
Top-K candidates are not support. This is an uncalibrated conservative baseline,
not proof of semantic relevance; evaluate separately before expanding scope.
