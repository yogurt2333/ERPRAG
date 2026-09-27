# 02 — Negative retrieval evaluation and acceptance boundary

**Blocked by:** 01
**Status:** done
**What to build:** Run the same acceptance algorithm in Agent and evaluation, measuring
positive results separately from unsupported/scope-negative queries.

- [x] Generic-only text cannot admit policies just through common-word overlap.
- [x] Offline and optional local embedding evaluation expose false-acceptance metrics.
- [x] Report corpus size and limits; do not tune a cosine threshold on the smoke set.

Verification: docs/validation-evidence-quality.md. Commit pending user identity.
