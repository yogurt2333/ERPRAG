import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { ErpService, BusinessError, type Confirmation } from '../src/erp/service.ts';
import { ratio as r, zero, add } from '../src/erp/exact.ts';

const c = (id: string): Confirmation => ({ operationId: id, actorId: 'operator', channel: 'cli', confirmationId: id, confirmed: true });
const code = (value: string) => (e: unknown) => e instanceof BusinessError && e.code === value;
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-inventory-')), path = join(dir, 'erp.sqlite');
  let fail = false, s = new ErpService(path, { beforeCommit() { if (fail) throw new Error('injected'); } });
  t.after(() => { s.close(); rmSync(dir, { recursive: true, force: true }); });
  const p = s.createProduct({ name: '合成商品', stockUnit: '瓶' }, c('p'));
  const w = s.createWarehouse({ name: '源仓' }, c('w')), dest = s.createWarehouse({ name: '目标仓' }, c('dest'));
  const supplier = s.createSupplier({ name: '供应商' }, c('supplier'));
  const customer = s.createCustomer({ name: '客户' }, c('customer'));
  const scope = { productId: p.id, warehouseId: w.id };
  const issue = { ...scope, quantity: r(1n), reason: '实物确认' };
  return { get s() { return s; }, path, scope, issue, dest,
    stock: (warehouseId = w.id) => s.getStock(p.id, warehouseId),
    receive(id = 'receipt', quantity = '3', amountCents = '100') { return s.confirmPurchaseReceipt({ supplierId: supplier.id,
      warehouseId: w.id, lines: [{ productId: p.id, unit: '瓶', quantity, amountCents }] }, c(id)); },
    count(n: bigint, id = 'count') { return s.recordStocktake({ ...scope, physicalQuantity: r(n), reason: '现场盘点' }, c(id)); },
    order() { return s.createSalesOrder({ customerId: customer.id, warehouseId: w.id,
      lines: [{ productId: p.id, unit: '瓶', quantity: '1', amountCents: '60' }] }, c('order')); },
    fail(value: boolean) { fail = value; },
    reopen(v6 = false) { s.close(); if (v6) { const db = new DatabaseSync(path);
      db.exec('DROP TABLE inventory_operations; DROP TABLE stocktakes; DROP TABLE operation_drafts; DROP TABLE draft_events; DROP TABLE notification_events; DROP TABLE followup_history; DROP TABLE followups; DROP TABLE hermes_events; DROP TABLE hermes_displays; DROP TABLE web_auth; DROP TABLE web_security_events; PRAGMA user_version = 6;'); db.close(); }
      s = new ErpService(path); }
  };
}
const adjustment = (stocktakeId = 'count') => ({ stocktakeId, reason: '排查后无法还原来源', outcome: { kind: 'adjustment' as const } });

test('ERP inventory: count is durable and read-only for stock; reasoned adjustments preserve history and retries', t => {
  const f = fixture(t), receipt = f.receive();
  const count = f.count(2n);
  assert.deepEqual(count.difference, r(-1n)); assert.deepEqual(f.stock().quantity, r(3n));
  const preview = f.s.previewStocktakeResolution(adjustment());
  assert.deepEqual(preview.stock[0]!.valueCents, r(-100n, 3n));
  assert.equal(f.s.listInventoryOperations().length, 0);
  f.fail(true); assert.throws(() => f.s.confirmStocktakeResolution(adjustment(), c('adjust')), /injected/);
  assert.deepEqual(f.stock().quantity, r(3n)); assert.equal(f.s.listInventoryOperations().length, 0);
  assert.equal(f.s.listAuditEvents().some(e => e.recordId === 'adjust'), false);
  f.fail(false); const posted = f.s.confirmStocktakeResolution(adjustment(), c('adjust'));
  assert.deepEqual(f.stock().quantity, r(2n)); assert.deepEqual(f.stock().valueCents, r(200n, 3n));
  assert.deepEqual(f.s.getPurchaseReceipt(receipt.id), receipt);
  assert.deepEqual(f.s.getInventoryTotals().adjustmentValueCents, r(-100n, 3n));
  assert.deepEqual(f.s.getInventoryTotals().lossCents, zero());
  f.reopen(); assert.deepEqual(f.s.listStocktakes()[0], count);
  assert.deepEqual(f.s.confirmStocktakeResolution(adjustment(), c('adjust')), posted);
  assert.throws(() => f.s.confirmStocktakeResolution(adjustment(), c('again')), code('conflict'));
  assert.throws(() => f.s.confirmStocktakeResolution({ ...adjustment(), reason: '变化' }, c('adjust')), code('idempotency_conflict'));
});

test('ERP inventory: missing receipt and delivery are restored through their business ledgers, not adjustments', t => {
  const f = fixture(t); f.receive(); f.count(4n);
  const resolve = { stocktakeId: 'count', reason: '发现漏记入库', outcome: { kind: 'restored_source', sourceId: 'late' } };
  assert.throws(() => f.s.confirmStocktakeResolution(resolve, c('resolve')), code('conflict'));
  f.receive('late', '1', '40');
  const result = f.s.confirmStocktakeResolution(resolve, c('resolve'));
  assert.deepEqual(result.stock, []); assert.equal(result.sourceId, 'late');
  assert.equal(f.s.listOpenPayables().reduce((sum, p) => sum + BigInt(p.openCents), 0n), 140n);
  f.count(3n, 'sale-count'); f.order();
  f.s.confirmDelivery({ orderId: 'order', expectedRevision: 1, lines: [{ orderLineIndex: 0, quantity: '1', amountCents: '60' }] }, c('delivery'));
  f.s.confirmStocktakeResolution({ stocktakeId: 'sale-count', reason: '漏记发货', outcome: { kind: 'restored_source', sourceId: 'delivery' } }, c('resolve-sale'));
  assert.deepEqual(f.stock().quantity, r(3n)); assert.equal(f.s.listOpenReceivables()[0]!.openCents, '60');
  assert.deepEqual(f.s.getInventoryTotals().adjustmentValueCents, zero());
});

test('ERP inventory: stale counts, invalid scopes and unsupported valuation cannot silently adjust', t => {
  const f = fixture(t); f.count(2n);
  assert.throws(() => f.s.confirmStocktakeResolution(adjustment(), c('adjust')), code('invalid_input'));
  f.s.confirmStocktakeResolution({ ...adjustment(), outcome: { kind: 'adjustment', openingUnitCostCents: '25' } }, c('adjust'));
  assert.deepEqual(f.stock().valueCents, r(50n));
  f.count(1n, 'stale'); f.receive();
  assert.throws(() => f.s.confirmStocktakeResolution(adjustment('stale'), c('stale-adjust')), code('conflict'));
  for (const quantity of [r(0n), r(-1n), { numerator: '1', denominator: '0' }])
    assert.throws(() => f.s.confirmLoss({ ...f.issue, quantity }, c('bad')), code('invalid_input'));
  assert.throws(() => f.s.confirmLoss({ ...f.issue, quantity: r(6n) }, c('bad')), code('insufficient_stock'));
  assert.throws(() => f.s.confirmTransfer({ ...f.issue, destinationId: f.scope.warehouseId }, c('bad')), code('invalid_input'));
  assert.throws(() => f.s.confirmTransfer({ ...f.issue, destinationId: 'missing' }, c('bad')), code('not_found'));
  f.count(0n, 'empty'); f.s.confirmStocktakeResolution(adjustment('empty'), c('empty-adjust'));
  assert.deepEqual(f.stock().quantity, zero()); assert.deepEqual(f.stock().valueCents, zero());
});

test('ERP inventory: a known missing loss resolves the count without a second stock deduction', t => {
  const f = fixture(t); f.receive(); f.count(2n);
  f.s.confirmLoss(f.issue, c('late-loss'));
  const result = f.s.confirmStocktakeResolution({ stocktakeId: 'count', reason: '补录已发生破损',
    outcome: { kind: 'restored_source', sourceId: 'late-loss' } }, c('resolve'));
  assert.deepEqual(result.stock, []); assert.deepEqual(f.stock().quantity, r(2n));
  assert.deepEqual(f.s.getInventoryTotals().lossCents, r(100n, 3n));
  assert.deepEqual(f.s.getInventoryTotals().adjustmentValueCents, zero());
});

test('ERP inventory: transfer conserves exact quantity/value, rolls back atomically and survives migration/reopen', t => {
  const f = fixture(t); f.receive(); f.reopen(true);
  const input = { ...f.issue, destinationId: f.dest.id };
  const first = f.s.confirmTransfer(input, c('transfer'));
  assert.deepEqual(add(f.stock().valueCents, f.stock(f.dest.id).valueCents), r(100n));
  assert.deepEqual(f.stock(f.dest.id).valueCents, r(100n, 3n));
  assert.deepEqual(add(f.stock().quantity, f.stock(f.dest.id).quantity), r(3n));
  f.reopen(); assert.deepEqual(f.s.confirmTransfer(input, c('transfer')), first);
  const failing = new ErpService(f.path, { beforeCommit() { throw new Error('injected'); } });
  try { assert.throws(() => failing.confirmTransfer(input, c('failed-transfer')), /injected/); } finally { failing.close(); }
  assert.deepEqual(f.stock().quantity, r(2n)); assert.deepEqual(f.stock(f.dest.id).quantity, r(1n));
  assert.equal(f.s.listInventoryOperations().length, 1);
  assert.equal(f.s.listAuditEvents().some(e => e.recordId === 'failed-transfer'), false);
});

test('ERP inventory: losses remain separate from sales cost, including damaged returns without double counting', t => {
  const f = fixture(t); f.receive(); f.order();
  f.s.confirmDelivery({ orderId: 'order', expectedRevision: 1, lines: [{ orderLineIndex: 0, quantity: '1', amountCents: '60' }] }, c('delivery'));
  const salesCost = f.s.getSalesTotals().costCents;
  f.fail(true); assert.throws(() => f.s.confirmLoss(f.issue, c('loss')), /injected/);
  assert.deepEqual(f.stock().quantity, r(2n)); assert.deepEqual(f.s.getInventoryTotals().lossCents, zero());
  assert.equal(f.s.listInventoryOperations().length, 0);
  f.fail(false);
  const loss = f.s.confirmLoss(f.issue, c('loss'));
  assert.deepEqual(f.s.confirmLoss(f.issue, c('loss')), loss);
  assert.deepEqual(loss.lossCents, r(100n, 3n)); assert.deepEqual(f.s.getSalesTotals().costCents, salesCost);
  assert.deepEqual(f.s.getInventoryTotals().grossProfitAfterKnownLossCents, r(-20n, 3n));
  f.s.confirmReturn({ kind: 'sale', originId: 'delivery', lineIndex: 0, quantity: r(1n), condition: 'damaged', reason: '破损退回' }, c('return'));
  assert.deepEqual(f.s.getInventoryTotals().lossCents, r(200n, 3n));
  assert.deepEqual(f.s.getInventoryTotals().grossProfitAfterKnownLossCents, r(-200n, 3n));
  assert.deepEqual(f.stock().quantity, r(1n));
  assert.equal(f.s.listAuditEvents().find(e => e.recordId === 'loss')!.actorId, 'operator');
});

test('ERP inventory: a held SQLite writer produces controlled busy, no partial state, and a safe same-ID retry', { timeout: 15000 }, t => {
  const f = fixture(t); f.receive();
  const db = new DatabaseSync(f.path); db.exec('BEGIN IMMEDIATE');
  try { assert.throws(() => f.s.confirmLoss(f.issue, c('locked-loss')), code('busy')); }
  finally { db.exec('ROLLBACK'); db.close(); }
  assert.deepEqual(f.stock().quantity, r(3n)); assert.equal(f.s.listInventoryOperations().length, 0);
  assert.equal(f.s.listAuditEvents().some(e => e.recordId === 'locked-loss'), false);
  const result = f.s.confirmLoss(f.issue, c('locked-loss'));
  assert.deepEqual(f.s.confirmLoss(f.issue, c('locked-loss')), result);
  assert.deepEqual(f.stock().quantity, r(2n));
});

test('ERP inventory: concurrent transfer and loss cannot issue the same final unit', { timeout: 15000 }, async t => {
  const f = fixture(t); f.receive('receipt', '1', '10');
  const gate = new SharedArrayBuffer(4);
  const launch = (method: string, input: unknown, id: string) => {
    const worker = new Worker(`const { parentPort, workerData: d } = require('node:worker_threads');
      (async () => { const { ErpService } = await import(d.url); const s = new ErpService(d.path);
        parentPort.postMessage('ready'); Atomics.wait(new Int32Array(d.gate), 0, 0);
        try { s[d.method](d.input, d.confirmation); parentPort.postMessage('posted'); }
        catch (e) { parentPort.postMessage(e.code || e.message); } finally { s.close(); }
      })();`, { eval: true, workerData: { url: new URL('../src/erp/service.ts', import.meta.url).href,
        path: f.path, gate, method, input, confirmation: c(id) } });
    t.after(async () => { await worker.terminate(); });
    const ready = new Promise<void>((resolve, reject) => { worker.on('message', m => { if (m === 'ready') resolve(); }); worker.on('error', reject); });
    const result = new Promise<string>((resolve, reject) => { worker.on('message', m => { if (m !== 'ready') resolve(m); }); worker.on('error', reject); });
    return { ready, result };
  };
  const a = launch('confirmLoss', f.issue, 'loss'), b = launch('confirmTransfer', { ...f.issue, destinationId: f.dest.id }, 'transfer');
  await Promise.all([a.ready, b.ready]); Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  assert.deepEqual((await Promise.all([a.result, b.result])).sort(), ['insufficient_stock', 'posted']);
  assert.deepEqual(f.stock().quantity, zero()); assert.equal(f.s.listInventoryOperations().length, 1);
});
