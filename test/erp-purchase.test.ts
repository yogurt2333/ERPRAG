import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErpService, BusinessError, type Confirmation } from '../src/erp/service.ts';

const confirmed = (id: string): Confirmation => ({ operationId: id, actorId: 'operator-1', channel: 'cli', confirmationId: `confirm-${id}`, confirmed: true });
function fixture(t: import('node:test').TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'lean-erp-'));
  const path = join(directory, 'erp.sqlite');
  let fail = false;
  let service = new ErpService(path, { beforeCommit: () => { if (fail) throw new Error('Injected failure before commit'); } });
  t.after(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  const product = service.createProduct({ name: '合成测试商品', stockUnit: '瓶' }, confirmed('product'));
  const supplier = service.createSupplier({ name: '合成供应商' }, confirmed('supplier'));
  const warehouse = service.createWarehouse({ name: '测试仓' }, confirmed('warehouse'));
  const receipt = (quantity = '3', amountCents = '100') => ({ supplierId: supplier.id, warehouseId: warehouse.id,
    lines: [{ productId: product.id, unit: '瓶', quantity, amountCents }] });
  return { get service() { return service; }, product, supplier, warehouse, receipt,
    setFailure(value: boolean) { fail = value; },
    reopen() { service.close(); service = new ErpService(path); },
    stock() { return service.getStock(product.id, warehouse.id); } };
}
const rational = (numerator: string, denominator = '1') => ({ numerator, denominator });
const errorCode = (code: BusinessError['code']) => (error: unknown) => error instanceof BusinessError && error.code === code;

test('ERP: confirmed receipt posts document, exact stock/cost, payable and attributed audit together', t => {
  const f = fixture(t);
  assert.equal(f.stock().averageCostCents, null);
  const receipt = f.service.confirmPurchaseReceipt(f.receipt(), confirmed('receipt-1'));
  assert.equal(receipt.status, 'posted');
  assert.equal(receipt.currency, 'CNY');
  assert.equal(receipt.totalCents, '100');
  assert.deepEqual(f.stock().quantity, rational('3'));
  assert.deepEqual(f.stock().valueCents, rational('100'));
  assert.deepEqual(f.stock().averageCostCents, rational('100', '3'));
  assert.deepEqual(f.service.listOpenPayables(), [{ receiptId: receipt.id, supplierId: f.supplier.id, openCents: '100', currency: 'CNY' }]);
  const audit = f.service.listAuditEvents().at(-1)!;
  assert.deepEqual(audit, { ...confirmed('receipt-1'), action: 'purchase_receipt', recordId: receipt.id, recordedAt: receipt.postedAt });
  assert.ok(Number.isFinite(Date.parse(receipt.postedAt)));
  assert.deepEqual(f.service.getPurchaseReceipt(receipt.id), receipt);
  assert.deepEqual(f.service.listMasters('product'), [f.product]);
  assert.deepEqual(f.service.listMasters('supplier'), [f.supplier]);
  assert.deepEqual(f.service.listMasters('warehouse'), [f.warehouse]);
});

test('ERP: repeated migrations and confirmation survive reopen without duplicate effects', t => {
  const f = fixture(t);
  const input = f.receipt();
  const first = f.service.confirmPurchaseReceipt(input, confirmed('receipt-1'));
  for (let index = 0; index < 3; index++) {
    f.reopen();
    assert.deepEqual(f.service.confirmPurchaseReceipt(input, confirmed('receipt-1')), first);
    assert.deepEqual(f.service.listPurchaseReceipts(), [first]);
    assert.equal(f.service.listOpenPayables().length, 1);
    assert.equal(f.service.listAuditEvents().length, 4);
    assert.deepEqual(f.stock().quantity, rational('3'));
    assert.deepEqual(f.service.createProduct({ name: '合成测试商品', stockUnit: '瓶' }, confirmed('product')), f.product);
    assert.equal(f.service.listMasters('product').length, 1);
  }
  const reordered = { lines: input.lines, warehouseId: input.warehouseId, supplierId: input.supplierId };
  assert.deepEqual(f.service.confirmPurchaseReceipt(reordered, confirmed('receipt-1')), first);
  assert.throws(() => f.service.confirmPurchaseReceipt(f.receipt('4'), confirmed('receipt-1')), errorCode('idempotency_conflict'));
  assert.throws(() => f.service.confirmPurchaseReceipt(input, { ...confirmed('receipt-1'), actorId: 'other' }), errorCode('idempotency_conflict'));
  assert.deepEqual(f.stock().quantity, rational('3'));
});

test('ERP: successive receipts retain fractional quantities and sub-cent weighted cost exactly', t => {
  const f = fixture(t);
  f.service.confirmPurchaseReceipt(f.receipt('0.1', '1'), confirmed('r1'));
  f.service.confirmPurchaseReceipt(f.receipt('0.2', '1'), confirmed('r2'));
  assert.deepEqual(f.stock().quantity, rational('3', '10'));
  assert.deepEqual(f.stock().valueCents, rational('2'));
  assert.deepEqual(f.stock().averageCostCents, rational('20', '3'));
  f.service.confirmPurchaseReceipt(f.receipt('2.7', '99'), confirmed('r3'));
  assert.deepEqual(f.stock().quantity, rational('3'));
  assert.deepEqual(f.stock().averageCostCents, rational('101', '3'));
  assert.equal(f.service.listOpenPayables().reduce((sum, payable) => sum + BigInt(payable.openCents), 0n), 101n);
});

test('ERP: multiple lines, products, suppliers and warehouses remain correctly scoped', t => {
  const f = fixture(t);
  const product2 = f.service.createProduct({ name: '其他商品', stockUnit: '袋' }, confirmed('p2'));
  const warehouse2 = f.service.createWarehouse({ name: '第二仓库' }, confirmed('w2'));
  const supplier2 = f.service.createSupplier({ name: '第二供应商' }, confirmed('s2'));
  const input = f.receipt();
  input.lines.push({ productId: product2.id, unit: '袋', quantity: '2', amountCents: '201' });
  input.lines.push({ ...input.lines[0]!, quantity: '1', amountCents: '5' });
  assert.equal(f.service.confirmPurchaseReceipt(input, confirmed('r1')).totalCents, '306');
  f.service.confirmPurchaseReceipt({ ...f.receipt('1', '99'), supplierId: supplier2.id, warehouseId: warehouse2.id }, confirmed('r2'));
  assert.deepEqual(f.stock().quantity, rational('4'));
  assert.deepEqual(f.stock().averageCostCents, rational('105', '4'));
  assert.deepEqual(f.service.getStock(product2.id, f.warehouse.id).averageCostCents, rational('201', '2'));
  assert.deepEqual(f.service.getStock(f.product.id, warehouse2.id).valueCents, rational('99'));
  assert.deepEqual(f.service.listOpenPayables(f.supplier.id).map(p => p.openCents), ['306']);
  assert.deepEqual(f.service.listOpenPayables(supplier2.id).map(p => p.openCents), ['99']);
});

test('ERP: amounts beyond JS safe integers are exact and zero-value stock has no open debt', t => {
  const f = fixture(t);
  f.service.confirmPurchaseReceipt(f.receipt('1', '9007199254740993'), confirmed('r1'));
  f.service.confirmPurchaseReceipt(f.receipt('1', '0'), confirmed('r2'));
  assert.deepEqual(f.stock().valueCents, rational('9007199254740993'));
  assert.deepEqual(f.stock().averageCostCents, rational('9007199254740993', '2'));
  assert.equal(f.service.listOpenPayables().length, 1);
  assert.equal(f.service.listPurchaseReceipts().length, 2);
});

test('ERP: invalid money, quantity, unit, references and confirmation leave no records', t => {
  const f = fixture(t);
  const line = f.receipt().lines[0]!;
  const invalid: unknown[] = [null, {}, { ...f.receipt(), lines: [] }, { ...f.receipt(), supplierId: f.product.id },
    { ...f.receipt(), warehouseId: 'missing' }, { ...f.receipt(), totalCents: '1' }];
  for (const quantity of ['0', '0.000000', '-1', '1e3', '0.0000001', '01', 'Infinity', '1/3', 0.1])
    invalid.push({ ...f.receipt(), lines: [{ ...line, quantity }] });
  for (const amountCents of ['-1', '1.5', '1e2', '1000000000000000000', 100, NaN])
    invalid.push({ ...f.receipt(), lines: [{ ...line, amountCents }] });
  for (const patch of [{ unit: '箱' }, { productId: 'missing' }, { unit: ' ' }, { quantity: '2', cost: '1' }])
    invalid.push({ ...f.receipt(), lines: [line, { ...line, ...patch }] });
  for (const input of invalid) assert.throws(() => f.service.confirmPurchaseReceipt(input, confirmed('bad')));
  for (const patch of [{ confirmed: false }, { actorId: '' }, { channel: 'unknown' }, { confirmationId: ' ' }])
    assert.throws(() => f.service.confirmPurchaseReceipt(f.receipt(), { ...confirmed('bad'), ...patch }), errorCode('invalid_input'));
  assert.throws(() => f.service.createProduct({ name: ' ', stockUnit: '瓶' }, confirmed('bad')), errorCode('invalid_input'));
  assert.deepEqual(f.service.listPurchaseReceipts(), []);
  assert.deepEqual(f.service.listOpenPayables(), []);
  assert.equal(f.service.listAuditEvents().length, 3);
  assert.deepEqual(f.stock().quantity, rational('0'));
  // Rejected operation keys are not consumed.
  f.service.confirmPurchaseReceipt(f.receipt(), confirmed('bad'));
  assert.equal(f.service.listPurchaseReceipts().length, 1);
});

test('ERP: failure after all writes rolls back receipt, stock, payable, audit and retry key', t => {
  const f = fixture(t);
  f.service.confirmPurchaseReceipt(f.receipt('2', '20'), confirmed('existing'));
  const before = { stock: f.stock(), receipts: f.service.listPurchaseReceipts(), payables: f.service.listOpenPayables(), audit: f.service.listAuditEvents() };
  f.setFailure(true);
  assert.throws(() => f.service.confirmPurchaseReceipt(f.receipt(), confirmed('retry')), /Injected failure/);
  assert.throws(() => f.service.createSupplier({ name: '失败供应商' }, confirmed('failed-supplier')), /Injected failure/);
  assert.equal(f.service.listMasters('supplier').length, 1);
  assert.deepEqual({ stock: f.stock(), receipts: f.service.listPurchaseReceipts(), payables: f.service.listOpenPayables(), audit: f.service.listAuditEvents() }, before);
  f.reopen();
  assert.equal(f.service.getPurchaseReceipt('retry'), undefined);
  const posted = f.service.confirmPurchaseReceipt(f.receipt(), confirmed('retry'));
  assert.deepEqual(f.service.confirmPurchaseReceipt(f.receipt(), confirmed('retry')), posted);
  assert.deepEqual(f.stock().quantity, rational('5'));
  assert.equal(f.service.listOpenPayables().length, 2);
  assert.equal(f.service.listAuditEvents().length, 5);
});
