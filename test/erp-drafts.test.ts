import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { ErpService, type Confirmation } from '../src/erp/service.ts';
import type { DraftAction, DraftReply } from '../src/erp/drafts.ts';
const c = (id: string): Confirmation => ({ operationId: id, actorId: 'a', channel: 'cli', confirmationId: id, confirmed: true });
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-drafts-')), path = join(dir, 'db.sqlite');
  let now = '2026-09-28T01:00:00Z';
  let fail = false, s = new ErpService(path, { clock: () => new Date(now), beforeCommit() { if (fail) throw new Error('injected'); } });
  t.after(() => { s.close(); rmSync(dir, { recursive: true, force: true }); });
  const p = s.createProduct({ name: '饮料', stockUnit: '瓶' }, c('p'));
  const w = s.createWarehouse({ name: '主仓' }, c('w'));
  const supplier = s.createSupplier({ name: '供应商' }, c('s'));
  const customer = s.createCustomer({ name: '客户' }, c('c'));
  const input = { supplierId: supplier.id, warehouseId: w.id, lines: [{ productId: p.id, unit: '瓶', quantity: '3', amountCents: '100' }] };
  return { get s() { return s; }, p, w, supplier, customer, input, path,
    send(eventId: string, action: DraftAction, conversationId = 'chat', actorId = 'operator'): DraftReply {
      return s.handleDraft({ actorId, channel: 'hermes', conversationId, eventId }, action);
    },
    propose(event = 'propose', expectedVersion?: number) { return this.send(event, { action: 'propose', command: { kind: 'purchase_receipt', input }, expectedVersion }); },
    time(value: string) { now = value; },
    stock() { return s.getStock(p.id, w.id); }, fail(value: boolean) { fail = value; },
    reopen(migrate = false) { s.close(); if (migrate) { const db = new DatabaseSync(path);
      db.exec('DROP TABLE operation_drafts; DROP TABLE draft_events; PRAGMA user_version = 8;'); db.close(); } s = new ErpService(path, { clock: () => new Date(now) }); },
  };
}
test('ERP drafts: preview has no business effects; correction replaces version; plain confirmation posts latest once', t => {
  const f = setup(t), audit = f.s.listAuditEvents(), notifications = f.s.listNotifications();
  const first = f.propose(); assert.equal(first.status, 'draft');
  assert.equal(f.s.listPurchaseReceipts().length, 0); assert.equal(f.stock().quantity.numerator, '0');
  assert.deepEqual(f.s.listAuditEvents(), audit); assert.deepEqual(f.s.listNotifications(), notifications);
  assert.match(JSON.stringify(first), /供应商/); assert.match(JSON.stringify(first), /瓶/); assert.match(JSON.stringify(first), /payables/);
  f.input.lines[0]!.quantity = '2'; const second = f.propose('correct', 1);
  assert.equal(second.status, 'draft'); if (second.status === 'draft') assert.equal(second.draft.version, 2);
  assert.deepEqual(f.send('stale', { action: 'confirm', expectedVersion: 1 }), { status: 'rejected', reason: 'stale_version', nextAction: 'review_latest' });
  const result = f.send('yes', { action: 'confirm' }); assert.equal(result.status, 'posted');
  assert.equal(f.stock().quantity.numerator, '2'); assert.equal(f.s.listPurchaseReceipts().length, 1);
  assert.deepEqual(f.send('yes', { action: 'confirm' }), result);
  assert.deepEqual(f.send('another-yes', { action: 'confirm' }), result);
  const last = f.s.listAuditEvents().at(-1)!;
  assert.equal(last.actorId, 'operator'); assert.equal(last.channel, 'hermes'); assert.equal(last.confirmationId, 'yes');
  assert.match(JSON.stringify(last), /"draftVersion":2/);
  f.reopen(); assert.deepEqual(f.send('yes', { action: 'confirm' }), result);
  f.propose('new', 2); assert.deepEqual(f.send('yes', { action: 'confirm' }), result);
  assert.equal(f.s.listPurchaseReceipts().length, 1);
});
test('ERP drafts: duplicate proposal cannot replace a correction and event collisions are rejected', t => {
  const f = setup(t), original = f.propose(); f.propose('correct', 1);
  assert.deepEqual(f.propose(), original);
  assert.throws(() => f.send('propose', { action: 'cancel' }), /Event ID/);
  const result = f.send('yes', { action: 'confirm' }); assert.equal(result.status, 'posted');
  if (result.status === 'posted') assert.equal(result.version, 2);
});
test('ERP drafts: cancellation, invalid correction, unknown operations and isolated conversations cannot post', t => {
  const f = setup(t); f.propose();
  assert.equal(f.send('yes-other', { action: 'confirm' }, 'other').status, 'rejected');
  assert.equal(f.send('yes-other-actor', { action: 'confirm' }, 'chat', 'other').status, 'rejected');
  assert.equal(f.send('cancel', { action: 'cancel' }).status, 'cancelled');
  assert.equal(f.send('yes', { action: 'confirm' }).status, 'rejected');
  f.propose('new', 1);
  assert.equal(f.send('bad', { action: 'propose', expectedVersion: 2, command: { kind: 'purchase_receipt', input: {} } }).status, 'rejected');
  assert.equal(f.send('yes2', { action: 'confirm' }).status, 'rejected');
  assert.equal(f.send('sql', { action: 'propose', expectedVersion: 2, command: { kind: 'exec', input: 'DELETE' } }).status, 'rejected');
  assert.equal(f.s.listPurchaseReceipts().length, 0);
});
test('ERP drafts: changed state requires a new reviewed draft', t => {
  const f = setup(t); f.propose(); f.s.confirmPurchaseReceipt(f.input, c('external'));
  const reply = f.send('yes', { action: 'confirm' });
  assert.deepEqual(reply, { status: 'rejected', reason: 'business_state_changed', nextAction: 'create_draft' });
  f.propose('refresh', 1); assert.equal(f.send('yes2', { action: 'confirm' }).status, 'posted');
  assert.equal(f.s.listPurchaseReceipts().length, 2);
});
test('ERP drafts: failure rolls back posting, draft status, audit, followups and retry receipt together', t => {
  const f = setup(t); f.propose(); const audit = f.s.listAuditEvents(), followups = f.s.listFollowups();
  f.fail(true); assert.throws(() => f.send('yes', { action: 'confirm' }), /injected/);
  assert.equal(f.s.listPurchaseReceipts().length, 0); assert.deepEqual(f.s.listAuditEvents(), audit);
  assert.deepEqual(f.s.listFollowups(), followups); assert.equal(f.stock().quantity.numerator, '0');
  f.fail(false); assert.equal(f.send('yes', { action: 'confirm' }).status, 'posted');
  assert.equal(f.s.listPurchaseReceipts().length, 1);
});
test('ERP drafts: combined delivery and receipt preview then post separate linked ledger effects', t => {
  const f = setup(t); f.s.confirmPurchaseReceipt(f.input, c('receipt'));
  const order = f.s.createSalesOrder({ customerId: f.customer.id, warehouseId: f.w.id,
    lines: [{ productId: f.p.id, unit: '瓶', quantity: '1', amountCents: '70' }] }, c('order'));
  const draft = f.send('sale', { action: 'propose', command: { kind: 'delivery_and_receipt', input: {
    delivery: { orderId: order.id, expectedRevision: 1, lines: [{ orderLineIndex: 0, quantity: '1', amountCents: '70' }] }, amountCents: '50' } } });
  assert.equal(draft.status, 'draft'); assert.equal(f.s.listDeliveries().length, 0); assert.equal(f.s.listSettlements().length, 0);
  assert.equal(f.send('yes', { action: 'confirm' }).status, 'posted');
  assert.equal(f.s.listOpenReceivables()[0]!.openCents, '20'); assert.equal(f.s.listSettlements()[0]!.amountCents, '50');
});
test('ERP drafts: settlement allocation and transfer are previewed without durable effects', t => {
  const f = setup(t); f.s.confirmPurchaseReceipt(f.input, c('receipt'));
  const settlement = f.send('pay', { action: 'propose', command: { kind: 'settlement', input: {
    kind: 'supplier_payment', partyId: f.supplier.id, amountCents: '120' } } });
  assert.equal(settlement.status, 'draft'); assert.match(JSON.stringify(settlement), /supplier_prepayment/);
  assert.equal(f.s.listSettlements().length, 0); assert.equal(f.send('yes', { action: 'confirm' }).status, 'posted');
  const dest = f.s.createWarehouse({ name: '目标仓' }, c('dest'));
  const transfer = f.send('move', { action: 'propose', expectedVersion: 1, command: { kind: 'transfer', input: {
    productId: f.p.id, warehouseId: f.w.id, destinationId: dest.id, quantity: { numerator: '1', denominator: '1' }, reason: '调拨' } } });
  assert.equal(transfer.status, 'draft'); assert.equal(f.stock().quantity.numerator, '3');
  assert.equal(f.send('yes2', { action: 'confirm' }).status, 'posted'); assert.equal(f.stock().quantity.numerator, '2');
});
test('ERP drafts: migration from v8 preserves business state; pending drafts survive reopen', t => {
  const f = setup(t); f.s.confirmPurchaseReceipt(f.input, c('receipt')); f.reopen(true);
  const service = new ErpService(f.path, { clock: () => new Date('2026-09-28T01:00:00Z') });
  try {
    assert.equal(service.listPurchaseReceipts().length, 1);
    assert.equal(service.handleDraft({ actorId: 'a', channel: 'web', conversationId: 'chat', eventId: 'p' },
      { action: 'propose', command: { kind: 'purchase_receipt', input: f.input } }).status, 'draft');
  } finally { service.close(); }
  f.reopen();
  assert.equal(f.s.handleDraft({ actorId: 'a', channel: 'web', conversationId: 'chat', eventId: 'yes' }, { action: 'confirm' }).status, 'posted');
});

test('ERP drafts: simultaneous duplicate confirmations from independent connections post once', { timeout: 15000 }, async t => {
  const f = setup(t); f.propose(); const gate = new SharedArrayBuffer(4);
  const launch = () => {
    const worker = new Worker(`const { parentPort, workerData: d } = require('node:worker_threads');
      (async () => { const { ErpService } = await import(d.url); const s = new ErpService(d.path, { clock: () => new Date('2026-09-28T01:00:00Z') });
        parentPort.postMessage('ready'); Atomics.wait(new Int32Array(d.gate), 0, 0);
        try { parentPort.postMessage(s.handleDraft({ actorId: 'operator', channel: 'hermes', conversationId: 'chat', eventId: 'yes' }, { action: 'confirm' })); }
        finally { s.close(); } })();`, { eval: true, workerData: { path: f.path, gate, url: new URL('../src/erp/service.ts', import.meta.url).href } });
    t.after(async () => { await worker.terminate(); });
    const ready = new Promise<void>((resolve, reject) => { worker.on('message', m => { if (m === 'ready') resolve(); }); worker.on('error', reject); });
    const result = new Promise<DraftReply>((resolve, reject) => { worker.on('message', m => { if (m !== 'ready') resolve(m); }); worker.on('error', reject); });
    return { ready, result };
  };
  const a = launch(), b = launch(); await Promise.all([a.ready, b.ready]);
  Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  const [first, second] = await Promise.all([a.result, b.result]); assert.equal(first.status, 'posted'); assert.deepEqual(second, first);
  assert.equal(f.s.listPurchaseReceipts().length, 1); assert.equal(f.stock().quantity.numerator, '3');
});

test('ERP drafts: crossing a business date requires refreshed defaults and invalid protocol fields cannot confirm', t => {
  const f = setup(t); f.propose();
  assert.throws(() => f.send('bad', JSON.parse('{"action":"confirm","confirmed":false}')), /Invalid draft/);
  f.time('2026-09-29T01:00:00Z');
  assert.deepEqual(f.send('yes', { action: 'confirm' }), { status: 'rejected', reason: 'business_state_changed', nextAction: 'create_draft' });
  assert.equal(f.s.listPurchaseReceipts().length, 0);
});
test('ERP drafts: failed proposal commit leaves no draft or event and the same event can be retried', t => {
  const f = setup(t); f.fail(true); assert.throws(() => f.propose(), /injected/);
  f.fail(false); assert.deepEqual(f.send('yes', { action: 'confirm' }), { status: 'rejected', reason: 'no_current_draft', nextAction: 'create_draft' });
  assert.equal(f.propose().status, 'draft'); assert.equal(f.send('yes2', { action: 'confirm' }).status, 'posted');
});
