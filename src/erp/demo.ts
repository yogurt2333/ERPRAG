import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErpService, type Confirmation } from './service.ts';

const directory = mkdtempSync(join(tmpdir(), 'lean-erp-demo-'));
const erp = new ErpService(join(directory, 'demo.sqlite'));
const confirmed = (id: string): Confirmation => ({ operationId: id, actorId: 'synthetic-demo-operator', channel: 'cli', confirmationId: id, confirmed: true });
try {
  const product = erp.createProduct({ name: '合成演示饮料', stockUnit: '瓶' }, confirmed('product'));
  const supplier = erp.createSupplier({ name: '合成演示供应商' }, confirmed('supplier'));
  const warehouse = erp.createWarehouse({ name: '合成演示仓库' }, confirmed('warehouse'));
  const input = { supplierId: supplier.id, warehouseId: warehouse.id,
    lines: [{ productId: product.id, unit: '瓶', quantity: '3', amountCents: '100' }] };
  const receipt = erp.confirmPurchaseReceipt(input, confirmed('receipt'));
  const retry = erp.confirmPurchaseReceipt(input, confirmed('receipt'));
  const customer = erp.createCustomer({ name: '合成演示客户' }, confirmed('customer'));
  const order = erp.createSalesOrder({ customerId: customer.id, warehouseId: warehouse.id,
    lines: [{ productId: product.id, unit: '瓶', quantity: '5', amountCents: '250' }] }, confirmed('order'));
  const delivery = erp.confirmDelivery({ orderId: order.id, expectedRevision: order.revision,
    lines: [{ orderLineIndex: 0, quantity: '1', amountCents: '50' }] }, confirmed('delivery'));
  const settlementProposal = erp.previewSettlement({ kind: 'customer_receipt', partyId: customer.id, amountCents: '30' });
  const settlement = erp.confirmSettlement(settlementProposal, confirmed('collection'));
  const paymentProposal = erp.previewSettlement({ kind: 'supplier_payment', partyId: supplier.id, amountCents: '120' });
  const payment = erp.confirmSettlement(paymentProposal, confirmed('payment'));
  console.log(JSON.stringify({ synthetic: true, receipt, retryReturnedSameReceipt: JSON.stringify(receipt) === JSON.stringify(retry),
    settlementProposal, settlement, paymentProposal, payment,
    supplierPrepayment: erp.getAdvanceBalance({ kind: 'supplier_payment', partyId: supplier.id }),
    order, delivery, fulfillment: erp.getOrderFulfillment(order.id), receivables: erp.listOpenReceivables(),
    stock: erp.getStock(product.id, warehouse.id), payables: erp.listOpenPayables(), audit: erp.listAuditEvents() }, null, 2));
} finally {
  erp.close();
  rmSync(directory, { recursive: true, force: true });
}
