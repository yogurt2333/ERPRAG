# Lean distribution ERP with Hermes

Status: ready-for-agent

## Problem Statement

A small FMCG distribution business needs to record purchasing, sales, stock,
receivables, payables and payments without the operating cost and interface breadth
of a full ERP. In practice, business events happen before records are completed:
goods may arrive after a phone order that was never entered, deliveries are reported
after the operator returns, and payments may be mentioned without invoice numbers.
The system must tolerate these omissions without inventing history or corrupting
stock and money.

The primary operator wants to work through a private Hermes WeChat text channel.
Natural language must reduce data-entry effort, but no model statement may directly
change stock or money. Every write must first become a validated structured operation
draft, be shown to the operator, and be confirmed. A deterministic Web/PWA must keep
the business usable when Hermes, WeChat or the remote model is unavailable.

The service must target a single 2-core, 2-GB server. ERPNext is a business-flow
reference only: its source code, schema and runtime will not be copied or deployed.
The current repository's read-only price-audit demonstration remains a separate
context and is not evidence that this ERP has been implemented.

## Solution

Build an independently implemented, modular TypeScript/Node ERP service backed by a
local SQLite database in WAL mode. The ERP owns all business facts and rules. It
exposes narrow business operations to a responsive Web/PWA and to Hermes tools;
clients never receive generic database mutation access.

The MVP supports product and counterparty masters, purchasing, sales orders,
delivery confirmation, stock and batch management, shelf-life reminders, stocktake,
transfer, loss, returns, receivables, payables, receipts, payments, moving
weighted-average cost, operating gross profit, durable follow-ups, reminders,
summaries, audit records, backups and closed-period archival.

Hermes turns WeChat text into structured tool input. The ERP validates the request,
creates the only current draft for that conversation, and returns a complete impact
summary. The operator may correct it in natural language or reply with a plain
confirmation. Only the ERP can post the confirmed version, once, inside a database
transaction. Deterministic tools calculate every amount and stock change. RAG may
explain results only from ERP records and approved versioned internal rules; missing
evidence produces no causal explanation.

## User Stories

1. As an operator, I want to use either WeChat or Web/PWA, so that business can continue when one channel is unavailable.
2. As an operator, I want every natural-language write converted into a structured draft, so that I can see exactly what will change.
3. As an operator, I want to correct the current draft in natural language, so that I do not need to restart data entry after a mistake.
4. As an operator, I want to confirm the current draft by replying “确认”, so that routine use stays simple.
5. As an operator, I want each conversation to have at most one current draft, so that a plain confirmation is never ambiguous.
6. As an operator, I want duplicate confirmation delivery to return the original result, so that retries never post twice.
7. As an operator, I want a failed multi-part operation to change nothing, so that stock and money cannot become half-posted.
8. As an operator, I want the actor, channel, draft and confirmation recorded, so that every change is traceable.
9. As an operator, I want confirmed records corrected through reversal or adjustment, so that history is not silently rewritten.
10. As an operator, I want all operators to have equal permissions, so that the one- or two-person business has no unnecessary role administration.
11. As an operator, I want actions attributed to the actual operator, so that equal permissions do not erase accountability.
12. As an operator, I want to sign in to Web/PWA with a passkey, so that public access does not depend on passwords or SMS.
13. As an operator, I want backup credentials and offline recovery codes, so that loss of one phone does not permanently lock the business out.
14. As an operator, I want sensitive administration to require recent passkey verification, so that a stale browser session cannot restore or delete archives.
15. As an operator, I want to create a product with only a name and stock unit, so that an unknown product does not block urgent receipt.
16. As an operator, I want incomplete product information to become a follow-up, so that missing shelf-life and packaging data is not forgotten.
17. As an operator, I want product aliases, specifications and optional barcodes, so that colloquial WeChat names resolve to the intended product.
18. As an operator, I want stock maintained in a smallest stock unit, so that mixed case and piece transactions remain comparable.
19. As an operator, I want to enter transactions using pack units, so that I can say “箱” instead of converting every quantity manually.
20. As an operator, I want pack conversions versioned, so that a later packaging change does not reinterpret historical stock.
21. As an operator, I want exact quantity and money arithmetic, so that floating-point rounding cannot change stock or receivables.
22. As an operator, I want customer and supplier records with aliases, so that common names can be resolved without silent duplication.
23. As an operator, I want all MVP amounts treated as actual CNY transaction amounts, so that I am not forced into tax-accounting workflows.
24. As an operator, I want to record a purchase order before goods arrive when convenient, so that expected receipts remain visible.
25. As an operator, I want to receive goods even when the purchase order was missed, so that physical work is not blocked by late data entry.
26. As an operator, I want a missing purchase order to produce a durable follow-up, so that the gap is visible without fabricated history.
27. As an operator, I want a backfilled order marked as late-entered, so that the system does not pretend it was created earlier.
28. As an operator, I want purchase receipt to increase stock and payable together, so that goods and supplier debt remain consistent.
29. As an operator, I want to record supplier payments separately or together with receipt, so that both immediate and later payment are supported.
30. As an operator, I want unspecified supplier payments allocated to earliest-due payables in a draft, so that I do not need invoice numbers for routine settlement.
31. As an operator, I want excess supplier payment kept as prepayment, so that money is not assigned to nonexistent purchases.
32. As an operator, I want customer orders to allow quantities above available stock, so that demand can be recorded before replenishment.
33. As an operator, I want unavailable order quantities shown as backorders, so that remaining work is explicit.
34. As an operator, I want actual delivery to reject negative stock, so that missing receipts or physical discrepancies cannot be hidden.
35. As an operator, I want delivery confirmation to post stock issue and receivable, so that no vehicle-stock workflow is required.
36. As an operator, I want an order changed or cancelled before delivery without ledger reversal, so that drafts and commitments stay lightweight.
37. As an operator, I want one message to describe both delivery and receipt of money, so that common cash-on-delivery work is fast.
38. As an operator, I want the combined sales-and-receipt draft to show both internal effects, so that convenience does not hide separate accounts.
39. As an operator, I want an unspecified customer receipt allocated to earliest-due receivables in a draft, so that routine collection is easy.
40. As an operator, I want partial receipts to leave the remaining receivable open, so that credit sales are represented accurately.
41. As an operator, I want excess customer receipts held as advances, so that future sales can use them without inventing an invoice.
42. As an operator, I want purchasing to update moving weighted-average cost, so that sales cost does not require tracking the exact purchased unit sold.
43. As an operator, I want sales cost taken from the stock ledger at delivery, so that gross profit uses deterministic inventory valuation.
44. As an operator, I want operating gross profit to exclude taxes and business overhead, so that the result is not misrepresented as accounting net profit.
45. As an operator, I want a return linked to its originating sale or purchase where possible, so that price, cost and settlement reverse correctly.
46. As an operator, I want the system to search candidate original records, so that I do not need to remember document numbers.
47. As an operator, I want an ambiguous physical return placed in quarantined stock, so that it is acknowledged without becoming saleable stock.
48. As an operator, I want an unresolved return to leave cost and settlement unchanged, so that missing evidence cannot fabricate a refund or profit change.
49. As an operator, I want returned sales cost reversed using the originating sale cost, so that current average cost does not rewrite history.
50. As an operator, I want damaged or unsaleable returns converted to loss through a confirmed operation, so that disposal remains traceable.
51. As an operator, I want stocktake to compare physical count with ledger quantity before changing anything, so that discrepancies are visible.
52. As an operator, I want missing source transactions restored before a generic adjustment, so that the ledger retains the real business cause when known.
53. As an operator, I want irreducible stock differences adjusted with a reason, so that current stock can be corrected without overwriting history.
54. As an operator, I want warehouse transfers to debit and credit locations atomically, so that total stock remains unchanged.
55. As an operator, I want loss to reduce stock and affect operating gross-profit reporting separately from sales cost, so that shrinkage is visible.
56. As an operator, I want shelf-life days stored on applicable products, so that expiry management requires minimal receipt input.
57. As an operator, I want to enter the earliest production date for a receipt batch, so that a production-date range can be managed conservatively.
58. As an operator, I want a managed expiry date clearly labeled as an operational estimate, so that it is not presented as an exact unit-level fact.
59. As an operator, I want near-expiry batches identified and summarized, so that I can sell, return or write them off in time.
60. As an operator, I want follow-ups to live in the ERP rather than Hermes memory, so that restarts and new conversations do not lose work.
61. As an operator, I want workflow gaps, overdue obligations, expiry warnings and unresolved returns represented uniformly, so that one queue covers unfinished business.
62. As an operator, I want an immediate notification when a new actionable gap appears, so that urgent omissions are visible.
63. As an operator, I want one daily digest without repeated same-day spam, so that I can finish outstanding work efficiently.
64. As an operator, I want a weekly summary of sales, purchases, gross profit, collections, debts, losses, expiry and follow-ups, so that I can review the business.
65. As an operator, I want to act now, defer, or ignore with a reason, so that reminders reflect real decisions.
66. As an operator, I want deterministic gross-profit reconstruction from business records, so that an explanation begins with verified amounts.
67. As an operator, I want RAG restricted to approved versioned rules and ERP records, so that internet or model lore cannot become company policy.
68. As an operator, I want an explanation only when evidence proves it, so that a plausible model story is never presented as the cause.
69. As an operator, I want specific investigation targets when evidence is incomplete, so that “unable to explain” still helps me inspect the right record.
70. As an operator, I want Hermes to send only necessary context to the remote model, so that external inference does not receive whole tables or archives.
71. As an operator, I want Web/PWA operations to work without the remote model, so that model outages do not halt the business.
72. As an operator, I want encrypted off-server backups at least hourly, so that loss of the VPS does not erase the business ledger.
73. As an operator, I want at most one hour of data loss and restoration within four hours, so that recovery expectations are explicit.
74. As an operator, I want backup integrity checks and real restore drills, so that file existence is not mistaken for recoverability.
75. As an operator, I want disk usage warnings before capacity is exhausted, so that archival can be planned.
76. As an operator, I want only complete closed months archived, so that live obligations, batches and exceptions remain available.
77. As an operator, I want an encrypted verified cold archive and searchable live index, so that old records can leave the primary disk without becoming undiscoverable.
78. As an operator, I want local deletion only after off-server verification and confirmation, so that archival cannot silently destroy the only copy.
79. As an operator, I want a small dual-run pilot, so that ledger correctness is proven before the ERP becomes authoritative.
80. As an operator, I want unexplained pilot differences preserved and investigated, so that launch cannot pass by manually forcing totals to match.
81. As an operator, I want the MVP measured on the target 2-core, 2-GB server, so that resource support is an evidence-backed claim.
82. As an operator, I want resource degradation to remove nonessential Hermes capabilities before financial safeguards, so that memory pressure never weakens ledger correctness.

## Implementation Decisions

- Treat the lean ERP and the existing price-rule audit as separate bounded contexts. Any future integration uses a stable adapter and does not let the audit context mutate ERP state.
- Implement a modular monolith rather than microservices. The ERP service owns business transactions, a scheduler, the Web/PWA API and internal query projections.
- Use SQLite in WAL mode on local durable storage. Only the ERP service writes the database. PostgreSQL is a future migration triggered by measured concurrency or availability needs.
- Keep model inference remote. Do not run ERPNext, MariaDB, PostgreSQL, a local model or server-side speech recognition on the target MVP server.
- Keep domain modules for identity, product/catalog, counterparties, purchasing, sales, inventory, settlement, costing, follow-up, explanation, retention and audit. Cross-module writes are coordinated by an application-level business-operation service.
- Expose narrow business commands and queries. Clients cannot submit final balances, costs, gross profit, arbitrary table names, SQL, internal method names or unrestricted document mutations.
- Make the business-operation service the public internal seam for all writes. It validates input, checks optimistic assumptions, creates or confirms drafts, applies idempotency, executes one database transaction and returns an observable result.
- Maintain one current draft per operator conversation. Store its invisible identifier, version, normalized operation, validation findings, impact preview and expiry/status. A correction creates a new version; confirmation targets the current version.
- Permit a plain confirmation in the UI. Channel adapters bind that confirmation to the conversation's current draft rather than requiring the operator to type an identifier.
- Persist an idempotency key derived from the channel message/event and confirmed draft. Repeated delivery returns the stored result without repeating side effects.
- Store monetary values as integer cents when bounded to cents. Where valuation requires exact intermediate ratios, use exact decimal or rational representation and define a single explicit rounding point for posted cents. Never use binary floating point for money.
- Store stock quantities and conversion ratios exactly. Maintain stock in the product's stock unit and retain the conversion version used by every line.
- Maintain an append-only stock ledger and settlement ledger. Current balances are derived or transactionally maintained projections that can be rebuilt and reconciled against ledger entries.
- Make posted records immutable. Reversal, return, loss and adjustment records link to the affected origin and carry actor, timestamp, channel and reason.
- Update moving weighted-average cost only through posted inventory transactions. Physical fulfillment batch choice and cost valuation are separate concepts.
- Prevent stock-issuing operations from producing negative on-hand quantity. Customer orders may exceed stock and expose a backorder; delivery may not.
- Represent delivery as a single completion event. The MVP has no loading, vehicle-stock or in-transit delivery state.
- Create receivable on delivery and payable on purchase receipt. Receipts and payments are separate settlement entries even when submitted in the same operation.
- Allocate unspecified receipts/payments to earliest-due open obligations in a draft. Permit natural-language override before confirmation. Keep excess as an explicit advance/prepayment balance.
- Link returns to original documents when evidence is sufficient. Candidate search may help the operator choose; it cannot choose silently when ambiguous.
- Store ambiguous returned goods in a logical quarantine location. They do not update available stock valuation or financial ledgers until resolution.
- For stocktake differences, prefer restoring a missing source operation. Use a reasoned stock adjustment only when no source event can be reconstructed.
- Model shelf-life with product-level days and a batch-level managed production date. Derive a conservative managed expiry date and label it as operational rather than exact.
- Support provisional products with name and stock unit. Missing pack conversions, shelf-life data and other optional master data create follow-ups.
- Treat all MVP transaction amounts as actual CNY amounts. Do not split VAT, manage invoices or produce accounting net profit.
- Define gross profit as recognized sales revenue minus stock-ledger sales cost, adjusted for sales returns. Track losses separately and exclude overhead and tax.
- Generate gross-profit numbers and explanations from deterministic ledger reconstruction. RAG supplies only source-bound policy context and never performs arithmetic or certifies unsupported prose.
- Distinguish a supported explanation, investigation targets and inability to explain. Do not return “likely causes” when evidence is incomplete.
- Persist follow-ups in the ERP with type, related records, status, responsible operator, reminder schedule, resolution and reason. Hermes conversation state is not durable business state.
- Send immediate actionable notifications, one daily digest and one weekly summary through the configured WeChat channel. Avoid repeated same-day notification for unchanged items.
- Use a scheduler inside the modular service or a single lightweight companion process. Scheduled jobs call the same business/query boundaries as interactive requests.
- Provide a responsive Web/PWA over public HTTPS. It exposes the same operations as Hermes and remains functional without model inference.
- Use WebAuthn passkeys with no self-service registration. Bootstrap enrollment through a short-lived one-time server-generated link. Require at least a backup credential or offline recovery codes before production use.
- Store Web sessions server-side and send only a Secure, HttpOnly, SameSite=Strict host cookie. Do not place session or refresh tokens in browser local storage.
- Give the one or two operators equal business permissions. Record the individual actor. Require recent passkey reauthentication for enrollment, credential revocation, restore and archival deletion.
- Keep Hermes credentials and remote-model access separate from Web sessions. Hermes receives only the ability to call allowlisted business operations, not database credentials or generic shell access.
- Minimize remote-model data: current request, necessary candidate identifiers and bounded tool results only. Never send whole tables, backups, cold archives or unrelated history.
- Place the ERP and Hermes behind explicit process/container resource limits. Disable Hermes browser automation, local inference and nonbusiness execution tools for the production profile.
- Use HTTPS termination, request-size limits, rate limits, health checks and restart policies. Do not expose the SQLite file or an unrestricted internal API publicly.
- Encrypt and copy recoverable database backups off-server at least hourly; produce a daily full backup; retain seven daily and eight weekly restore points.
- Keep recovery keys outside the primary server. Check backup integrity monthly and perform a real restore quarterly. Target RPO of one hour and RTO of four hours.
- Retain approximately 24 months in the live database. Warn at 70% disk use and propose, but do not autonomously execute, archival at 80%.
- Archive only complete closed months with no dependent open obligations, active batches or unresolved exceptions. Preserve a live searchable index and current opening/balance evidence.
- Delete live archived detail only after encrypted off-server upload is verified and the operator confirms the impact summary.
- Deliver in three phases: ledger core first; usable Web/Hermes MVP second; prediction and richer clients third.
- Phase 0 covers schema migration, exact values, units, inventory, purchasing, sales, returns, stocktake, transfer, loss, settlement, costing, reversal, audit and behavioral tests. It has no Hermes dependency.
- Phase 1 adds Web/PWA, passkeys, business API, Hermes draft/confirmation, follow-ups, notifications, summaries, shelf-life, evidence-bound explanation, backup/archive and target-server validation.
- Phase 2 may add automatic replenishment suggestions, sales forecasting, barcode-assisted input, bulk import, dashboards and a richer mobile app. Suggestions never place purchases automatically.
- Launch through a seven-day dual run using 10–20 common products and a small set of customers and suppliers. Expand only after three consecutive days without unexplained differences and a successful restore drill.

## Testing Decisions

- The principal test seam is the public business-operation boundary backed by a temporary real SQLite database. Tests submit the same logical operations used by Web and Hermes, then query observable documents, balances, stock, cost, follow-ups and audit results.
- Prefer complete business behavior tests over tests of private arithmetic helpers or SQL statements. A purchasing test should prove receipt, stock, weighted cost and payable together; a sales test should prove delivery, stock issue, cost, receivable and gross profit together.
- Test cross-module atomicity by injecting failure before commit and proving that no partial stock, settlement, follow-up or audit state survives.
- Test idempotency by repeating the same confirmation and proving one posted operation and one stable response.
- Test concurrency at the public boundary for two competing deliveries, confirming that available stock cannot be oversold and SQLite lock handling returns a controlled result.
- Test exact money and quantity behavior at sub-cent valuation boundaries, partial pack conversions, weighted-average changes, partial returns and repeated reversal chains.
- Test that posting can never create negative stock, while orders can create backorders.
- Test pack conversion versioning by changing future packaging and proving historical transactions retain their original meaning.
- Test purchase receipt with and without a preceding order, including creation and resolution of the late-entry follow-up.
- Test combined sale-and-receipt commands as one transaction while proving separate linked settlement entries.
- Test earliest-due allocation, partial allocation, override, advance/prepayment creation and reversal.
- Test returns linked to a unique origin, ambiguous candidate sets, quarantine, later resolution, damaged return loss and originating-cost reversal.
- Test stocktake reconciliation, source-operation restoration and reasoned generic adjustment as distinct outcomes.
- Test managed expiry derivation from an earliest production date and ensure all displays label it as a management date rather than exact fact.
- Test follow-up scheduling and notification deduplication with a controllable clock. Do not rely on real wall-clock delays.
- Test gross-profit investigation with complete and incomplete evidence. Complete evidence returns cited reconstruction; incomplete evidence returns no cause and names only investigation targets.
- Test retrieval acceptance separately from raw candidates. A Top-K result alone is not supporting evidence.
- Keep real remote models outside deterministic test suites. Script model/tool transport for Hermes flow tests and separately label any live-model evaluation.
- Add thin HTTP contract tests for passkey/session enforcement, request validation, CSRF/origin protection, status mapping and invocation of the same business-operation boundary. Do not duplicate ledger-calculation cases through HTTP.
- Add thin Hermes tool contract tests for schemas, current-draft replacement, plain confirmation, cancellation, duplicate message delivery and bounded tool results. Do not ask a model to judge whether numbers are correct.
- Test authentication enrollment, assertion, credential revocation, recovery-code one-time use, session expiry and recent-authentication requirements with a WebAuthn-compatible test harness.
- Test backup consistency under writes, encrypted off-server transfer, retention, failed verification preventing deletion, restore into a clean environment and reconciliation after restore.
- Test archive eligibility so open receivables/payables, active batches and unresolved exceptions block their dependent period from archival.
- Test the 2-core, 2-GB claim only on an equivalent target environment. Record idle and peak RSS, SQLite WAL growth, request latency, backup load and Hermes resource use.
- The resource acceptance suite includes 100 sequential WeChat draft/confirm cycles, concurrent Web query plus Hermes write plus backup, and a 24–72-hour soak with no OOM, duplicate posting or ledger mismatch.
- Reuse the existing repository's prior art: deterministic audit behavior tests, scripted Agent transport, cancellation/time-budget tests, exact rational calculations, evidence acceptance checks and explicit inconclusive outcomes.
- Do not present existing 28 price-audit tests as coverage for the new ERP. The new context requires its own external-behavior suite.
- Pilot acceptance requires daily reconciliation of stock, purchase, sales, settlement, returns, loss and gross profit; every difference has a recorded cause, and totals are never overwritten merely to match paper records.

## Out of Scope

- Running, forking, trimming or copying ERPNext/Frappe or its database schema.
- Multi-tenant SaaS, public sign-up, customer self-service ordering or a general account platform.
- VAT calculation, invoice management, tax filing, accounting vouchers, statutory accounting or net-profit reporting.
- Manufacturing, BOM, projects, payroll, human resources, fixed assets, ecommerce and marketing CRM.
- Customer quotations, purchase requests and complex approval workflows.
- Loading, vehicle inventory, delivery-route inventory or multi-day in-transit state.
- Local LLM inference, server-side speech recognition or storage of WeChat audio.
- Arbitrary model-generated writes, model arithmetic, generic database tools or unrestricted ERP CRUD.
- Probabilistic gross-profit causes when evidence is incomplete.
- Automatic purchase placement, automatic stock adjustment or automatic archive deletion.
- Multi-node active-active deployment and high availability in the MVP.
- PostgreSQL until measured concurrency or availability requirements justify migration.
- Native mobile application as an MVP requirement; a richer app belongs to Phase 2 and reuses the same API.
- Automatic replenishment and sales forecasting before Phase 2.
- A claim that 2-core, 2-GB support, Hermes integration, Passkey compatibility or production readiness exists before runtime evidence is recorded.

## Further Notes

- The business design and ADRs are agreed. Tickets 01–05 implement local SQLite purchase receipt, customer orders, delivery, settlement allocation, versioned packs, provisional products, managed expiry and linked posted-record reversals with their own behavior tests; remaining tickets are pending. Preserve this limited implementation scope in README, portfolio and resume claims.
- The repository currently contains a verified read-only synthetic price-audit program and historical ERPNext learning artifacts. They provide testing and domain lessons, not reusable proof of operational ERP correctness.
- Before Phase 1 implementation, verify the current Hermes WeChat adapter's message identity, duplicate-delivery behavior, reconnection semantics, outbound scheduled delivery and tool registration against the selected release.
- Select an external model provider and document its data retention, timeout, retry and outage behavior before production use.
- Select an object-storage provider and verify region, encryption, lifecycle rules, restoration time and cost before implementing cold archival.
- Use the target stable HTTPS subdomain as the WebAuthn relying-party ID from the first production enrollment; temporary tunnel or raw-IP credentials are not production credentials.
- If the 2-GB target fails measured acceptance, first remove optional Hermes capabilities and tune bounded caches/workers. Do not weaken transaction, validation, audit or backup guarantees to fit memory.
- Dependency-aware tickets are in `issues/`. Tickets 01–05 are complete; continue with the next unblocked ticket. Each implementation ticket carries its own acceptance criteria and referenced decisions.
