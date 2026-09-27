# Repository instructions

Use UTF-8. Prefer Git Bash; when PowerShell is needed, use pwsh 7.
For network commands temporarily set HTTP_PROXY, HTTPS_PROXY and ALL_PROXY to
http://127.0.0.1:7890. Never commit proxy configuration or credentials.

## Agent skills

Local Markdown tracker: see docs/agents/issue-tracker.md.
Single domain context: read CONTEXT.md and applicable docs/adr/ files before work.
Triage vocabulary: docs/agents/triage-labels.md.
Routine workflow choices and test seams are delegated by the user. Ask only for
material product tradeoffs, missing information or high-risk actions.

## Engineering standards

TypeScript strict mode. Test observable behavior at audit, retrieval and agent-run
boundaries. Money uses integer cents and exact rational comparisons. Never label
synthetic rules as facts about the source ERP. Never commit raw ERP exports.
Keep inconclusive evidence distinct from compliance and confirmed violation.
Do not claim live model or embedding validation from offline tests.
