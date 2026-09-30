# 11 — Hermes WeChat tool integration

**What to build:** Connect the selected Hermes release to the ERP through allowlisted business tools. A bound WeChat operator can describe a purchase or sale, receive the exact structured draft, correct it, confirm it once, and receive durable reminders and summaries without granting Hermes database or generic shell access.

**Blocked by:** 08 — Durable follow-ups, reminders and summaries; 09 — Operation drafts, confirmation and idempotency.

**Status:** completed — 2026-09-30; functional acceptance passed in the isolated Weixin test environment, not a production rollout

- [x] The selected Hermes release and WeChat adapter behavior are documented for message identity, reconnection, duplicate delivery, scheduled outbound messages and tool registration.
- [x] Hermes tools expose bounded schemas and business operations rather than generic CRUD or database access.
- [x] One WeChat purchase and one WeChat sale complete the propose, display, correction, plain-confirmation and result loop.
- [x] Scripted tests prove duplicate WeChat delivery cannot repeat posting and that a second business intent cannot ambiguously replace a pending draft.
- [x] Immediate notices, daily digest and weekly summary reach the configured channel with unchanged-item suppression.
- [x] Tool results minimize remote-model data and never delegate money, stock or retrieval acceptance to the model.
- [x] ERP and Web/PWA remain functional when Hermes or the remote model is unavailable.

Implementation: `src/erp/hermes/`, `deploy/lean-erp/hermes/`; migration v11.
Evidence: `docs/lean-erp/HERMES-WECHAT.md`. Fixed upstream v2026.9.24 / f97608f178d1ffeca59860195ab7da295f7c8e5f.
Local verification: typecheck; 12 bridge tests; 8 Python plugin tests; 123/123 Node tests; diff check.

Live evidence: `.scratch/lean-erp/deployments/2026-09-30-hermes-live.md`.
- Dedicated runtime `/var/lib/hermes-erp`, isolated test database; existing primary gateway unaffected.
- Purchase corrected to 8 bottles / CNY 24, confirmed twice, exactly one receipt.
- Sales order 2 bottles / CNY 10 confirmed twice, one order, stock still 8.
- Delivery plus receipt confirmed twice, one delivery and one CNY 10 receipt, stock 6, outstanding zero.
- Two immediate notices, one daily digest and one weekly summary acknowledged by API and user.
- Fresh sender process rerun leaves exactly four acknowledged events, zero pending; no new unchanged events.
- Chinese presentation verified readable by user; first-screen scanning remains a requested future improvement.

Live sale correction also verified: draft v5 (1 bottle / CNY 5) replaced by v6 (2 bottles / CNY 9), then confirmed. Exactly one additional sales order, stock remains 6 and customer receipts remain CNY 10.

Recovery evidence: dedicated gateway restarted; a subsequent real Weixin confirmation returned the same v6 order, with unchanged order/stock/cash counts. This covers controlled restart, not arbitrary network-loss delivery guarantees.
Web fallback evidence: ECS private-network HTTP test passed purchase proposal/confirmation/replay without access to Hermes or remote models, using a temporary database and test passkey credentials; not a human-browser acceptance run.
Persistent notification sender activation and production runtime hardening remain separate from this bounded test run. Notification sender was run twice with --once, not left running or enabled at boot.

Follow-up UX: prioritize business type, quantity, total and posting status in the first screen; support safely resolving references such as “刚才那张订单” instead of requiring a copied UUID. Neither is claimed implemented.
