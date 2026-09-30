import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ErpService, type Confirmation } from '../src/erp/service.ts';
import { ratio as r } from '../src/erp/exact.ts';
const c = (id: string): Confirmation => ({ operationId: id, actorId: 'alice', channel: 'cli', confirmationId: id, confirmed: true });
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-followups-')), path = join(dir, 'db');
  let now = '2026-09-21T02:00:00Z', fail = false;
  const options = { clock: () => new Date(now), beforeCommit: () => { if (fail) throw new Error('injected'); } };
  let s = new ErpService(path, options);
  t.after(() => { s.close(); rmSync(dir, { recursive: true, force: true }); });
  return { get s() { return s; }, path, at(value: string) { now = value; }, fail(value: boolean) { fail = value; },
    reopen(old = false) { s.close(); if (old) { const db = new DatabaseSync(path); db.exec('DROP TABLE operation_drafts; DROP TABLE draft_events; DROP TABLE notification_events; DROP TABLE followup_history; DROP TABLE followups; DROP TABLE hermes_events; DROP TABLE hermes_displays; DROP TABLE web_auth; DROP TABLE web_security_events; PRAGMA user_version =7'); db.close(); } s = new ErpService(path, options); } };
}
test('ERP followups: immediate event is atomic, durable, attributed and idempotent', t => {
  const f = fixture(t); f.fail(true);
  assert.throws(() => f.s.createProduct({ name: '商品', stockUnit: '件' }, c('p')), /injected/);
  assert.deepEqual(f.s.listFollowups(), []); assert.deepEqual(f.s.listNotifications(), []);
  f.fail(false); const p = f.s.createProduct({ name: '商品', stockUnit: '件' }, c('p'));
  f.s.createProduct({ name: '商品', stockUnit: '件' }, c('p')); f.reopen();
  assert.equal(f.s.listNotifications().length, 1);
  assert.deepEqual(f.s.listFollowups()[0]!.evidence, [p.id]);
  assert.equal(f.s.listFollowups()[0]!.responsibleOperator, 'alice');
  f.s.runScheduler(); f.s.runScheduler(); f.reopen(); f.s.runScheduler();
  assert.equal(f.s.listNotifications().filter(e => e.kind === 'daily').length, 1);
  assert.equal(f.s.listNotifications().filter(e => e.kind === 'weekly').length, 1);
});
test('ERP followups: decisions require reason, survive restart, defer until clock and preserve audit', t => {
  const f = fixture(t); f.s.createProduct({ name: '商品', stockUnit: '件' }, c('p'));
  const id = f.s.listFollowups()[0]!.id;
  assert.throws(() => f.s.decideFollowup({ id, status: 'ignored', reason: ' ' }, c('bad')));
  assert.throws(() => f.s.decideFollowup({ id, status: 'deferred', reason: '明天', until: '2020-01-01' }, c('bad')));
  const input = { id, status: 'deferred', reason: '明天补资料', until: '2026-09-22T02:00:00Z' };
  const d = f.s.decideFollowup(input, c('defer')); f.reopen();
  assert.deepEqual(f.s.decideFollowup(input, c('defer')), d);
  f.s.runScheduler(); assert.equal(f.s.listFollowups()[0]!.status, 'deferred');
  f.at('2026-09-22T02:00:00Z'); f.s.runScheduler(); assert.equal(f.s.listFollowups()[0]!.status, 'open');
  f.s.decideFollowup({ id, status: 'ignored', reason: '不使用包装信息' }, c('ignore'));
  f.at('2026-09-23T02:00:00Z'); f.s.runScheduler(); assert.equal(f.s.listFollowups()[0]!.status, 'ignored');
  assert.ok(f.s.listAuditEvents().some(a => a.action === 'followup_decision' && a.actorId === 'alice'));
  assert.equal(f.s.listFollowupHistory().filter(h => h.operationId === 'defer').length, 1);
  f.s.decideFollowup({ id, status: 'resolved', reason: '人工确认完成' }, c('resolve'));
  f.s.runScheduler(); assert.equal(f.s.listFollowups()[0]!.status, 'resolved');
});
test('ERP followups: delivery adapter retries stable IDs after failure and acknowledgment survives restart', async t => {
  const f = fixture(t); f.s.createProduct({ name: '商品', stockUnit: '件' }, c('p'));
  const received = new Set<string>(); let fail = true;
  const adapter = { async deliver(e: { id: string }) { received.add(e.id); if (fail) throw new Error('ack lost'); } };
  await assert.rejects(f.s.deliverNotifications(adapter), /ack lost/); f.reopen(); fail = false;
  await f.s.deliverNotifications(adapter); assert.equal(received.size, 1);
  f.reopen(); await f.s.deliverNotifications({ async deliver() { assert.fail('already delivered'); } });
});
function business(f: ReturnType<typeof fixture>) {
  const s = f.s, p = s.createProduct({ name: '商品', stockUnit: '件' }, c('p'));
  const w = s.createWarehouse({ name: '仓库' }, c('w')), supplier = s.createSupplier({ name: '供应商' }, c('supplier'));
  const customer = s.createCustomer({ name: '客户' }, c('customer'));
  s.updateProductDetails({ productId: p.id, expectedRevision: 1, aliases: [], specification: '标准', barcode: null, shelfLifeDays: 10 }, c('details'));
  s.confirmPurchaseReceipt({ supplierId: supplier.id, warehouseId: w.id, dueDate: '2026-09-20', lines: [{ productId: p.id, unit: '件', quantity: '10', amountCents: '1000', earliestProductionDate: '2026-09-20' }] }, c('purchase'));
  s.createSalesOrder({ customerId: customer.id, warehouseId: w.id, lines: [{ productId: p.id, unit: '件', quantity: '2', amountCents: '500' }] }, c('order'));
  s.confirmDelivery({ orderId: 'order', expectedRevision: 1, dueDate: '2026-09-20', lines: [{ orderLineIndex: 0, quantity: '2', amountCents: '500' }] }, c('delivery'));
  return { p, w, customer, supplier };
}
test('ERP followups: digest includes all sources and settlement clears actionable evidence', t => {
  const f = fixture(t), { p, w, customer } = business(f);
  f.s.receiveQuarantinedReturn({ customerId: customer.id, productId: p.id, warehouseId: w.id, quantity: r(1n), condition: 'unknown', reason: '来源未知' }, c('q'));
  f.s.recordStocktake({ productId: p.id, warehouseId: w.id, physicalQuantity: r(7n), reason: '盘点' }, c('count'));
  f.s.runScheduler();
  const daily = f.s.listNotifications().find(e => e.kind === 'daily')!.payload as { outstanding: { kind: string }[] };
  assert.deepEqual(new Set(daily.outstanding.map(f => f.kind)), new Set(['incomplete_product','workflow_gap','delivery_without_receipt','overdue_settlement','managed_expiry','unresolved_return','stock_exception']));
  f.s.confirmSettlement(f.s.previewSettlement({ kind: 'customer_receipt', partyId: customer.id, amountCents: '500' }), c('cash'));
  assert.equal(f.s.listFollowups().find(f => f.id === 'delivery_without_receipt:delivery')!.status, 'resolved');
  assert.equal(f.s.listFollowups().find(f => f.id === 'overdue_settlement:delivery')!.status, 'resolved');
});
test('ERP followups: weekly totals use dated ledger deltas, exact cost, returns and loss', t => {
  const f = fixture(t), { p, w, customer } = business(f);
  f.s.confirmSettlement(f.s.previewSettlement({ kind: 'customer_receipt', partyId: customer.id, amountCents: '200' }), c('cash'));
  f.s.confirmReturn({ kind: 'sale', originId: 'delivery', lineIndex: 0, quantity: r(1n), condition: 'saleable', reason: '退回' }, c('return'));
  f.s.confirmLoss({ productId: p.id, warehouseId: w.id, quantity: r(1n), reason: '破损' }, c('loss'));
  f.at('2026-09-28T02:00:00Z'); f.s.runScheduler();
  const weekly = f.s.listNotifications().find(e => e.kind === 'weekly')!.payload as Record<string, unknown>;
  assert.equal(weekly.startInclusive, '2026-09-21'); assert.equal(weekly.endExclusive, '2026-09-28');
  assert.equal(weekly.purchaseCents, '1000'); assert.equal(weekly.salesCents, '250');
  assert.deepEqual(weekly.costCents, r(100n)); assert.deepEqual(weekly.grossProfitCents, r(150n));
  assert.deepEqual(weekly.lossCents, r(100n)); assert.deepEqual(weekly.grossProfitAfterKnownLossCents, r(50n));
  assert.equal(weekly.netCollectionCents, '200');
  assert.deepEqual(weekly.debtSnapshot, { basis: 'at_generation', receivableCents: '50', payableCents: '1000' });
});
test('ERP followups: v7 migration discovers existing evidence, Shanghai midnight splits digests', t => {
  const f = fixture(t); business(f); f.reopen(true); assert.deepEqual(f.s.listFollowups(), []);
  f.at('2026-09-27T15:59:00Z'); f.s.runScheduler(); assert.ok(f.s.listFollowups().length > 0);
  f.at('2026-09-27T16:00:00Z'); f.s.runScheduler(); f.reopen(); f.s.runScheduler();
  assert.deepEqual(f.s.listNotifications().filter(e => e.kind === 'daily').map(e => e.id), ['daily:2026-09-27','daily:2026-09-28']);
});
test('ERP followups: failed scheduler and decisions leave no partial history or notifications', t => {
  const f = fixture(t); f.s.createProduct({ name: '商品', stockUnit: '件' }, c('p'));
  const before = f.s.listFollowups(), history = f.s.listFollowupHistory(), events = f.s.listNotifications();
  f.fail(true);
  assert.throws(() => f.s.decideFollowup({ id: before[0]!.id, status: 'ignored', reason: '测试' }, c('ignore')), /injected/);
  assert.throws(() => f.s.runScheduler(), /injected/);
  assert.deepEqual(f.s.listFollowups(), before); assert.deepEqual(f.s.listFollowupHistory(), history); assert.deepEqual(f.s.listNotifications(), events);
  f.fail(false); f.s.runScheduler(); assert.equal(f.s.listNotifications().length, 3);
});
test('ERP followups: later-week reversals are negative flows without rewriting prior weekly report', t => {
  const f = fixture(t), { customer } = business(f);
  f.s.confirmSettlement(f.s.previewSettlement({ kind: 'customer_receipt', partyId: customer.id, amountCents: '500' }), c('cash'));
  f.at('2026-09-28T02:00:00Z'); f.s.runScheduler();
  const original = f.s.listNotifications().find(e => e.kind === 'weekly');
  f.s.confirmReversal({ kind: 'settlement', originId: 'cash', reason: '冲销' }, c('cash-reverse'));
  f.s.confirmReversal({ kind: 'sale', originId: 'delivery', reason: '冲销' }, c('sale-reverse'));
  f.s.confirmReversal({ kind: 'purchase', originId: 'purchase', reason: '冲销' }, c('purchase-reverse'));
  f.at('2026-10-05T02:00:00Z'); f.s.runScheduler();
  assert.deepEqual(f.s.listNotifications().find(e => e.id === original!.id), original);
  const weekly = f.s.listNotifications().find(e => e.id === 'weekly:2026-09-28')!.payload as Record<string, unknown>;
  assert.equal(weekly.purchaseCents, '-1000'); assert.equal(weekly.salesCents, '-500');
  assert.equal(weekly.netCollectionCents, '-500'); assert.deepEqual(weekly.costCents, r(-200n));
  assert.deepEqual(weekly.grossProfitCents, r(-300n));
});
