import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { ErpService, BusinessError, type Confirmation, type SettlementInput } from '../src/erp/service.ts';

const c = (id: string): Confirmation => ({ operationId: id, actorId: 'operator', channel: 'cli', confirmationId: id, confirmed: true });
const code = (expected: string) => (error: unknown) => error instanceof BusinessError && error.code === expected;
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-settlement-'));
  const path = join(dir, 'erp.sqlite');
  let fail = false;
  let closed = false;
  let service = new ErpService(path, { beforeCommit: () => { if (fail) throw new Error('injected'); } });
  t.after(() => { if (!closed) service.close(); rmSync(dir, { recursive: true, force: true }); });
  const product = service.createProduct({ name: '合成商品', stockUnit: '瓶' }, c('p'));
  const warehouse = service.createWarehouse({ name: '仓库' }, c('w'));
  const supplier = service.createSupplier({ name: '供应商', }, c('s'));
  const customer = service.createCustomer({ name: '客户' }, c('c'));
  const receive = (id: string, amountCents = '100', dueDate?: string) => service.confirmPurchaseReceipt({ supplierId: supplier.id,
    warehouseId: warehouse.id, ...(dueDate ? { dueDate } : {}),
    lines: [{ productId: product.id, unit: '瓶', quantity: '10', amountCents }] }, c(id));
  const order = service.createSalesOrder({ customerId: customer.id, warehouseId: warehouse.id,
    lines: [{ productId: product.id, unit: '瓶', quantity: '100', amountCents: '1000' }] }, c('o'));
  const delivery = (amountCents = '100', dueDate?: string) => ({ orderId: order.id, expectedRevision: 1,
    ...(dueDate ? { dueDate } : {}), lines: [{ orderLineIndex: 0, quantity: '1', amountCents }] });
  const input = (kind: SettlementInput['kind'], amountCents: string): SettlementInput => ({ kind, amountCents,
    partyId: kind === 'customer_receipt' ? customer.id : supplier.id });
  return { get service() { return service; }, path, customer, supplier, receive, delivery, input,
    stock: () => service.getStock(product.id, warehouse.id), fail: () => { fail = true; },
    reopen: () => { service.close(); service = new ErpService(path); },
    close: () => { service.close(); closed = true; } };
}

for (const kind of ['customer_receipt', 'supplier_payment'] as const) {
  test(`ERP settlement: ${kind} previews earliest due, partial allocation, excess and durable retry`, t => {
    const f = fixture(t);
    f.receive('r-late', '100', '2026-12-01');
    f.receive('r-early', '100', '2026-10-01');
    if (kind === 'customer_receipt') {
      f.service.confirmDelivery(f.delivery('100', '2026-12-01'), c('d-late'));
      f.service.confirmDelivery(f.delivery('100', '2026-10-01'), c('d-early'));
    }
    const prefix = kind === 'customer_receipt' ? 'd' : 'r';
    const query = { kind, partyId: f.input(kind, '1').partyId };
    const before = f.service.listAuditEvents();
    const proposal = f.service.previewSettlement(f.input(kind, '140'));
    assert.deepEqual(proposal.allocations, [{ obligationId: `${prefix}-early`, amountCents: '100' },
      { obligationId: `${prefix}-late`, amountCents: '40' }]);
    assert.equal(proposal.excessCents, '0');
    assert.deepEqual(f.service.listAuditEvents(), before);
    assert.equal(f.service.listSettlements().length, 0);
    const result = f.service.confirmSettlement(proposal, c('settle'));
    assert.deepEqual(f.service.listOpenObligations(query), [{ obligationId: `${prefix}-late`, openCents: '60',
      dueDate: '2026-12-01', dueDateSource: 'explicit' }]);
    f.reopen();
    assert.deepEqual(f.service.confirmSettlement(proposal, c('settle')), result);
    assert.equal(f.service.listSettlements().length, 1);
    assert.throws(() => f.service.confirmSettlement({ ...proposal, amountCents: '141' }, c('settle')), code('idempotency_conflict'));
    const excess = f.service.previewSettlement(f.input(kind, '90'));
    assert.equal(excess.excessCents, '30');
    assert.equal(excess.excessKind, kind === 'customer_receipt' ? 'customer_advance' : 'supplier_prepayment');
    f.service.confirmSettlement(excess, c('extra'));
    assert.deepEqual(f.service.listOpenObligations(query), []);
    assert.deepEqual(f.service.getAdvanceBalance(query), { amountCents: '30', currency: 'CNY' });
    assert.equal(f.service.listSettlements().length, 2);
  });

  test(`ERP settlement: ${kind} preserves override, rejects foreign/duplicate/excess and stale allocations`, t => {
    const f = fixture(t);
    f.receive('r1'); f.receive('r2');
    if (kind === 'customer_receipt') {
      f.service.confirmDelivery(f.delivery(), c('d1')); f.service.confirmDelivery(f.delivery(), c('d2'));
    }
    const prefix = kind === 'customer_receipt' ? 'd' : 'r';
    const input = f.input(kind, '75');
    const allocations = [{ obligationId: `${prefix}2`, amountCents: '75' }];
    const proposal = f.service.previewSettlement(input, allocations);
    const result = f.service.confirmSettlement(proposal, c('override'));
    assert.deepEqual(result.allocations, allocations);
    assert.deepEqual(f.service.listAuditEvents().at(-1)!.allocationDecision, proposal);
    const stale = f.service.previewSettlement(f.input(kind, '25'), [{ obligationId: `${prefix}2`, amountCents: '25' }]);
    f.service.confirmSettlement(stale, c('winner'));
    assert.throws(() => f.service.confirmSettlement(stale, c('loser')), code('conflict'));
    const foreign = kind === 'customer_receipt'
      ? f.service.createCustomer({ name: '另一个客户' }, c('foreign'))
      : f.service.createSupplier({ name: '另一个供应商' }, c('foreign'));
    assert.throws(() => f.service.previewSettlement({ ...input, partyId: foreign.id }, [{ obligationId: `${prefix}1`, amountCents: '1' }]), code('conflict'));
    for (const bad of [
      [{ obligationId: `${prefix}1`, amountCents: '0' }],
      [{ obligationId: `${prefix}1`, amountCents: '40' }, { obligationId: `${prefix}1`, amountCents: '30' }],
      [{ obligationId: `${prefix}1`, amountCents: '76' }]
    ]) assert.throws(() => f.service.previewSettlement(input, bad), code('invalid_input'));
    assert.throws(() => f.service.previewSettlement(input, [{ obligationId: `${prefix}1`, amountCents: '101' }]), code('conflict'));
    assert.throws(() => f.service.previewSettlement(input, [{ obligationId: 'missing', amountCents: '1' }]), code('conflict'));
    assert.equal(f.service.listSettlements().length, 2);
    assert.equal(f.service.listOpenObligations({ kind, partyId: input.partyId })[0]!.openCents, '100');
  });
}

test('ERP settlement: advances without obligations, large integer cents and malformed input', t => {
  const f = fixture(t);
  const input = f.input('customer_receipt', '9007199254740993');
  const proposal = f.service.previewSettlement(input);
  assert.deepEqual(proposal.allocations, []);
  f.service.confirmSettlement(proposal, c('advance'));
  assert.equal(f.service.getAdvanceBalance({ kind: input.kind, partyId: input.partyId }).amountCents, input.amountCents);
  for (const amountCents of ['0', '-1', '1.5', '01', '1000000000000000000'])
    assert.throws(() => f.service.previewSettlement({ ...input, amountCents }), code('invalid_input'));
  assert.throws(() => f.service.confirmSettlement({ ...proposal, excessCents: '1' }, c('bad')), code('invalid_input'));
  assert.throws(() => f.service.confirmSettlement(proposal, { ...c('bad'), confirmed: false }), code('invalid_input'));
  assert.throws(() => f.service.previewSettlement({ ...input, partyId: f.supplier.id }), code('not_found'));
  assert.throws(() => f.receive('invalid-date', '10', '2026-02-30'), code('invalid_input'));
  const receipt = f.receive('fallback');
  assert.equal(f.service.listOpenObligations({ kind: 'supplier_payment', partyId: f.supplier.id })[0]!.dueDate, receipt.postedAt.slice(0, 10));
  assert.equal(f.service.listOpenObligations({ kind: 'supplier_payment', partyId: f.supplier.id })[0]!.dueDateSource, 'posting_date');
});

test('ERP settlement: combined delivery and receipt has separate linked records and one durable confirmation', t => {
  const f = fixture(t); f.receive('r');
  f.service.confirmDelivery(f.delivery('30'), c('old-debt'));
  const input = { delivery: f.delivery('100'), amountCents: '120' };
  const before = f.service.listAuditEvents();
  const preview = f.service.previewDeliveryAndReceipt(input);
  assert.deepEqual(preview.receipt, { amountCents: '120', allocatedCents: '100', excessCents: '20', excessKind: 'customer_advance' });
  assert.deepEqual(f.service.listAuditEvents(), before);
  const result = f.service.confirmDeliveryAndReceipt(input, c('combined'));
  assert.equal(result.settlement.linkedDeliveryId, result.delivery.id);
  assert.deepEqual(f.service.getDelivery('combined'), result.delivery);
  assert.deepEqual(f.service.listSettlements(), [result.settlement]);
  assert.equal(f.service.listOpenReceivables()[0]!.deliveryId, 'old-debt');
  assert.equal(f.service.listOpenReceivables().length, 1);
  assert.equal(f.stock().quantity.numerator, '8');
  f.reopen();
  assert.deepEqual(f.service.confirmDeliveryAndReceipt(input, c('combined')), result);
  assert.equal(f.stock().quantity.numerator, '8');
  assert.equal(f.service.getAdvanceBalance({ kind: 'customer_receipt', partyId: f.customer.id }).amountCents, '20');
  const partial = f.service.confirmDeliveryAndReceipt({ delivery: f.delivery('100'), amountCents: '40' }, c('partial'));
  assert.equal(partial.settlement.excessCents, '0');
  assert.equal(f.service.listOpenReceivables().find(row => row.deliveryId === 'partial')!.openCents, '60');
});

test('ERP settlement: failure after all writes rolls back standalone and combined effects', t => {
  const f = fixture(t); f.receive('r');
  const snapshot = { stock: f.stock(), audit: f.service.listAuditEvents(), payables: f.service.listOpenPayables() };
  const proposal = f.service.previewSettlement(f.input('supplier_payment', '50'));
  f.fail();
  assert.throws(() => f.service.confirmSettlement(proposal, c('payment')), /injected/);
  assert.throws(() => f.service.confirmDeliveryAndReceipt({ delivery: f.delivery(), amountCents: '50' }, c('combined')), /injected/);
  assert.deepEqual(f.stock(), snapshot.stock);
  assert.deepEqual(f.service.listAuditEvents(), snapshot.audit);
  assert.deepEqual(f.service.listOpenPayables(), snapshot.payables);
  assert.deepEqual(f.service.listOpenReceivables(), []);
  assert.deepEqual(f.service.listDeliveries(), []);
  assert.deepEqual(f.service.listSettlements(), []);
  f.reopen();
  f.service.confirmSettlement(proposal, c('payment'));
  f.service.confirmDeliveryAndReceipt({ delivery: f.delivery(), amountCents: '50' }, c('combined'));
  assert.equal(f.service.listSettlements().length, 2);
});

test('ERP settlement: invalid combined receipt or insufficient stock posts neither effect', t => {
  const f = fixture(t);
  assert.throws(() => f.service.confirmDeliveryAndReceipt({ delivery: f.delivery(), amountCents: '50' }, c('no-stock')), code('insufficient_stock'));
  f.receive('r');
  const snapshot = f.stock();
  assert.throws(() => f.service.confirmDeliveryAndReceipt({ delivery: f.delivery(), amountCents: '0' }, c('zero')), code('invalid_input'));
  assert.deepEqual(f.stock(), snapshot);
  assert.deepEqual(f.service.listDeliveries(), []);
  assert.deepEqual(f.service.listSettlements(), []);
});

test('ERP settlement: schema 2 upgrades in place preserving existing obligations', t => {
  const f = fixture(t); const receipt = f.receive('r');
  const delivery = f.service.confirmDelivery(f.delivery(), c('d'));
  f.close();
  const old = new DatabaseSync(f.path);
  old.exec('DROP TABLE inventory_operations; DROP TABLE stocktakes; DROP TABLE return_refunds; DROP TABLE quarantine_resolutions; DROP TABLE quarantines; DROP TABLE returns; DROP TABLE reversals; DROP TABLE product_followups; DROP TABLE pack_versions; DROP TABLE product_details; DROP TABLE settlement_allocations; DROP TABLE settlements; DROP TABLE operation_drafts; DROP TABLE draft_events; DROP TABLE notification_events; DROP TABLE followup_history; DROP TABLE followups; PRAGMA user_version = 2;');
  old.close();
  // Reopen the same database directly; the prior handle is already closed.
  const upgraded = new ErpService(f.path);
  try {
    assert.deepEqual(upgraded.getPurchaseReceipt('r'), receipt);
    assert.deepEqual(upgraded.getDelivery('d'), delivery);
    const proposal = upgraded.previewSettlement(f.input('customer_receipt', '50'));
    upgraded.confirmSettlement(proposal, c('upgraded'));
    assert.equal(upgraded.listOpenReceivables()[0]!.openCents, '50');
  } finally { upgraded.close(); }
});

test('ERP settlement: concurrent confirmations cannot allocate the same remaining debt twice', async t => {
  const f = fixture(t); f.receive('r');
  const proposal = f.service.previewSettlement(f.input('supplier_payment', '100'));
  const gate = new SharedArrayBuffer(4);
  const moduleUrl = new URL('../src/erp/service.ts', import.meta.url).href;
  const launch = (id: string) => {
    const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
      (async () => { const { ErpService } = await import(workerData.moduleUrl);
        const service = new ErpService(workerData.path);
        parentPort.postMessage('ready'); Atomics.wait(new Int32Array(workerData.gate), 0, 0);
        try { service.confirmSettlement(workerData.proposal, workerData.confirmation); parentPort.postMessage('posted'); }
        catch (error) { parentPort.postMessage(error.code); } finally { service.close(); }
      })();`, { eval: true, workerData: { path: f.path, moduleUrl, gate, proposal, confirmation: c(id) } });
    const ready = new Promise<void>((resolve, reject) => { worker.on('message', message => { if (message === 'ready') resolve(); }); worker.on('error', reject); });
    const result = new Promise<string>((resolve, reject) => { worker.on('message', message => { if (message !== 'ready') resolve(message as string); }); worker.on('error', reject); });
    t.after(async () => { await worker.terminate(); });
    return { ready, result };
  };
  const a = launch('a'), b = launch('b');
  await Promise.all([a.ready, b.ready]);
  Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  assert.deepEqual((await Promise.all([a.result, b.result])).sort(), ['conflict', 'posted']);
  assert.deepEqual(f.service.listOpenPayables(), []);
  assert.equal(f.service.listSettlements().length, 1);
  assert.equal(f.service.getAdvanceBalance({ kind: 'supplier_payment', partyId: f.supplier.id }).amountCents, '0');
});
