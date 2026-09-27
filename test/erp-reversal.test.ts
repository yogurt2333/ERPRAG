import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErpService, BusinessError, type Confirmation } from '../src/erp/service.ts';
import { ratio, zero } from '../src/erp/exact.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const c = (id: string): Confirmation => ({ operationId: id, actorId: 'operator', channel: 'web', confirmationId: id, confirmed: true });
const input = (originId: string, kind: 'purchase' | 'sale' | 'settlement') => ({ originId, kind, reason: '录入错误' });
const error = (code: string) => (e: unknown) => e instanceof BusinessError && e.code === code;

function fixture() {
  let fail = false;
  const s = new ErpService(':memory:', { beforeCommit: () => { if (fail) throw new Error('injected'); } });
  const p = s.createProduct({ name: '合成商品', stockUnit: '瓶' }, c('p'));
  const w = s.createWarehouse({ name: '仓库' }, c('w'));
  const supplier = s.createSupplier({ name: '供应商' }, c('supplier'));
  const customer = s.createCustomer({ name: '客户' }, c('customer'));
  const receive = (id: string, quantity = '3', amountCents = '100') => s.confirmPurchaseReceipt({ supplierId: supplier.id, warehouseId: w.id,
    lines: [{ productId: p.id, unit: '瓶', quantity, amountCents }] }, c(id));
  const order = s.createSalesOrder({ customerId: customer.id, warehouseId: w.id,
    lines: [{ productId: p.id, unit: '瓶', quantity: '10', amountCents: '500' }] }, c('order'));
  const delivery = { orderId: order.id, expectedRevision: 1, lines: [{ orderLineIndex: 0, quantity: '1', amountCents: '50' }] };
  return { s, receive, delivery, supplier, customer, stock: () => s.getStock(p.id, w.id), fail: (value: boolean) => { fail = value; } };
}

test('ERP reversal: exact purchase and sale corrections preserve originals, fulfillment and cost', t => {
  const f = fixture(); t.after(() => f.s.close());
  const receipt = f.receive('r');
  const d = f.s.confirmDelivery(f.delivery, c('d'));
  f.receive('new', '3', '200');
  const proposal = f.s.previewReversal(input('d', 'sale'));
  assert.deepEqual(proposal.costCents, ratio(-100n, 3n));
  assert.deepEqual(f.s.listReversals(), []);
  const reversed = f.s.confirmReversal(input('d', 'sale'), c('reverse-d'));
  assert.deepEqual(reversed.grossProfitCents, ratio(-50n, 3n));
  assert.deepEqual(f.stock().valueCents, ratio(300n));
  assert.deepEqual(f.s.getSalesTotals(), { revenueCents: '0', costCents: zero(), grossProfitCents: zero() });
  assert.equal(f.s.getOrderFulfillment('order').status, 'open');
  assert.deepEqual(f.s.getDelivery('d'), d);
  assert.deepEqual(f.s.confirmReversal(input('d', 'sale'), c('reverse-d')), reversed);
  assert.throws(() => f.s.confirmReversal(input('d', 'sale'), c('again')), error('conflict'));
  assert.throws(() => f.s.confirmReversal({ ...input('d', 'sale'), reason: 'changed' }, c('reverse-d')), error('idempotency_conflict'));
  f.s.confirmReversal(input('r', 'purchase'), c('reverse-r'));
  assert.deepEqual(f.stock().quantity, ratio(3n));
  assert.deepEqual(f.stock().valueCents, ratio(200n));
  assert.deepEqual(f.s.getPurchaseReceipt('r'), receipt);
  assert.deepEqual(f.s.listOpenPayables().map(p => p.receiptId), ['new']);
  assert.deepEqual(f.s.listManagedExpiry().map(r => r.receiptId), ['new']);
  assert.equal(reversed.actorId, 'operator'); assert.equal(reversed.channel, 'web');
  assert.equal(reversed.reason, '录入错误'); assert.ok(Date.parse(reversed.postedAt));
  assert.deepEqual(f.s.listAuditEvents().find(e => e.recordId === reversed.id)?.reversalDecision, reversed);
  f.s.confirmDelivery(f.delivery, c('replacement'));
  assert.deepEqual(f.s.getSalesTotals().costCents, ratio(200n, 3n));
});

for (const kind of ['customer_receipt', 'supplier_payment'] as const) {
  test(`ERP reversal: ${kind} restores allocations and removes excess without deleting history`, t => {
    const f = fixture(); t.after(() => f.s.close()); f.receive('r');
    if (kind === 'customer_receipt') f.s.confirmDelivery(f.delivery, c('d'));
    const origin = kind === 'customer_receipt' ? 'd' : 'r';
    const targetKind = kind === 'customer_receipt' ? 'sale' : 'purchase';
    const query = { kind, partyId: kind === 'customer_receipt' ? f.customer.id : f.supplier.id };
    const proposal = f.s.previewSettlement({ ...query, amountCents: '150' });
    const posted = f.s.confirmSettlement(proposal, c('settle'));
    assert.throws(() => f.s.confirmReversal(input(origin, targetKind), c('blocked')), error('conflict'));
    const r = f.s.confirmReversal(input('settle', 'settlement'), c('reverse-settle'));
    assert.equal(r.cashCents, '-150');
    assert.equal(r.allocations[0]!.amountCents, kind === 'customer_receipt' ? '-50' : '-100');
    assert.equal(f.s.getAdvanceBalance(query).amountCents, '0');
    assert.equal(f.s.listOpenObligations(query)[0]!.openCents, kind === 'customer_receipt' ? '50' : '100');
    assert.deepEqual(f.s.listSettlements(), [posted]);
    f.s.confirmReversal(input(origin, targetKind), c('reverse-origin'));
    assert.deepEqual(f.s.listOpenObligations(query), []);
    assert.throws(() => f.s.confirmSettlement(proposal, c('stale')), error('conflict'));
  });
}

test('ERP reversal: combined delivery needs both explicit corrections and failures roll back', t => {
  const f = fixture(); t.after(() => f.s.close()); f.receive('r');
  f.s.confirmDeliveryAndReceipt({ delivery: f.delivery, amountCents: '60' }, c('combined'));
  assert.throws(() => f.s.confirmReversal(input('combined', 'sale'), c('blocked')), error('conflict'));
  for (const [origin, kind] of [['combined', 'settlement'], ['combined', 'sale'], ['r', 'purchase']] as const) {
    const before = { stock: f.stock(), audit: f.s.listAuditEvents(), reversals: f.s.listReversals(),
      receivables: f.s.listOpenReceivables(), payables: f.s.listOpenPayables(), totals: f.s.getSalesTotals() };
    f.fail(true);
    assert.throws(() => f.s.confirmReversal(input(origin, kind), c(`reverse-${kind}`)), /injected/);
    assert.deepEqual({ stock: f.stock(), audit: f.s.listAuditEvents(), reversals: f.s.listReversals(),
      receivables: f.s.listOpenReceivables(), payables: f.s.listOpenPayables(), totals: f.s.getSalesTotals() }, before);
    f.fail(false); f.s.confirmReversal(input(origin, kind), c(`reverse-${kind}`));
  }
  assert.deepEqual(f.stock().quantity, zero()); assert.deepEqual(f.stock().valueCents, zero());
});

test('ERP reversal: invalid corrections and consumed stock cannot mutate records', t => {
  const f = fixture(); t.after(() => f.s.close()); f.receive('r'); f.s.confirmDelivery(f.delivery, c('d'));
  assert.throws(() => f.s.confirmReversal(input('r', 'purchase'), c('negative')), error('insufficient_stock'));
  for (const raw of [{ ...input('r', 'purchase'), reason: ' ' }, { ...input('r', 'purchase'), amountCents: '0' }])
    assert.throws(() => f.s.confirmReversal(raw, c('invalid')), error('invalid_input'));
  assert.throws(() => f.s.confirmReversal(input('r', 'purchase'), { ...c('unconfirmed'), confirmed: false }), error('invalid_input'));
  assert.throws(() => f.s.confirmReversal(input('missing', 'sale'), c('missing')), error('not_found'));
  assert.throws(() => f.s.confirmPurchaseReceipt({}, c('r')), error('invalid_input'));
  assert.deepEqual(f.s.listReversals(), []);
});

test('ERP reversal: pack snapshots and valuation conflicts remain exact', t => {
  const f = fixture(); t.after(() => f.s.close());
  const p = f.s.listMasters('product')[0]!, w = f.s.listMasters('warehouse')[0]!;
  f.s.definePackUnit({ productId: p.id, unit: '箱', expectedVersion: 0, stockUnits: { numerator: '3', denominator: '1' } }, c('pack'));
  f.s.confirmPurchaseReceipt({ supplierId: f.supplier.id, warehouseId: w.id,
    lines: [{ productId: p.id, unit: '箱', packVersion: 1, quantity: '1', amountCents: '100' }] }, c('packed'));
  f.s.definePackUnit({ productId: p.id, unit: '箱', expectedVersion: 1, stockUnits: { numerator: '6', denominator: '1' } }, c('pack2'));
  f.s.confirmReversal(input('packed', 'purchase'), c('reverse-packed'));
  assert.deepEqual(f.stock().quantity, zero());
  f.receive('cheap', '1', '0'); f.receive('costly', '1', '100');
  f.s.confirmDelivery(f.delivery, c('d'));
  assert.throws(() => f.s.confirmReversal(input('costly', 'purchase'), c('negative-value')), error('conflict'));
  assert.throws(() => f.s.confirmReversal(input('cheap', 'purchase'), c('stranded-value')), error('conflict'));
  assert.deepEqual(f.stock().valueCents, ratio(50n));
});

test('ERP reversal: persisted correction survives reopen and another connection cannot reverse twice', t => {
  const dir = mkdtempSync(join(tmpdir(), 'erp-reversal-'));
  const path = join(dir, 'erp.sqlite');
  let s = new ErpService(path);
  t.after(() => { s.close(); rmSync(dir, { recursive: true, force: true }); });
  const customer = s.createCustomer({ name: '合成客户' }, c('customer'));
  const proposal = s.previewSettlement({ kind: 'customer_receipt', partyId: customer.id, amountCents: '9007199254740993' });
  s.confirmSettlement(proposal, c('advance'));
  const other = new ErpService(path);
  let reversed;
  try {
    reversed = s.confirmReversal(input('advance', 'settlement'), c('reverse'));
    assert.throws(() => other.confirmReversal(input('advance', 'settlement'), c('other')), error('conflict'));
  } finally { other.close(); }
  s.close(); s = new ErpService(path);
  assert.deepEqual(s.confirmReversal(input('advance', 'settlement'), c('reverse')), reversed);
  assert.equal(s.listReversals().length, 1);
  assert.equal(s.getAdvanceBalance({ kind: 'customer_receipt', partyId: customer.id }).amountCents, '0');
  assert.equal(s.listSettlements()[0]!.amountCents, '9007199254740993');
  assert.throws(() => s.confirmReversal(input('reverse', 'settlement'), c('reverse-reversal')), error('not_found'));
});
