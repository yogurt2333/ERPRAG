# Context Map

## Contexts

- [Price-rule audit](./CONTEXT.md) — the existing read-only, evidence-backed price-floor investigation demonstration.
- [Lean distribution ERP](./docs/lean-erp/CONTEXT.md) — a single-business operational system; SQLite purchase receipt, customer orders, delivery and settlement allocation are implemented; subsequent workflows remain pending.

## Relationships

- **Lean distribution ERP → Price-rule audit**: operational records may later become audit inputs through a stable adapter; the audit context never owns or mutates ERP state.
- **Price-rule audit → Lean distribution ERP**: source-bound explanations and explicit inconclusive results are reused as design principles, not as proof that the new ERP is implemented.
