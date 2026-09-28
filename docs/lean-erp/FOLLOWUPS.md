# Durable follow-ups, reminders and summaries

Ticket 08 implements a local service boundary, with synthetic SQLite behavior tests.
No Hermes/WeChat transport or production timer is connected yet.

## Operations

- `listFollowups()`, `listFollowupHistory()`: durable evidence links, responsible
  operator, state, reason and reminder timestamp. Business confirmations reconcile
  sources in the same transaction; `runScheduler()` detects time-dependent gaps and
  discovers pre-migration records. Source clearance resolves the queue item without
  changing its source ledger. A recurrence reopens the same evidence-linked item.
- `decideFollowup({ id, status, reason, until? }, confirmation)`: resolve, ignore or
  defer. A nonblank reason is required; defer requires a future timestamp. The usual
  confirmation/idempotency/audit rules apply. Resolving a task acknowledges work;
  it does not fabricate purchase orders, repair inventory or settle money.
- `runScheduler()`: one explicit tick using the injected `clock` (default system
  time). Business dates are Asia/Shanghai. Each day's first tick stores one daily
  digest; each week's first tick stores the preceding Monday-to-Monday summary.
  Offline periods are not backfilled with purported historical daily snapshots.
- `listNotifications()` exposes durable immutable events. Business commits enqueue
  one immediate event per newly actionable item/day. Deferred and ignored items
  do not emit repeated immediate events. Due deferrals return to the daily queue.
- `await deliverNotifications({ async deliver(event) { ... } })` drains pending
  events and acknowledges only successful delivery. The transport MUST deduplicate
  by `event.id`: a crash after remote acceptance and before local acknowledgment can
  repeat a delivery attempt. This is at-least-once transport, not a claim of exactly
  once WeChat delivery. Run one sender; multiple callers also require sink dedupe.

## Evidence and calculation boundaries

The queue covers incomplete products, unresolved returns, unlinked receipt/order
work, unpaid deliveries, overdue receivables/payables, managed expiry and unresolved
stocktake differences. Receipt input currently has no purchase-order link: its task
says order evidence is unrecorded, not that an order never existed. Partial payments
keep delivery/overdue tasks active until the remaining obligation clears.

Expiry alerts use a 30-day horizon, conservative receipt dates and positive stock
in the product/location. There is no batch issue allocation yet: remaining batch
quantity is explicitly unknown. An alert requires a physical check; it is not proof
of expired stock. Historical receipt lines can reappear after replenishment.

Weekly flows use posting dates and exact integer cents/rational cost. Purchases and
sales include dated returns/reversals. Net customer collection includes receipt
reversals and cash refunds. Sales gross profit excludes operating expenses; known
loss is reported separately and also subtracted in a second measure. Unvalued
quarantine disposal is listed rather than treated as a zero-valued loss.

Debt and expiry are explicitly generation-time snapshots, not reconstructed
historical closing balances. Follow-up trends count opened/resolved/deferred/ignored
history events during the week and current outstanding tasks. Reports retain source
IDs and persist unchanged even if a later correction changes current balances.

## Verification

`npm run typecheck` and `npm test`. Eight follow-up tests use a fake clock, temporary
real SQLite databases and an in-memory idempotent delivery adapter: rollback,
restart/deduplication, decision history, migration, date boundaries, every digest
category, exact weekly return/loss totals and later-week reversals. No wall-clock
sleep, external model or live messaging is needed.
