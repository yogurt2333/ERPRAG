import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ErpService, BusinessError, type Confirmation } from '../src/erp/service.ts';
import { ratio, zero } from '../src/erp/exact.ts';

const c = (id: string): Confirmation => ({ operationId: id, actorId: 'operator', channel: 'web', confirmationId: id, confirmed: true });
const error = (code: string) => (e: unknown) => e instanceof BusinessError && e.code === code;
const ret = (originId: string, kind: 'sale' | 'purchase' = 'sale', n = 1n, d = 1n) => ({
  originId, kind, lineIndex: 0, quantity: ratio(n, d), condition: 'saleable' as const, reason: '确认退货' });
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-returns-')), path = join(dir, 'erp.sqlite');
  let fail = false;
  let s = new ErpService(path, { beforeCommit() { if (fail) throw new Error('injected'); } });
  t.after(() => { s.close(); rmSync(dir, { recursive: true, force: true }); });
  const product = s.createProduct({ name: '合成饮料', stockUnit: '瓶' }, c('p'));
  const warehouse = s.createWarehouse({ name: '仓库' }, c('w'));
  const supplier = s.createSupplier({ name: '供应商' }, c('supplier'));
  const customer = s.createCustomer({ name: '客户' }, c('customer'));
  const receive = (id = 'r', quantity = '3', amountCents = '100') => s.confirmPurchaseReceipt({ supplierId: supplier.id, warehouseId: warehouse.id,
    lines: [{ productId: product.id, unit: '瓶', quantity, amountCents }] }, c(id));
  s.createSalesOrder({ customerId: customer.id, warehouseId: warehouse.id, lines: [{ productId: product.id, unit: '瓶', quantity: '20', amountCents: '1000' }] }, c('order'));
  const deliver = (id = 'd', quantity = '3', amountCents = '200') => s.confirmDelivery({ orderId: 'order', expectedRevision: 1,
    lines: [{ orderLineIndex: 0, quantity, amountCents }] }, c(id));
  return { get s() { return s; }, path, product, warehouse, supplier, customer, receive, deliver, stock: () => s.getStock(product.id, warehouse.id),
    fail(value: boolean) { fail = value; },
    reopen(asV5 = false) { s.close(); if (asV5) {
      const db = new DatabaseSync(path);
      db.exec('DROP TABLE inventory_operations; DROP TABLE stocktakes; DROP TABLE return_refunds; DROP TABLE quarantine_resolutions; DROP TABLE quarantines; DROP TABLE returns; DROP TABLE operation_drafts; DROP TABLE draft_events; DROP TABLE notification_events; DROP TABLE followup_history; DROP TABLE followups; DROP TABLE hermes_events; DROP TABLE hermes_displays; DROP TABLE web_auth; DROP TABLE web_security_events; PRAGMA user_version = 5;');
      db.close();
    } s = new ErpService(path); },
    quarantine(id = 'q', n = 1n) { return s.receiveQuarantinedReturn({ customerId: customer.id, productId: product.id, warehouseId: warehouse.id,
      quantity: ratio(n), condition: 'unknown', reason: '来源待核实' }, c(id)); },
    settle(kind: 'customer_receipt' | 'supplier_payment', amountCents: string) {
      return s.confirmSettlement(s.previewSettlement({ kind, partyId: kind === 'customer_receipt' ? customer.id : supplier.id, amountCents }), c(kind));
    } };
}

test('ERP returns: partial returns use historical cost, cumulative cents, immutable origins and durable idempotency', t => {
  const f = fixture(t); f.receive(); const original = f.deliver(); f.receive('expensive', '3', '400');
  const proposal = f.s.previewReturn(ret('d'));
  assert.deepEqual(proposal.originalCostCents, ratio(100n, 3n)); assert.equal(proposal.amountCents, '66');
  assert.deepEqual(f.s.listReturns(), []);
  const first = f.s.confirmReturn(ret('d'), c('return1'));
  assert.deepEqual(f.stock().valueCents, ratio(1300n, 3n));
  assert.deepEqual(f.s.getSalesTotals(), { revenueCents: '134', costCents: ratio(200n, 3n), grossProfitCents: ratio(202n, 3n) });
  assert.equal(f.s.listOpenReceivables()[0]!.openCents, '134');
  f.reopen(); assert.deepEqual(f.s.confirmReturn(ret('d'), c('return1')), first);
  assert.equal(f.s.confirmReturn(ret('d'), c('return2')).amountCents, '67');
  assert.equal(f.s.confirmReturn(ret('d'), c('return3')).amountCents, '67');
  assert.throws(() => f.s.confirmReturn(ret('d'), c('over')), error('conflict'));
  assert.throws(() => f.s.confirmReturn({ ...ret('d'), reason: '改动' }, c('return1')), error('idempotency_conflict'));
  assert.deepEqual(f.s.getDelivery('d'), original);
  assert.deepEqual(f.s.getSalesTotals(), { revenueCents: '0', costCents: zero(), grossProfitCents: zero() });
  assert.deepEqual(f.stock().valueCents, ratio(500n));
  assert.deepEqual(f.s.listOpenReceivables(), []);
  assert.equal(f.s.getOrderFulfillment('order').lines[0]!.delivered.numerator, '3');
  assert.throws(() => f.s.confirmReversal({ originId: 'd', kind: 'sale', reason: '修错' }, c('reverse')), error('conflict'));
  assert.equal(f.s.listAuditEvents().find(a => a.recordId === 'return1')!.actorId, 'operator');
});

for (const kind of ['sale', 'purchase'] as const) {
  test(`ERP returns: ${kind} partially settled credit and actual refund are separate and capped`, t => {
    const f = fixture(t); f.receive(); if (kind === 'sale') f.deliver('d', '3', '100');
    const id = kind === 'sale' ? 'd' : 'r';
    f.settle(kind === 'sale' ? 'customer_receipt' : 'supplier_payment', '80');
    const stale = f.s.previewSettlement({ kind: kind === 'sale' ? 'customer_receipt' : 'supplier_payment',
      partyId: kind === 'sale' ? f.customer.id : f.supplier.id, amountCents: '20' });
    f.s.confirmReturn(ret(id, kind), c('return'));
    assert.throws(() => f.s.confirmSettlement(stale, c('stale')), error('conflict'));
    const balance = { originId: id, kind };
    assert.equal(f.s.getReturnRefundBalance(balance).amountCents, '13');
    assert.deepEqual(kind === 'sale' ? f.s.listOpenReceivables() : f.s.listOpenPayables(), []);
    assert.deepEqual(f.s.listReturnRefunds(), []);
    const refund = { ...balance, amountCents: '10', reason: '退款到账确认' };
    const posted = f.s.confirmReturnRefund(refund, c('refund'));
    assert.equal(posted.direction, kind === 'sale' ? 'outgoing' : 'incoming');
    assert.deepEqual(f.s.confirmReturnRefund(refund, c('refund')), posted);
    assert.equal(f.s.getReturnRefundBalance(balance).amountCents, '3');
    assert.throws(() => f.s.confirmReturnRefund(refund, c('over-refund')), error('conflict'));
    assert.throws(() => f.s.confirmReversal({ originId: kind === 'sale' ? 'customer_receipt' : 'supplier_payment', kind: 'settlement', reason: '修错' }, c('reverse')), error('conflict'));
    assert.equal(f.s.listSettlements()[0]!.amountCents, '80');
  });
}

test('ERP returns: candidate search preserves ambiguity, filters dates, scope and remaining quantity', t => {
  const f = fixture(t); f.receive('r', '6', '200'); f.deliver('d1'); f.deliver('d2');
  const query = { kind: 'sale', partyId: f.customer.id, productId: f.product.id, quantity: ratio(2n), fromDate: '2000-01-01', throughDate: '9999-12-31' };
  assert.deepEqual(f.s.searchReturnCandidates(query).map(c => c.originId), ['d1', 'd2']);
  assert.deepEqual(f.s.searchReturnCandidates({ ...query, throughDate: '2000-01-02' }), []);
  const other = f.s.createCustomer({ name: '另一客户' }, c('other'));
  assert.deepEqual(f.s.searchReturnCandidates({ ...query, partyId: other.id }), []);
  f.s.confirmReturn(ret('d1', 'sale', 2n), c('partial'));
  assert.deepEqual(f.s.searchReturnCandidates(query).map(c => c.originId), ['d2']);
  assert.throws(() => f.s.searchReturnCandidates({ ...query, fromDate: '2026-02-30' }), error('invalid_input'));
  assert.throws(() => f.s.searchReturnCandidates({ ...query, fromDate: '9999-12-31', throughDate: '2000-01-01' }), error('invalid_input'));
});

test('ERP returns: unresolved goods are durable, unavailable and unvalued until explicitly linked', t => {
  const f = fixture(t); f.receive(); f.deliver();
  const before = { stock: f.stock(), totals: f.s.getSalesTotals(), ar: f.s.listOpenReceivables() };
  f.quarantine(); f.reopen();
  assert.deepEqual({ stock: f.stock(), totals: f.s.getSalesTotals(), ar: f.s.listOpenReceivables() }, before);
  assert.equal(f.s.listReturnFollowups()[0]!.status, 'open');
  assert.throws(() => f.deliver('cannot-sell', '1', '50'), error('insufficient_stock'));
  const input = { quarantineId: 'q', reason: '核对原单', outcome: { kind: 'linked_return', originId: 'd', lineIndex: 0, condition: 'saleable' } };
  const result = f.s.resolveQuarantinedReturn(input, c('resolve'));
  assert.deepEqual(f.s.resolveQuarantinedReturn(input, c('resolve')), result);
  assert.equal(f.s.listReturnFollowups()[0]!.status, 'resolved');
  assert.equal(f.s.listReturns()[0]!.quarantineId, 'q');
  assert.deepEqual(f.stock().valueCents, ratio(100n, 3n));
  assert.throws(() => f.s.resolveQuarantinedReturn(input, c('again')), error('conflict'));
});

test('ERP returns: damaged linked goods retain original cost loss; unknown loss never invents valuation', t => {
  const f = fixture(t); f.receive(); f.deliver(); f.quarantine();
  f.s.resolveQuarantinedReturn({ quarantineId: 'q', reason: '破损报损确认',
    outcome: { kind: 'linked_return', originId: 'd', lineIndex: 0, condition: 'damaged' } }, c('damaged'));
  assert.deepEqual(f.stock().quantity, zero());
  assert.deepEqual(f.s.getReturnLossTotals().knownLossCents, ratio(100n, 3n));
  assert.deepEqual(f.s.getSalesTotals(), { revenueCents: '134', costCents: ratio(200n, 3n), grossProfitCents: ratio(34n) });
  for (const kind of ['return_to_sender', 'confirmed_loss'] as const) {
    f.quarantine(kind);
    f.s.resolveQuarantinedReturn({ quarantineId: kind, reason: '已核实实物处置', outcome: { kind } }, c(`resolve-${kind}`));
  }
  assert.deepEqual(f.stock().quantity, zero());
  assert.deepEqual(f.s.getReturnLossTotals(), { knownLossCents: ratio(100n, 3n), unvaluedQuarantineLosses: ['resolve-confirmed_loss'] });
  assert.equal(f.s.listOpenReceivables()[0]!.openCents, '134');
});

test('ERP returns: purchase uses historical pack snapshot and exact quantity with valuation guards', t => {
  const f = fixture(t);
  f.s.definePackUnit({ productId: f.product.id, unit: '箱', expectedVersion: 0, stockUnits: ratio(1n, 3n) }, c('pack'));
  const receipt = f.s.confirmPurchaseReceipt({ supplierId: f.supplier.id, warehouseId: f.warehouse.id, lines: [
    { productId: f.product.id, unit: '箱', packVersion: 1, quantity: '3', amountCents: '100' }] }, c('packed'));
  f.s.definePackUnit({ productId: f.product.id, unit: '箱', expectedVersion: 1, stockUnits: ratio(6n) }, c('pack2'));
  for (let i = 0; i < 3; i++) f.s.confirmReturn(ret('packed', 'purchase', 1n, 3n), c(`return${i}`));
  assert.deepEqual(f.stock().quantity, zero()); assert.deepEqual(f.stock().valueCents, zero());
  assert.deepEqual(f.s.listOpenPayables(), []); assert.deepEqual(f.s.getPurchaseReceipt('packed'), receipt);
  assert.throws(() => f.s.confirmReturn(ret('packed', 'purchase'), c('over')), error('conflict'));
  f.receive('free', '1', '0'); f.receive('costly', '1', '100'); f.deliver('d', '1', '50');
  assert.throws(() => f.s.confirmReturn(ret('free', 'purchase'), c('stranded')), error('conflict'));
  assert.throws(() => f.s.confirmReturn(ret('costly', 'purchase'), c('negative')), error('conflict'));
  assert.throws(() => f.s.confirmReturn(ret('missing'), c('missing')), error('not_found'));
});

test('ERP returns: transaction failures roll back returns, quarantine, resolutions and refunds', t => {
  const f = fixture(t); f.receive(); f.deliver(); f.settle('customer_receipt', '200');
  const snapshot = () => ({ stock: f.stock(), returns: f.s.listReturns(), q: f.s.listQuarantinedReturns(),
    resolutions: f.s.listQuarantineResolutions(), refunds: f.s.listReturnRefunds(), audit: f.s.listAuditEvents(),
    totals: f.s.getSalesTotals(), ar: f.s.listOpenReceivables() });
  const steps = [() => f.quarantine(),
    () => f.s.resolveQuarantinedReturn({ quarantineId: 'q', reason: '核实', outcome: { kind: 'linked_return', originId: 'd', lineIndex: 0, condition: 'saleable' } }, c('resolve')),
    () => f.s.confirmReturn(ret('d'), c('return')),
    () => f.s.confirmReturnRefund({ originId: 'd', kind: 'sale', amountCents: '50', reason: '实付' }, c('refund'))];
  for (const step of steps) {
    const before = snapshot(); f.fail(true); assert.throws(step, /injected/); assert.deepEqual(snapshot(), before);
    f.fail(false); step();
  }
});

test('ERP returns: migration preserves v5 records and competing connections cannot over-return', t => {
  const f = fixture(t); const receipt = f.receive(); const delivery = f.deliver(); f.reopen(true);
  assert.deepEqual(f.s.getDelivery('d'), delivery); assert.deepEqual(f.s.getPurchaseReceipt('r'), receipt);
  const other = new ErpService(f.path);
  try {
    other.previewReturn(ret('d', 'sale', 2n));
    f.s.confirmReturn(ret('d', 'sale', 2n), c('first'));
    assert.throws(() => other.confirmReturn(ret('d', 'sale', 2n), c('competing')), error('conflict'));
  } finally { other.close(); }
  for (const raw of [{ ...ret('d'), quantity: ratio(0n) }, { ...ret('d'), quantity: { numerator: '1', denominator: '0' } },
    { ...ret('d'), reason: ' ' }, { ...ret('d'), lineIndex: 42 }])
    assert.throws(() => f.s.confirmReturn(raw, c('invalid')), error('invalid_input'));
  assert.throws(() => f.s.confirmReturn(ret('d'), { ...c('unconfirmed'), confirmed: false }), error('invalid_input'));
});

test('ERP returns: quarantine origin mismatch and reversed sources cannot create a financial link', t => {
  const f = fixture(t); f.receive(); f.deliver();
  const other = f.s.createCustomer({ name: '另一客户' }, c('other'));
  f.s.receiveQuarantinedReturn({ customerId: other.id, productId: f.product.id, warehouseId: f.warehouse.id,
    quantity: ratio(1n), condition: 'unknown', reason: '待核实' }, c('q'));
  const link = { quarantineId: 'q', reason: '尝试核实', outcome: { kind: 'linked_return', originId: 'd', lineIndex: 0, condition: 'saleable' } };
  assert.throws(() => f.s.resolveQuarantinedReturn(link, c('wrong-customer')), error('conflict'));
  assert.deepEqual(f.s.listReturns(), []); assert.equal(f.s.listReturnFollowups()[0]!.status, 'open');
  assert.throws(() => f.s.confirmReturn(ret('r', 'purchase'), c('out-of-stock')), error('insufficient_stock'));
  f.s.confirmReversal({ originId: 'd', kind: 'sale', reason: '修错' }, c('reverse'));
  assert.throws(() => f.s.confirmReturn(ret('d'), c('reversed')), error('conflict'));
  assert.deepEqual(f.s.searchReturnCandidates({ kind: 'sale', partyId: f.customer.id, productId: f.product.id,
    quantity: ratio(1n), fromDate: '2000-01-01', throughDate: '9999-12-31' }), []);
});

test('ERP returns: unpaid return credit follows settlement reversal without changing physical return', t => {
  const f = fixture(t); f.receive(); f.deliver(); f.settle('customer_receipt', '250');
  f.s.confirmReturn(ret('d'), c('return'));
  const query = { originId: 'd', kind: 'sale' };
  assert.equal(f.s.getReturnRefundBalance(query).amountCents, '66');
  assert.equal(f.s.getAdvanceBalance({ kind: 'customer_receipt', partyId: f.customer.id }).amountCents, '50');
  f.s.confirmReversal({ originId: 'customer_receipt', kind: 'settlement', reason: '收款错误' }, c('reverse'));
  assert.equal(f.s.getReturnRefundBalance(query).amountCents, '0');
  assert.equal(f.s.listOpenReceivables()[0]!.openCents, '134');
  assert.deepEqual(f.stock().quantity, ratio(1n));
  assert.throws(() => f.s.confirmReturnRefund({ ...query, amountCents: '66', reason: '过期退款方案' }, c('stale')), error('conflict'));
});
