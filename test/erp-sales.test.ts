import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ErpService, BusinessError, type Confirmation } from '../src/erp/service.ts';

const c = (id: string): Confirmation => ({ operationId: id, actorId: 'operator', channel: 'cli', confirmationId: id, confirmed: true });
const r = (numerator: string, denominator = '1') => ({ numerator, denominator });
const code = (expected: string) => (error: unknown) => error instanceof BusinessError && error.code === expected;
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-sales-'));
  const path = join(dir, 'erp.sqlite');
  let fail = false;
  let service = new ErpService(path, { beforeCommit: () => { if (fail) throw new Error('injected'); } });
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }); });
  const product = service.createProduct({ name: '合成商品', stockUnit: '瓶' }, c('p'));
  const warehouse = service.createWarehouse({ name: '仓库' }, c('w'));
  const supplier = service.createSupplier({ name: '供应商' }, c('s'));
  const customer = service.createCustomer({ name: '客户' }, c('c'));
  const order = (quantity = '3') => ({ customerId: customer.id, warehouseId: warehouse.id,
    lines: [{ productId: product.id, unit: '瓶', quantity, amountCents: '200' }] });
  const receive = (id: string, quantity = '3', amountCents = '100') => service.confirmPurchaseReceipt({ supplierId: supplier.id,
    warehouseId: warehouse.id, lines: [{ productId: product.id, unit: '瓶', quantity, amountCents }] }, c(id));
  const delivery = (quantity = '1', amountCents = '50', orderId = 'o') => ({ orderId, expectedRevision: 1,
    lines: [{ orderLineIndex: 0, quantity, amountCents }] });
  return { get service() { return service; }, path, product, warehouse, customer, order, receive, delivery,
    fail() { fail = true; }, reopen() { service.close(); service = new ErpService(path); },
    stock() { return service.getStock(product.id, warehouse.id); } };
}

test('ERP sales: demand before stock creates backorder only; partial delivery recognizes exact cost and receivable', t => {
  const f = fixture(t);
  const order = f.service.createSalesOrder(f.order('5'), c('o'));
  assert.deepEqual(f.service.listSalesOrders(), [order]);
  assert.deepEqual(f.service.listMasters('customer'), [f.customer]);
  assert.deepEqual(f.stock().quantity, r('0'));
  assert.deepEqual(f.service.listOpenReceivables(), []);
  assert.deepEqual(f.service.getOrderFulfillment('o').lines[0]!.backorder, r('5'));
  f.receive('r1');
  const sale = f.service.confirmDelivery(f.delivery(), c('d1'));
  assert.deepEqual(sale.costCents, r('100', '3'));
  assert.deepEqual(sale.grossProfitCents, r('50', '3'));
  assert.deepEqual(f.stock().quantity, r('2'));
  assert.deepEqual(f.stock().valueCents, r('200', '3'));
  assert.equal(f.service.getOrderFulfillment('o').status, 'partial');
  assert.deepEqual(f.service.getOrderFulfillment('o').lines[0]!.backorder, r('4'));
  assert.deepEqual(f.service.listOpenReceivables(f.customer.id), [{ deliveryId: 'd1', customerId: f.customer.id, openCents: '50', currency: 'CNY' }]);
  assert.deepEqual(f.service.listOpenReceivables('other'), []);
  assert.deepEqual(f.service.listAuditEvents().at(-1), { ...c('d1'), action: 'delivery', recordId: 'd1', recordedAt: sale.postedAt });
  f.receive('r2', '1', '100');
  const next = f.service.confirmDelivery(f.delivery('3', '200'), c('d2'));
  assert.deepEqual(next.costCents, r('500', '3'));
  assert.deepEqual(f.stock().valueCents, r('0'));
  assert.equal(f.stock().averageCostCents, null);
  assert.deepEqual(f.service.getDelivery('d1'), sale); // Later purchases never rewrite sold cost.
  assert.throws(() => f.service.confirmDelivery(f.delivery(), c('short')), code('insufficient_stock'));
});

test('ERP sales: exact-stock equality fulfills order; idempotency and recorded costs survive reopening', t => {
  const f = fixture(t);
  f.receive('r', '0.3', '1');
  f.service.createSalesOrder(f.order('0.3'), c('o'));
  const input = f.delivery('0.3', '9007199254740993');
  const sale = f.service.confirmDelivery(input, c('d'));
  assert.deepEqual(sale.costCents, r('1'));
  assert.deepEqual(sale.grossProfitCents, r('9007199254740992'));
  f.reopen();
  assert.deepEqual(f.service.confirmDelivery(input, c('d')), sale);
  assert.deepEqual(f.service.listDeliveries(), [sale]);
  assert.equal(f.service.getOrderFulfillment('o').status, 'fulfilled');
  assert.deepEqual(f.stock().quantity, r('0'));
  assert.throws(() => f.service.confirmDelivery(f.delivery(), c('d')), code('idempotency_conflict'));
  assert.throws(() => f.service.confirmDelivery(input, c('again')), code('conflict'));
});

test('ERP sales: unfulfilled orders support revision-checked editing and cancellation without ledger changes', t => {
  const f = fixture(t);
  f.service.createSalesOrder(f.order(), c('o'));
  const changed = f.service.changeSalesOrder({ orderId: 'o', expectedRevision: 1, order: f.order('2') }, c('edit'));
  assert.equal(changed.revision, 2);
  assert.throws(() => f.service.confirmDelivery(f.delivery(), c('stale')), code('conflict'));
  assert.throws(() => f.service.cancelSalesOrder({ orderId: 'o', expectedRevision: 1 }, c('stale-cancel')), code('conflict'));
  const cancelled = f.service.cancelSalesOrder({ orderId: 'o', expectedRevision: 2 }, c('cancel'));
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(f.service.getOrderFulfillment('o').status, 'cancelled');
  assert.deepEqual(f.service.getOrderFulfillment('o').lines[0]!.backorder, r('0'));
  assert.deepEqual(f.service.listDeliveries(), []);
  assert.deepEqual(f.service.listOpenReceivables(), []);
  assert.deepEqual(f.stock().quantity, r('0'));
  f.service.createSalesOrder(f.order(), c('other'));
  f.receive('r');
  f.service.confirmDelivery(f.delivery('1', '0', 'other'), c('free'));
  assert.deepEqual(f.service.getDelivery('free')!.grossProfitCents, r('-100', '3'));
  assert.deepEqual(f.service.listOpenReceivables(), []);
  assert.throws(() => f.service.cancelSalesOrder({ orderId: 'other', expectedRevision: 1 }, c('bad')), code('conflict'));
  assert.throws(() => f.service.changeSalesOrder({ orderId: 'other', expectedRevision: 1, order: f.order() }, c('bad2')), code('conflict'));
});

test('ERP sales: repeated-product lines cannot overdraw collectively and rejected input has no effects', t => {
  const f = fixture(t);
  f.receive('r');
  const input = f.order();
  input.lines.push({ ...input.lines[0]! });
  f.service.createSalesOrder(input, c('o'));
  const before = { stock: f.stock(), audit: f.service.listAuditEvents() };
  const badInputs: unknown[] = [null, { ...f.delivery(), orderId: 'missing' }, { ...f.delivery(), lines: [] },
    { ...f.delivery(), lines: [f.delivery().lines[0], f.delivery().lines[0]] },
    { ...f.delivery(), lines: [{ orderLineIndex: 0, quantity: '2', amountCents: '10' }, { orderLineIndex: 1, quantity: '2', amountCents: '10' }] }];
  for (const patch of [{ quantity: '0' }, { quantity: '-1' }, { quantity: '0.0000001' }, { amountCents: '1.1' },
    { amountCents: 10 }, { orderLineIndex: 5 }, { quantity: '4' }, { unit: '箱' }])
    badInputs.push({ ...f.delivery(), lines: [{ ...f.delivery().lines[0], ...patch }] });
  for (const bad of badInputs) assert.throws(() => f.service.confirmDelivery(bad, c('bad')));
  assert.deepEqual({ stock: f.stock(), audit: f.service.listAuditEvents() }, before);
  assert.deepEqual(f.service.listDeliveries(), []);
  assert.deepEqual(f.service.listOpenReceivables(), []);
  f.service.confirmDelivery({ ...f.delivery(), lines: [{ orderLineIndex: 0, quantity: '1', amountCents: '50' },
    { orderLineIndex: 1, quantity: '2', amountCents: '100' }] }, c('bad'));
  assert.deepEqual(f.stock().valueCents, r('0'));
});

test('ERP sales: failure after writes rolls back stock, delivery, receivable, fulfillment, audit and retry key', t => {
  const f = fixture(t);
  f.receive('r');
  f.service.createSalesOrder(f.order(), c('o'));
  const before = { stock: f.stock(), audit: f.service.listAuditEvents(), fulfillment: f.service.getOrderFulfillment('o') };
  f.fail();
  assert.throws(() => f.service.confirmDelivery(f.delivery(), c('d')), /injected/);
  assert.deepEqual({ stock: f.stock(), audit: f.service.listAuditEvents(), fulfillment: f.service.getOrderFulfillment('o') }, before);
  assert.deepEqual(f.service.listDeliveries(), []);
  assert.deepEqual(f.service.listOpenReceivables(), []);
  f.reopen();
  f.service.confirmDelivery(f.delivery(), c('d'));
  assert.equal(f.service.listDeliveries().length, 1);
});

test('ERP sales: simultaneous independent connections cannot sell the same stock twice', async t => {
  const f = fixture(t);
  f.receive('r', '1', '10');
  f.service.createSalesOrder(f.order('1'), c('o'));
  f.service.createSalesOrder(f.order('1'), c('o2'));
  const gate = new SharedArrayBuffer(4);
  const moduleUrl = new URL('../src/erp/service.ts', import.meta.url).href;
  const launch = (id: string, orderId: string) => {
    const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
      (async () => { const { ErpService } = await import(workerData.moduleUrl);
        const service = new ErpService(workerData.path);
        parentPort.postMessage('ready'); Atomics.wait(new Int32Array(workerData.gate), 0, 0);
        try { service.confirmDelivery(workerData.input, workerData.confirmation); parentPort.postMessage('posted'); }
        catch (error) { parentPort.postMessage(error.code); } finally { service.close(); }
      })();`, { eval: true, workerData: { path: f.path, moduleUrl, gate, input: f.delivery('1', '20', orderId), confirmation: c(id) } });
    const ready = new Promise<void>((resolve, reject) => { worker.on('message', message => { if (message === 'ready') resolve(); }); worker.on('error', reject); });
    const result = new Promise<string>((resolve, reject) => { worker.on('message', message => { if (message !== 'ready') resolve(message as string); }); worker.on('error', reject); });
    t.after(async () => { await worker.terminate(); });
    return { ready, result };
  };
  const a = launch('d1', 'o'), b = launch('d2', 'o2');
  await Promise.all([a.ready, b.ready]);
  Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  assert.deepEqual((await Promise.all([a.result, b.result])).sort(), ['insufficient_stock', 'posted']);
  assert.deepEqual(f.stock().quantity, r('0'));
  assert.equal(f.service.listDeliveries().length, 1);
  assert.equal(f.service.listOpenReceivables().length, 1);
});
