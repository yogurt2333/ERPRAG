# 11 — Hermes WeChat tool integration

**What to build:** Connect the selected Hermes release to the ERP through allowlisted business tools. A bound WeChat operator can describe a purchase or sale, receive the exact structured draft, correct it, confirm it once, and receive durable reminders and summaries without granting Hermes database or generic shell access.

**Blocked by:** 08 — Durable follow-ups, reminders and summaries; 09 — Operation drafts, confirmation and idempotency.

**Status:** ready-for-agent

- [ ] The selected Hermes release and WeChat adapter behavior are documented for message identity, reconnection, duplicate delivery, scheduled outbound messages and tool registration.
- [ ] Hermes tools expose bounded schemas and business operations rather than generic CRUD or database access.
- [ ] One WeChat purchase and one WeChat sale complete the propose, display, correction, plain-confirmation and result loop.
- [ ] Scripted tests prove duplicate WeChat delivery cannot repeat posting and that a second business intent cannot ambiguously replace a pending draft.
- [ ] Immediate notices, daily digest and weekly summary reach the configured channel with unchanged-item suppression.
- [ ] Tool results minimize remote-model data and never delegate money, stock or retrieval acceptance to the model.
- [ ] ERP and Web/PWA remain functional when Hermes or the remote model is unavailable.
