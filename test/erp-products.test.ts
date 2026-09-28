import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ErpService, BusinessError, type Confirmation } from '../src/erp/service.ts';

const c = (id: string): Confirmation => ({ operationId: id, actorId: 'operator', channel: 'cli', confirmationId: id, confirmed: true });
const r = (numerator: string, denominator = '1') => ({ numerator, denominator });
function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-products-'));
  const path = join(dir, 'erp.sqlite');
  let fail = false;
  let service = new ErpService(path, { beforeCommit() { if (fail) throw new Error('injected'); } });
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }); });
  const product = service.createProduct({ name: '合成饮料', stockUnit: '瓶' }, c('p'));
  const supplier = service.createSupplier({ name: '合成供应商' }, c('s'));
  const warehouse = service.createWarehouse({ name: '测试仓' }, c('w'));
  return { get service() { return service; }, product, warehouse,
    receipt: { supplierId: supplier.id, warehouseId: warehouse.id,
      lines: [{ productId: product.id, unit: '瓶', quantity: '1', amountCents: '100' }] },
    details: { productId: product.id, expectedRevision: 1, aliases: ['饮料'], specification: '250ml', barcode: null, shelfLifeDays: 30 },
    pack: { productId: product.id, unit: '箱', expectedVersion: 0, stockUnits: r('12') },
    fail(value: boolean) { fail = value; },
    reopen(asV3 = false) { service.close(); if (asV3) {
      const db = new DatabaseSync(path);
      db.exec('DROP TABLE inventory_operations; DROP TABLE stocktakes; DROP TABLE return_refunds; DROP TABLE quarantine_resolutions; DROP TABLE quarantines; DROP TABLE returns; DROP TABLE reversals; DROP TABLE product_followups; DROP TABLE pack_versions; DROP TABLE product_details; DROP TABLE operation_drafts; DROP TABLE draft_events; DROP TABLE notification_events; DROP TABLE followup_history; DROP TABLE followups; PRAGMA user_version = 3;'); db.close();
    } service = new ErpService(path); } };
}
const invalid = (error: unknown) => error instanceof BusinessError && error.code === 'invalid_input';

test('ERP products: provisional receipt and durable missing data can be completed without duplicate products', t => {
  const f = fixture(t);
  assert.equal(f.service.getProduct(f.product.id).provisional, true);
  f.service.confirmPurchaseReceipt(f.receipt, c('r'));
  f.reopen();
  assert.deepEqual(f.service.listProductFollowups()[0]?.missingFields, ['specification', 'shelfLifeDays', 'packUnits']);
  f.service.updateProductDetails({ ...f.details, barcode: '123456' }, c('details'));
  f.service.definePackUnit(f.pack, c('pack'));
  f.reopen();
  assert.equal(f.service.getProduct(f.product.id).provisional, false);
  assert.deepEqual(f.service.getProduct(f.product.id).aliases, ['饮料']);
  assert.equal(f.service.getProduct(f.product.id).barcode, '123456');
  assert.equal(f.service.listMasters('product').length, 1);
  assert.equal(f.service.listProductFollowups()[0]?.status, 'resolved');
  assert.throws(() => f.service.updateProductDetails(f.details, c('stale')), /Product changed/);
});

test('ERP products: exact fractional packs and version snapshots preserve stock, valuation and retries', t => {
  const f = fixture(t);
  f.service.definePackUnit({ ...f.pack, stockUnits: r('10', '3') }, c('pack1'));
  const input = { ...f.receipt, lines: [{ ...f.receipt.lines[0]!, unit: '箱', quantity: '0.3', packVersion: 1 }] };
  const first = f.service.confirmPurchaseReceipt(input, c('r1'));
  assert.deepEqual(first.lines[0]?.stockQuantity, r('1'));
  f.service.definePackUnit({ ...f.pack, expectedVersion: 1, stockUnits: r('24') }, c('pack2'));
  f.service.confirmPurchaseReceipt({ ...input, lines: [{ ...input.lines[0]!, quantity: '1', packVersion: 2 }] }, c('r2'));
  f.reopen();
  assert.deepEqual(f.service.confirmPurchaseReceipt(input, c('r1')), first);
  assert.deepEqual(f.service.getPurchaseReceipt('r1'), first);
  const stock = f.service.getStock(f.product.id, f.warehouse.id);
  assert.deepEqual(stock.quantity, r('25'));
  assert.deepEqual(stock.averageCostCents, r('8'));
  assert.equal(f.service.listPackVersions(f.product.id).length, 2);
  assert.throws(() => f.service.definePackUnit(f.pack, c('stale')), /Pack changed/);
});

test('ERP products: managed expiry crosses leap day and year, preserves unknowns and historical basis', t => {
  const f = fixture(t);
  f.service.updateProductDetails({ ...f.details, shelfLifeDays: 1 }, c('details'));
  for (const [id, date] of [['leap', '2024-02-28'], ['year', '2025-12-31']] as const)
    f.service.confirmPurchaseReceipt({ ...f.receipt, lines: [{ ...f.receipt.lines[0]!, earliestProductionDate: date }] }, c(id));
  f.service.confirmPurchaseReceipt(f.receipt, c('unknown'));
  f.service.updateProductDetails({ ...f.details, expectedRevision: 2, shelfLifeDays: 999 }, c('changed'));
  f.reopen();
  assert.deepEqual(f.service.listManagedExpiry().map(l => l.managedExpiryDate), ['2024-02-29', '2026-01-01', null]);
  assert.ok(f.service.listManagedExpiry().every(l => l.basis === 'operational_estimate'));
  assert.deepEqual(f.service.summarizeManagedExpiry('2026-01-01'), {
    basis: 'operational_estimate', throughDate: '2026-01-01', receiptLinesDue: 2, receiptLinesUnknown: 1 });
});

test('ERP products: invalid conversion, version, scope and dates cannot post stock or payable', t => {
  const f = fixture(t);
  for (const stockUnits of [r('0'), r('1', '0'), r('-1'), r('1.5')])
    assert.throws(() => f.service.definePackUnit({ ...f.pack, stockUnits }, c('bad')), invalid);
  assert.throws(() => f.service.definePackUnit({ ...f.pack, unit: '瓶' }, c('bad')), invalid);
  f.service.definePackUnit(f.pack, c('pack'));
  for (const patch of [{ unit: '箱' }, { unit: '箱', packVersion: 2 }, { packVersion: 1 },
    { earliestProductionDate: '2025-02-29' }, { earliestProductionDate: '2026-13-01' }])
    assert.throws(() => f.service.confirmPurchaseReceipt({ ...f.receipt, lines: [{ ...f.receipt.lines[0]!, ...patch }] }, c('bad')), invalid);
  const other = f.service.createProduct({ name: '另一个商品', stockUnit: '瓶' }, c('other'));
  assert.throws(() => f.service.confirmPurchaseReceipt({ ...f.receipt, lines: [{ ...f.receipt.lines[0]!, productId: other.id, unit: '箱', packVersion: 1 }] }, c('bad')), invalid);
  assert.deepEqual(f.service.listPurchaseReceipts(), []);
  assert.deepEqual(f.service.listOpenPayables(), []);
});

test('ERP products: injected failure rolls back product, followup, pack, details and receipt together with audit', t => {
  const f = fixture(t);
  const before = f.service.listAuditEvents();
  f.fail(true);
  assert.throws(() => f.service.createProduct({ name: '失败商品', stockUnit: '个' }, c('new')), /injected/);
  assert.throws(() => f.service.definePackUnit(f.pack, c('pack')), /injected/);
  assert.throws(() => f.service.updateProductDetails(f.details, c('details')), /injected/);
  assert.throws(() => f.service.confirmPurchaseReceipt(f.receipt, c('receipt')), /injected/);
  assert.deepEqual(f.service.listAuditEvents(), before);
  assert.equal(f.service.listProductFollowups().length, 1);
  assert.equal(f.service.listMasters('product').length, 1);
  assert.equal(f.service.getProduct(f.product.id).revision, 1);
  assert.deepEqual(f.service.listPackVersions(f.product.id), []);
  assert.deepEqual(f.service.listPurchaseReceipts(), []);
  f.fail(false);
  f.service.definePackUnit(f.pack, c('pack'));
  f.service.updateProductDetails(f.details, c('details'));
  f.service.confirmPurchaseReceipt(f.receipt, c('receipt'));
});

test('ERP products: schema 3 migration preserves existing receipt and stock and records unknown master data', t => {
  const f = fixture(t);
  const receipt = f.service.confirmPurchaseReceipt(f.receipt, c('r'));
  const stock = f.service.getStock(f.product.id, f.warehouse.id);
  f.reopen(true); f.reopen();
  assert.deepEqual(f.service.getPurchaseReceipt('r'), receipt);
  assert.deepEqual(f.service.getStock(f.product.id, f.warehouse.id), stock);
  assert.equal(f.service.getProduct(f.product.id).shelfLifeDays, null);
  assert.equal(f.service.listProductFollowups()[0]?.status, 'open');
});
