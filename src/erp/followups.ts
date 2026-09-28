import type { DatabaseSync } from 'node:sqlite';
import { BusinessError, type ErpService, type Confirmation } from './service.ts';
import { add, subtract, ratio, zero, compare, type Rational } from './exact.ts';

export interface Followup {
  id: string; kind: string; evidence: string[]; detail: unknown; responsibleOperator: string;
  status: 'open' | 'deferred' | 'resolved' | 'ignored'; createdAt: string; updatedAt: string;
  reason: string | null; remindAt: string | null; sourceActive: boolean;
}
export interface FollowupDecision { id: string; status: 'resolved' | 'deferred' | 'ignored'; reason: string; until?: string }
export interface NotificationEvent { id: string; kind: 'immediate' | 'daily' | 'weekly'; createdAt: string; payload: unknown }
interface History { followupId: string; at: string; status: Followup['status']; reason: string; actorId: string; operationId?: string }
/** Internal persistence module; all calls run through the service transaction boundary. */
export class FollowupStore {
  private db: DatabaseSync; private service: ErpService;
  constructor(db: DatabaseSync, service: ErpService) { this.db = db; this.service = service; }
  list(): Followup[] { return this.db.prepare('SELECT document FROM followups ORDER BY id').all().map(r => JSON.parse(String(r.document))); }
  history(): History[] { return this.db.prepare('SELECT document FROM followup_history ORDER BY id').all().map(r => JSON.parse(String(r.document))); }
  events(): NotificationEvent[] { return this.db.prepare('SELECT document FROM notification_events ORDER BY rowid').all().map(r => JSON.parse(String(r.document))); }
  pending(): NotificationEvent[] { return this.db.prepare('SELECT document FROM notification_events WHERE delivered = 0 ORDER BY rowid').all().map(r => JSON.parse(String(r.document))); }
  ack(id: string) { this.db.prepare('UPDATE notification_events SET delivered = 1 WHERE id = ?').run(id); }
  private save(f: Followup) { this.db.prepare('INSERT INTO followups VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(f.id, JSON.stringify(f)); }
  private record(h: History) { this.db.prepare('INSERT INTO followup_history(document) VALUES (?)').run(JSON.stringify(h)); }
  private emit(event: NotificationEvent) { this.db.prepare('INSERT OR IGNORE INTO notification_events(id, document) VALUES (?, ?)').run(event.id, JSON.stringify(event)); }
  decide(input: FollowupDecision, now: string, context: Confirmation): Followup {
    const f = this.list().find(f => f.id === input.id);
    if (!f) throw new BusinessError('not_found', 'Unknown follow-up');
    if (input.status === 'deferred' ? (!input.until || !Number.isFinite(Date.parse(input.until)) || new Date(input.until).toISOString() <= now) : input.until !== undefined)
      throw new BusinessError('invalid_input', 'Deferral needs a future timestamp; other decisions cannot set a reminder');
    f.status = input.status; f.reason = input.reason; f.remindAt = input.status === 'deferred' ? new Date(input.until!).toISOString() : null;
    f.updatedAt = now; f.responsibleOperator = context.actorId;
    this.save(f); this.record({ followupId: f.id, at: now, status: f.status, reason: input.reason, actorId: context.actorId, operationId: context.operationId });
    return f;
  }
  refresh(now: string, actor: string) {
    const s = this.service, day = businessDay(now), candidates: { id: string; kind: string; evidence: string[]; detail: unknown }[] = [];
    const put = (kind: string, key: string, evidence: string[], detail: unknown) => candidates.push({ id: `${kind}:${key}`, kind, evidence, detail });
    for (const p of s.listProductFollowups().filter(p => p.status === 'open')) put('incomplete_product', p.productId, [p.productId], p);
    for (const q of s.listReturnFollowups().filter(q => q.status === 'open')) put('unresolved_return', q.quarantineId, [q.quarantineId], q);
    const reversals = s.listReversals();
    for (const r of s.listPurchaseReceipts().filter(r => !reversals.some(v => v.originId === r.id && v.kind === 'purchase')))
      put('workflow_gap', r.id, [r.id], { reason: 'Purchase order evidence is not recorded in the current receipt model' });
    for (const row of s.listOpenReceivables()) put('delivery_without_receipt', row.deliveryId, [row.deliveryId], row);
    for (const kind of ['customer', 'supplier'] as const) for (const party of s.listMasters(kind)) {
      for (const o of s.listOpenObligations({ kind: kind === 'customer' ? 'customer_receipt' : 'supplier_payment', partyId: party.id }))
        if (o.dueDate < day) put('overdue_settlement', o.obligationId, [o.obligationId, party.id], { ...o, partyKind: kind });
    }
    const through = shiftDay(day, 30);
    for (const e of s.listManagedExpiry()) if (e.managedExpiryDate && e.managedExpiryDate <= through && compare(s.getStock(e.productId, e.warehouseId).quantity, zero()) > 0)
      put('managed_expiry', `${e.receiptId}:${e.lineIndex}`, [e.receiptId, e.productId], { ...e, batchRemaining: 'unknown', warning: 'Operational estimate; verify physical batch availability' });
    const inventory = s.listInventoryOperations();
    for (const count of s.listStocktakes()) if (compare(count.difference, zero()) !== 0 && !inventory.some(i => i.stocktakeId === count.id))
      put('stock_exception', count.id, [count.id, count.productId], count);
    const existing = new Map(this.list().map(f => [f.id, f]));
    for (const c of candidates) {
      let f = existing.get(c.id);
      const fresh = !f;
      if (!f) f = { ...c, responsibleOperator: actor, status: 'open', createdAt: now, updatedAt: now, reason: null, remindAt: null, sourceActive: true };
      const reopened = !f.sourceActive;
      if (reopened || (f.status === 'deferred' && f.remindAt! <= now)) {
        f.status = 'open'; f.reason = null; f.remindAt = null;
        this.record({ followupId: f.id, at: now, status: 'open', reason: reopened ? 'Source became actionable again' : 'Deferral elapsed', actorId: 'system' });
      }
      if (fresh) this.record({ followupId: f.id, at: now, status: 'open', reason: 'Actionable evidence detected', actorId: 'system' });
      if (JSON.stringify(f.detail) !== JSON.stringify(c.detail) || reopened) f.updatedAt = now;
      f.detail = c.detail; f.sourceActive = true; this.save(f);
      if (f.status === 'open' && (fresh || reopened)) this.emit({ id: `immediate:${f.id}:${day}`, kind: 'immediate', createdAt: now, payload: f });
    }
    const active = new Set(candidates.map(c => c.id));
    for (const f of existing.values()) if (!active.has(f.id) && f.sourceActive) {
      f.sourceActive = false; f.status = 'resolved'; f.reason = 'Source condition cleared'; f.remindAt = null; f.updatedAt = now; this.save(f);
      this.record({ followupId: f.id, at: now, status: 'resolved', reason: f.reason, actorId: 'system' });
    }
  }
  schedule(now: string) {
    const day = businessDay(now), outstanding = this.list().filter(f => f.status === 'open');
    // Daily and weekly snapshots are immutable. Repeated ticks/restarts do not regenerate them.
    this.emit({ id: `daily:${day}`, kind: 'daily', createdAt: now, payload: { day, timezone: 'Asia/Shanghai', outstanding,
      deferred: this.list().filter(f => f.status === 'deferred'), categories: ['workflow_gap', 'incomplete_product', 'unresolved_return', 'overdue_settlement', 'delivery_without_receipt', 'managed_expiry', 'stock_exception'] } });
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const end = shiftDay(day, -((weekday + 6) % 7)), start = shiftDay(end, -7);
    this.emit({ id: `weekly:${start}`, kind: 'weekly', createdAt: now, payload: this.weekly(start, end) });
  }
  private weekly(start: string, end: string) {
    const s = this.service, within = (at: string) => businessDay(at) >= start && businessDay(at) < end;
    let purchase = 0n, sales = 0n, collection = 0n, cost: Rational = zero(), loss: Rational = zero();
    const evidence: string[] = [];
    for (const r of s.listPurchaseReceipts().filter(r => within(r.postedAt))) { purchase += BigInt(r.totalCents); evidence.push(r.id); }
    for (const d of s.listDeliveries().filter(d => within(d.postedAt))) { sales += BigInt(d.totalCents); cost = add(cost, d.costCents); evidence.push(d.id); }
    for (const r of s.listReturns().filter(r => within(r.postedAt))) { if (r.kind === 'purchase') purchase -= BigInt(r.amountCents); sales += BigInt(r.revenueCents); cost = add(cost, r.costCents); loss = add(loss, r.lossCents); evidence.push(r.id); }
    for (const r of s.listReversals().filter(r => within(r.postedAt))) {
      if (r.kind === 'purchase') purchase += BigInt(r.obligationCents);
      sales += BigInt(r.revenueCents); cost = add(cost, r.costCents);
      if (r.kind === 'settlement' && s.listSettlements().find(x => x.id === r.originId)?.kind === 'customer_receipt') collection += BigInt(r.cashCents);
      evidence.push(r.id);
    }
    for (const r of s.listSettlements().filter(r => within(r.postedAt) && r.kind === 'customer_receipt')) { collection += BigInt(r.amountCents); evidence.push(r.id); }
    for (const r of s.listReturnRefunds().filter(r => within(r.postedAt) && r.direction === 'outgoing')) { collection -= BigInt(r.amountCents); evidence.push(r.id); }
    for (const r of s.listInventoryOperations().filter(r => within(r.postedAt))) { loss = add(loss, r.lossCents); evidence.push(r.id); }
    const history = this.history().filter(h => within(h.at));
    return { startInclusive: start, endExclusive: end, timezone: 'Asia/Shanghai', currency: 'CNY', purchaseCents: String(purchase), salesCents: String(sales),
      costCents: cost, grossProfitCents: subtract(ratio(sales), cost), lossCents: loss,
      grossProfitAfterKnownLossCents: subtract(subtract(ratio(sales), cost), loss), netCollectionCents: String(collection), evidence,
      // Explicitly current snapshots, not purported historical closing balances.
      debtSnapshot: { basis: 'at_generation', receivableCents: String(s.listOpenReceivables().reduce((n, r) => n + BigInt(r.openCents), 0n)), payableCents: String(s.listOpenPayables().reduce((n, r) => n + BigInt(r.openCents), 0n)) },
      expirySnapshot: s.summarizeManagedExpiry(end), unvaluedLosses: s.listQuarantineResolutions().filter(r => within(r.postedAt) && r.outcome.kind === 'confirmed_loss').map(r => r.id),
      followupTrends: { opened: history.filter(h => h.status === 'open').length, resolved: history.filter(h => h.status === 'resolved').length,
        deferred: history.filter(h => h.status === 'deferred').length, ignored: history.filter(h => h.status === 'ignored').length, outstandingNow: this.list().filter(f => f.status === 'open').length } };
  }
}
function businessDay(now: string): string { return new Date(Date.parse(now) + 8 * 3600000).toISOString().slice(0, 10); }
function shiftDay(day: string, delta: number): string { return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10); }
