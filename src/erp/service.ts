import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { openDatabase } from './database.ts';
import { add, compare, decimal, divide, multiply, subtract, ratio, zero, type Rational } from './exact.ts';

const text = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' });
const object = <T extends Record<string, import('@sinclair/typebox').TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const confirmationSchema = object({
  operationId: text, actorId: text, channel: Type.Union([Type.Literal('cli'), Type.Literal('web'), Type.Literal('hermes')]),
  confirmationId: text, confirmed: Type.Literal(true)
});
export type Confirmation = Static<typeof confirmationSchema>;
const productSchema = object({ name: text, stockUnit: text });
const namedSchema = object({ name: text });
const dueDateSchema = Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' });
const receiptSchema = object({
  supplierId: text, warehouseId: text, dueDate: Type.Optional(dueDateSchema),
  lines: Type.Array(object({
    productId: text, unit: text,
    quantity: Type.String({ pattern: '^(0|[1-9][0-9]{0,17})(\\.[0-9]{1,6})?$' }),
    amountCents: Type.String({ pattern: '^(0|[1-9][0-9]{0,17})$' })
  }), { minItems: 1, maxItems: 500 })
});
export type PurchaseReceiptInput = Static<typeof receiptSchema>;
const orderSchema = object({ customerId: text, warehouseId: text, lines: receiptSchema.properties.lines });
const orderChangeSchema = object({ orderId: text, expectedRevision: Type.Integer({ minimum: 1 }), order: orderSchema });
const cancelSchema = object({ orderId: text, expectedRevision: Type.Integer({ minimum: 1 }) });
const deliverySchema = object({ orderId: text, expectedRevision: Type.Integer({ minimum: 1 }),
  dueDate: Type.Optional(dueDateSchema),
  lines: Type.Array(object({ orderLineIndex: Type.Integer({ minimum: 0, maximum: 499 }),
    quantity: receiptSchema.properties.lines.items.properties.quantity,
    amountCents: receiptSchema.properties.lines.items.properties.amountCents
  }), { minItems: 1, maxItems: 500 }) });
const centsSchema = receiptSchema.properties.lines.items.properties.amountCents;
const settlementSchema = object({
  kind: Type.Union([Type.Literal('customer_receipt'), Type.Literal('supplier_payment')]),
  partyId: text, amountCents: centsSchema
});
const allocationSchema = Type.Array(object({ obligationId: text, amountCents: centsSchema }), { maxItems: 500 });
const settlementConfirmationSchema = object({ ...settlementSchema.properties, allocations: allocationSchema,
  excessCents: centsSchema,
  excessKind: Type.Union([Type.Literal('customer_advance'), Type.Literal('supplier_prepayment')]) });
const combinedSchema = object({ delivery: deliverySchema, amountCents: centsSchema });
export type SettlementInput = Static<typeof settlementSchema>;
export type Allocation = Static<typeof allocationSchema>[number];
export interface SettlementProposal extends SettlementInput {
  allocations: Allocation[]; excessCents: string; excessKind: 'customer_advance' | 'supplier_prepayment';
}
export interface PostedSettlement extends SettlementProposal {
  id: string; status: 'posted'; currency: 'CNY'; postedAt: string; linkedDeliveryId?: string;
}
export interface OpenObligation {
  obligationId: string; dueDate: string; dueDateSource: 'explicit' | 'posting_date'; openCents: string;
}
export interface PostedDeliveryAndReceipt { id: string; delivery: PostedDelivery; settlement: PostedSettlement }
export interface SalesOrder extends Static<typeof orderSchema> {
  id: string; revision: number; status: 'open' | 'cancelled'; createdAt: string; updatedAt: string;
}
export interface PostedDelivery {
  dueDate?: string;
  id: string; orderId: string; customerId: string; warehouseId: string; orderRevision: number;
  status: 'posted'; currency: 'CNY'; postedAt: string; totalCents: string; costCents: Rational; grossProfitCents: Rational;
  lines: { orderLineIndex: number; productId: string; unit: string; quantity: string; amountCents: string; costCents: Rational }[];
}
export interface Master { id: string; name: string; kind: 'product' | 'supplier' | 'warehouse' | 'customer'; stockUnit: string | null }
export interface PostedReceipt extends PurchaseReceiptInput {
  id: string; status: 'posted'; currency: 'CNY'; totalCents: string; postedAt: string;
}
export interface AuditEvidence extends Confirmation { action: string; recordId: string; recordedAt: string; allocationDecision?: unknown }
export class BusinessError extends Error {
  readonly code: 'invalid_input' | 'not_found' | 'idempotency_conflict' | 'busy' | 'conflict' | 'insufficient_stock';
  constructor(code: BusinessError['code'], message: string) {
    super(message); this.name = 'BusinessError'; this.code = code;
  }
}
function validate<T extends import('@sinclair/typebox').TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) throw new BusinessError('invalid_input', 'Invalid business operation input');
  return value;
}
function validateDueDate(value: string | undefined): void {
  if (value !== undefined && (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
    throw new BusinessError('invalid_input', 'Due date must be a valid calendar date');
}
// Object-key ordering has no business meaning when a channel retries a request.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value)!;
}

/** Trusted application boundary. Future authenticated adapters supply actor/channel.
 * No SQL handle or arbitrary mutation operation is exposed to clients.
 */
export class ErpService {
  #db: ReturnType<typeof openDatabase>;
  #beforeCommit?: () => void;
  constructor(path: string, options: { beforeCommit?: () => void } = {}) {
    this.#db = openDatabase(path);
    // Composition-time fault seam for transaction tests; never a command field.
    this.#beforeCommit = options.beforeCommit;
  }
  close(): void { this.#db.close(); }

  createProduct(input: unknown, confirmation: unknown): Master {
    const value = validate(productSchema, input);
    return this.#createMaster('product', value.name, value.stockUnit, confirmation);
  }
  createSupplier(input: unknown, confirmation: unknown): Master {
    return this.#createMaster('supplier', validate(namedSchema, input).name, null, confirmation);
  }
  createWarehouse(input: unknown, confirmation: unknown): Master {
    return this.#createMaster('warehouse', validate(namedSchema, input).name, null, confirmation);
  }
  createCustomer(input: unknown, confirmation: unknown): Master {
    return this.#createMaster('customer', validate(namedSchema, input).name, null, confirmation);
  }
  #createMaster(kind: Master['kind'], name: string, stockUnit: string | null, confirmation: unknown): Master {
    return this.#post(`create_${kind}`, { name, stockUnit }, confirmation, () => {
      const master: Master = { id: randomUUID(), kind, name, stockUnit };
      if (kind === 'customer') this.#db.prepare('INSERT INTO customers VALUES (?, ?)').run(master.id, name);
      else this.#db.prepare('INSERT INTO masters VALUES (?, ?, ?, ?)').run(master.id, kind, name, stockUnit);
      return master;
    });
  }
  listMasters(kind: Master['kind']): Master[] {
    if (kind === 'customer') return this.#db.prepare('SELECT id, name FROM customers ORDER BY rowid').all()
      .map(row => ({ id: row.id as string, name: row.name as string, kind, stockUnit: null }));
    return this.#db.prepare('SELECT id, kind, name, stock_unit AS stockUnit FROM masters WHERE kind = ? ORDER BY rowid')
      .all(kind).map(row => ({ ...row }) as unknown as Master);
  }
  #requireMaster(id: string, kind: Master['kind']): Master {
    if (kind === 'customer') {
      const row = this.#db.prepare('SELECT id, name FROM customers WHERE id = ?').get(id);
      if (!row) throw new BusinessError('not_found', `Unknown customer: ${id}`);
      return { id, name: row.name as string, kind, stockUnit: null };
    }
    const row = this.#db.prepare('SELECT id, kind, name, stock_unit AS stockUnit FROM masters WHERE id = ? AND kind = ?').get(id, kind);
    if (!row) throw new BusinessError('not_found', `Unknown ${kind}: ${id}`);
    return row as unknown as Master;
  }

  confirmPurchaseReceipt(raw: unknown, confirmation: unknown): PostedReceipt {
    const input = validate(receiptSchema, raw);
    validateDueDate(input.dueDate);
    for (const line of input.lines) if (BigInt(decimal(line.quantity).numerator) <= 0n)
      throw new BusinessError('invalid_input', 'Receipt quantity must be positive');
    return this.#post('purchase_receipt', input, confirmation, (context, postedAt) => {
      this.#requireMaster(input.supplierId, 'supplier');
      this.#requireMaster(input.warehouseId, 'warehouse');
      for (const line of input.lines) {
        if (this.#requireMaster(line.productId, 'product').stockUnit !== line.unit)
          throw new BusinessError('invalid_input', 'Only the exact stock unit is supported; pack conversion is not yet available');
      }
      const receipt: PostedReceipt = { ...input, id: context.operationId, status: 'posted', currency: 'CNY', postedAt,
        totalCents: String(input.lines.reduce((sum, line) => sum + BigInt(line.amountCents), 0n)) };
      return receipt;
    }, receipt => {
      this.#db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?)')
        .run(receipt.id, receipt.supplierId, receipt.warehouseId, JSON.stringify(receipt));
      for (const [index, line] of receipt.lines.entries()) this.#db.prepare('INSERT INTO stock_ledger VALUES (?, ?, ?, ?, ?, ?)')
        .run(receipt.id, index, line.productId, receipt.warehouseId, JSON.stringify(decimal(line.quantity)), line.amountCents);
      this.#db.prepare('INSERT INTO payable_ledger VALUES (?, ?, ?)').run(receipt.id, receipt.supplierId, receipt.totalCents);
    });
  }

  #validateOrder(input: Static<typeof orderSchema>): void {
    this.#requireMaster(input.customerId, 'customer');
    this.#requireMaster(input.warehouseId, 'warehouse');
    for (const line of input.lines) {
      if (compare(decimal(line.quantity), zero()) <= 0 || this.#requireMaster(line.productId, 'product').stockUnit !== line.unit)
        throw new BusinessError('invalid_input', 'Positive quantity in the product stock unit is required');
    }
  }
  createSalesOrder(raw: unknown, confirmation: unknown): SalesOrder {
    const input = validate(orderSchema, raw);
    return this.#post('create_sales_order', input, confirmation, (context, now) => {
      this.#validateOrder(input);
      return { ...input, id: context.operationId, revision: 1, status: 'open', createdAt: now, updatedAt: now };
    }, order => this.#db.prepare('INSERT INTO sales_orders VALUES (?, ?, ?)').run(order.id, order.customerId, JSON.stringify(order)));
  }
  #openOrder(id: string, revision: number): SalesOrder {
    const order = this.getSalesOrder(id);
    if (!order) throw new BusinessError('not_found', 'Unknown sales order');
    if (order.status !== 'open' || order.revision !== revision)
      throw new BusinessError('conflict', 'Order cancelled or changed; refresh before confirming');
    return order;
  }
  #unfulfilledOrder(id: string, revision: number): SalesOrder {
    const order = this.#openOrder(id, revision);
    if (this.listDeliveries(id).length) throw new BusinessError('conflict', 'Delivered orders require a later reversal/correction operation');
    return order;
  }
  changeSalesOrder(raw: unknown, confirmation: unknown): SalesOrder {
    const input = validate(orderChangeSchema, raw);
    return this.#post('change_sales_order', input, confirmation, (_context, now) => {
      const previous = this.#unfulfilledOrder(input.orderId, input.expectedRevision);
      this.#validateOrder(input.order);
      return { ...previous, ...input.order, revision: previous.revision + 1, updatedAt: now };
    }, order => this.#db.prepare('UPDATE sales_orders SET customer_id = ?, document = ? WHERE id = ?')
      .run(order.customerId, JSON.stringify(order), order.id));
  }
  cancelSalesOrder(raw: unknown, confirmation: unknown): SalesOrder {
    const input = validate(cancelSchema, raw);
    return this.#post('cancel_sales_order', input, confirmation, (_context, now) => {
      const previous = this.#unfulfilledOrder(input.orderId, input.expectedRevision);
      return { ...previous, status: 'cancelled', revision: previous.revision + 1, updatedAt: now };
    }, order => this.#db.prepare('UPDATE sales_orders SET document = ? WHERE id = ?').run(JSON.stringify(order), order.id));
  }
  getSalesOrder(id: string): SalesOrder | undefined {
    const row = this.#db.prepare('SELECT document FROM sales_orders WHERE id = ?').get(id);
    return row ? JSON.parse(row.document as string) as SalesOrder : undefined;
  }
  listSalesOrders(): SalesOrder[] {
    return this.#db.prepare('SELECT document FROM sales_orders ORDER BY rowid').all().map(row => JSON.parse(row.document as string) as SalesOrder);
  }
  getOrderFulfillment(id: string): { orderId: string; status: 'open' | 'partial' | 'fulfilled' | 'cancelled';
    lines: { orderLineIndex: number; delivered: Rational; backorder: Rational }[] } {
    const order = this.getSalesOrder(id);
    if (!order) throw new BusinessError('not_found', 'Unknown sales order');
    const deliveries = this.listDeliveries(id);
    const lines = order.lines.map((line, orderLineIndex) => {
      const delivered = deliveries.flatMap(d => d.lines).filter(l => l.orderLineIndex === orderLineIndex)
        .reduce((sum, l) => add(sum, decimal(l.quantity)), zero());
      return { orderLineIndex, delivered, backorder: order.status === 'cancelled' ? zero() : subtract(decimal(line.quantity), delivered) };
    });
    return { orderId: id, status: order.status === 'cancelled' ? 'cancelled' : lines.every(l => l.backorder.numerator === '0')
      ? 'fulfilled' : deliveries.length ? 'partial' : 'open', lines };
  }
  confirmDelivery(raw: unknown, confirmation: unknown): PostedDelivery {
    const input = validate(deliverySchema, raw);
    validateDueDate(input.dueDate);
    return this.#post('delivery', input, confirmation,
      (context, now) => this.#buildDelivery(input, context.operationId, now), delivery => this.#saveDelivery(delivery));
  }
  #buildDelivery(input: Static<typeof deliverySchema>, id: string, now: string): PostedDelivery {
      const order = this.#openOrder(input.orderId, input.expectedRevision);
      const fulfillment = this.getOrderFulfillment(order.id);
      const seen = new Set<number>();
      const available = new Map<string, ReturnType<ErpService['getStock']>>();
      const lines = input.lines.map(line => {
        const source = order.lines[line.orderLineIndex];
        const quantity = decimal(line.quantity);
        if (!source || seen.has(line.orderLineIndex) || compare(quantity, zero()) <= 0)
          throw new BusinessError('invalid_input', 'Delivery requires unique valid order lines and positive quantities');
        seen.add(line.orderLineIndex);
        if (compare(quantity, fulfillment.lines[line.orderLineIndex]!.backorder) > 0)
          throw new BusinessError('conflict', 'Delivery exceeds the remaining order quantity');
        const stock = available.get(source.productId) ?? this.getStock(source.productId, order.warehouseId);
        if (compare(quantity, stock.quantity) > 0)
          throw new BusinessError('insufficient_stock', 'Delivery would make available stock negative');
        const costCents = multiply(stock.averageCostCents!, quantity);
        available.set(source.productId, { ...stock, quantity: subtract(stock.quantity, quantity), valueCents: subtract(stock.valueCents, costCents) });
        return { ...line, productId: source.productId, unit: source.unit, costCents };
      });
      const totalCents = String(lines.reduce((sum, l) => sum + BigInt(l.amountCents), 0n));
      const costCents = lines.reduce((sum, l) => add(sum, l.costCents), zero());
      return { id, ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }), orderId: order.id, customerId: order.customerId, warehouseId: order.warehouseId,
        orderRevision: order.revision, status: 'posted', currency: 'CNY', postedAt: now, lines, totalCents, costCents,
        grossProfitCents: subtract(ratio(BigInt(totalCents)), costCents) };
  }
  #saveDelivery(delivery: PostedDelivery): void {
      this.#db.prepare('INSERT INTO deliveries VALUES (?, ?, ?)').run(delivery.id, delivery.orderId, JSON.stringify(delivery));
      for (const [index, line] of delivery.lines.entries()) this.#db.prepare('INSERT INTO stock_issues VALUES (?, ?, ?, ?, ?, ?)')
        .run(delivery.id, index, line.productId, delivery.warehouseId, JSON.stringify(decimal(line.quantity)), JSON.stringify(line.costCents));
      this.#db.prepare('INSERT INTO receivable_ledger VALUES (?, ?, ?)').run(delivery.id, delivery.customerId, delivery.totalCents);
  }
  getDelivery(id: string): PostedDelivery | undefined {
    const row = this.#db.prepare('SELECT document FROM deliveries WHERE id = ?').get(id);
    return row ? JSON.parse(row.document as string) as PostedDelivery : undefined;
  }
  listDeliveries(orderId?: string): PostedDelivery[] {
    const rows = orderId === undefined ? this.#db.prepare('SELECT document FROM deliveries ORDER BY rowid').all()
      : this.#db.prepare('SELECT document FROM deliveries WHERE order_id = ? ORDER BY rowid').all(orderId);
    return rows.map(row => JSON.parse(row.document as string) as PostedDelivery);
  }
  listOpenReceivables(customerId?: string): { deliveryId: string; customerId: string; openCents: string; currency: 'CNY' }[] {
    const rows = customerId === undefined ? this.#db.prepare('SELECT * FROM receivable_ledger ORDER BY rowid').all()
      : this.#db.prepare('SELECT * FROM receivable_ledger WHERE customer_id = ? ORDER BY rowid').all(customerId);
    for (const row of rows) row.amount_cents = String(BigInt(row.amount_cents as string) - this.#allocated(row.delivery_id as string));
    return rows.filter(row => BigInt(row.amount_cents as string) > 0n).map(row => ({ deliveryId: row.delivery_id as string,
      customerId: row.customer_id as string, openCents: row.amount_cents as string, currency: 'CNY' }));
  }

  #allocated(obligationId: string): bigint {
    return this.#db.prepare('SELECT amount_cents FROM settlement_allocations WHERE obligation_id = ?').all(obligationId)
      .reduce((sum, row) => sum + BigInt(row.amount_cents as string), 0n);
  }
  listOpenObligations(raw: unknown): OpenObligation[] {
    const input = validate(object({ kind: settlementSchema.properties.kind, partyId: text }), raw);
    this.#requireMaster(input.partyId, input.kind === 'customer_receipt' ? 'customer' : 'supplier');
    const obligations = input.kind === 'customer_receipt'
      ? this.listOpenReceivables(input.partyId).map(row => ({ obligationId: row.deliveryId, openCents: row.openCents,
        document: this.getDelivery(row.deliveryId)! }))
      : this.listOpenPayables(input.partyId).map(row => ({ obligationId: row.receiptId, openCents: row.openCents,
        document: this.getPurchaseReceipt(row.receiptId)! }));
    return obligations.map(({ obligationId, openCents, document }): OpenObligation => ({ obligationId, openCents,
      dueDate: document.dueDate ?? document.postedAt.slice(0, 10), dueDateSource: document.dueDate ? 'explicit' : 'posting_date' }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.obligationId.localeCompare(b.obligationId));
  }
  /** Pure proposal: caller reviews this exact allocation before confirmation. */
  previewSettlement(raw: unknown, override?: unknown): SettlementProposal {
    const input = validate(settlementSchema, raw);
    const open = this.listOpenObligations({ kind: input.kind, partyId: input.partyId });
    let remaining = BigInt(input.amountCents);
    const allocations: Allocation[] = [];
    if (override !== undefined) return this.#checkAllocation(input, validate(allocationSchema, override), open);
    for (const obligation of open) {
      if (remaining === 0n || allocations.length === 500) break;
      const amount = remaining < BigInt(obligation.openCents) ? remaining : BigInt(obligation.openCents);
      allocations.push({ obligationId: obligation.obligationId, amountCents: String(amount) });
      remaining -= amount;
    }
    if (remaining > 0n && open.length > allocations.length)
      throw new BusinessError('invalid_input', 'More than 500 obligations: split the settlement or select explicit allocations');
    return this.#checkAllocation(input, allocations, open);
  }
  #checkAllocation(input: SettlementInput, allocations: Allocation[], open: OpenObligation[]): SettlementProposal {
    if (BigInt(input.amountCents) <= 0n) throw new BusinessError('invalid_input', 'Settlement amount must be positive');
    let remaining = BigInt(input.amountCents);
    const seen = new Set<string>();
    for (const allocation of allocations) {
      const obligation = open.find(item => item.obligationId === allocation.obligationId);
      const amount = BigInt(allocation.amountCents);
      if (seen.has(allocation.obligationId) || amount <= 0n)
        throw new BusinessError('invalid_input', 'Allocation requires unique obligations and positive amounts');
      if (!obligation || amount > BigInt(obligation.openCents))
        throw new BusinessError('conflict', 'Obligation is closed, belongs to another party, or has insufficient open balance; review again');
      seen.add(allocation.obligationId);
      remaining -= amount;
    }
    if (remaining < 0n) throw new BusinessError('invalid_input', 'Allocations exceed settlement amount');
    return { ...input, allocations, excessCents: String(remaining),
      excessKind: input.kind === 'customer_receipt' ? 'customer_advance' : 'supplier_prepayment' };
  }
  confirmSettlement(raw: unknown, confirmation: unknown): PostedSettlement {
    const input = validate(settlementConfirmationSchema, raw);
    return this.#post('settlement', input, confirmation, (context, now) => {
      const proposal = this.previewSettlement({ kind: input.kind, partyId: input.partyId, amountCents: input.amountCents }, input.allocations);
      if (input.excessCents !== proposal.excessCents || input.excessKind !== proposal.excessKind)
        throw new BusinessError('invalid_input', 'Reviewed excess does not match allocation');
      return { ...proposal, id: context.operationId, status: 'posted', currency: 'CNY', postedAt: now };
    }, settlement => this.#saveSettlement(settlement));
  }
  #saveSettlement(settlement: PostedSettlement): void {
    this.#db.prepare('INSERT INTO settlements VALUES (?, ?, ?, ?)')
      .run(settlement.id, settlement.kind, settlement.partyId, JSON.stringify(settlement));
    for (const allocation of settlement.allocations)
      this.#db.prepare('INSERT INTO settlement_allocations VALUES (?, ?, ?)')
        .run(settlement.id, allocation.obligationId, allocation.amountCents);
  }
  listSettlements(): PostedSettlement[] {
    return this.#db.prepare('SELECT document FROM settlements ORDER BY rowid').all()
      .map(row => JSON.parse(row.document as string) as PostedSettlement);
  }
  getAdvanceBalance(raw: unknown): { amountCents: string; currency: 'CNY' } {
    const input = validate(object({ kind: settlementSchema.properties.kind, partyId: text }), raw);
    this.#requireMaster(input.partyId, input.kind === 'customer_receipt' ? 'customer' : 'supplier');
    const rows = this.#db.prepare('SELECT document FROM settlements WHERE kind = ? AND party_id = ?').all(input.kind, input.partyId);
    return { amountCents: String(rows.reduce((sum, row) => sum + BigInt((JSON.parse(row.document as string) as PostedSettlement).excessCents), 0n)), currency: 'CNY' };
  }
  /** Cash-on-delivery explicitly settles this delivery; old debts remain unchanged. */
  previewDeliveryAndReceipt(raw: unknown): { delivery: { totalCents: string; costCents: Rational; grossProfitCents: Rational };
    receipt: { amountCents: string; allocatedCents: string; excessCents: string; excessKind: 'customer_advance' } } {
    const input = validate(combinedSchema, raw);
    validateDueDate(input.delivery.dueDate);
    const delivery = this.#buildDelivery(input.delivery, 'preview', new Date().toISOString());
    const settlement = this.#deliverySettlement(delivery, input.amountCents);
    return { delivery: { totalCents: delivery.totalCents, costCents: delivery.costCents, grossProfitCents: delivery.grossProfitCents },
      receipt: { amountCents: settlement.amountCents, allocatedCents: String(BigInt(settlement.amountCents) - BigInt(settlement.excessCents)),
        excessCents: settlement.excessCents, excessKind: 'customer_advance' } };
  }
  #deliverySettlement(delivery: PostedDelivery, amountCents: string): PostedSettlement {
    const amount = BigInt(amountCents) < BigInt(delivery.totalCents) ? amountCents : delivery.totalCents;
    const proposal = this.#checkAllocation({ kind: 'customer_receipt', partyId: delivery.customerId, amountCents },
      BigInt(amount) === 0n ? [] : [{ obligationId: delivery.id, amountCents: amount }],
      [{ obligationId: delivery.id, openCents: delivery.totalCents, dueDate: delivery.dueDate ?? delivery.postedAt.slice(0, 10),
        dueDateSource: delivery.dueDate ? 'explicit' : 'posting_date' }]);
    return { ...proposal, id: delivery.id, linkedDeliveryId: delivery.id, status: 'posted', currency: 'CNY', postedAt: delivery.postedAt };
  }
  confirmDeliveryAndReceipt(raw: unknown, confirmation: unknown): PostedDeliveryAndReceipt {
    const input = validate(combinedSchema, raw);
    validateDueDate(input.delivery.dueDate);
    return this.#post('delivery_and_receipt', input, confirmation, (context, now) => {
      const delivery = this.#buildDelivery(input.delivery, context.operationId, now);
      return { id: context.operationId, delivery, settlement: this.#deliverySettlement(delivery, input.amountCents) };
    }, result => { this.#saveDelivery(result.delivery); this.#saveSettlement(result.settlement); });
  }

  #post<T extends { id: string }>(action: string, input: unknown, rawContext: unknown,
    build: (context: Confirmation, now: string) => T, effects?: (result: T) => void): T {
    const context = validate(confirmationSchema, rawContext);
    const request = canonical({ action, input, context });
    try {
      this.#db.exec('BEGIN IMMEDIATE');
      const prior = this.#db.prepare('SELECT request, result FROM operations WHERE id = ?').get(context.operationId);
      if (prior) {
        if (prior.request !== request) throw new BusinessError('idempotency_conflict', 'Operation ID already belongs to a different confirmation');
        this.#db.exec('COMMIT');
        return JSON.parse(prior.result as string) as T;
      }
      const now = new Date().toISOString();
      const result = build(context, now);
      this.#db.prepare('INSERT INTO operations VALUES (?, ?, ?)').run(context.operationId, request, JSON.stringify(result));
      effects?.(result);
      const evidence: AuditEvidence = { ...context, action, recordId: result.id, recordedAt: now };
      if (action === 'settlement' || action === 'delivery_and_receipt') evidence.allocationDecision = input;
      this.#db.prepare('INSERT INTO audit_events VALUES (?, ?)').run(context.operationId, JSON.stringify(evidence));
      this.#beforeCommit?.();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      if (error && typeof error === 'object' && 'errcode' in error && (Number(error.errcode) & 255) === 5)
        throw new BusinessError('busy', 'ERP is busy; retry the same confirmed operation');
      throw error;
    }
  }

  getPurchaseReceipt(id: string): PostedReceipt | undefined {
    const row = this.#db.prepare('SELECT document FROM receipts WHERE id = ?').get(id);
    return row ? JSON.parse(row.document as string) as PostedReceipt : undefined;
  }
  listPurchaseReceipts(): PostedReceipt[] {
    return this.#db.prepare('SELECT document FROM receipts ORDER BY rowid').all()
      .map(row => JSON.parse(row.document as string) as PostedReceipt);
  }
  getStock(productId: string, warehouseId: string): {
    productId: string; warehouseId: string; stockUnit: string; quantity: Rational; valueCents: Rational; averageCostCents: Rational | null;
  } {
    const product = this.#requireMaster(productId, 'product');
    this.#requireMaster(warehouseId, 'warehouse');
    const entries = this.#db.prepare(`
      SELECT quantity, value_cents, 0 AS is_issue FROM stock_ledger WHERE product_id = ? AND warehouse_id = ?
      UNION ALL
      SELECT quantity, cost_cents AS value_cents, 1 AS is_issue FROM stock_issues WHERE product_id = ? AND warehouse_id = ?
    `).all(productId, warehouseId, productId, warehouseId);
    let quantity = zero(), valueCents = zero();
    for (const entry of entries) {
      const delta = JSON.parse(entry.quantity as string) as Rational;
      if (entry.is_issue === 1) {
        quantity = subtract(quantity, delta);
        valueCents = subtract(valueCents, JSON.parse(entry.value_cents as string) as Rational);
      } else {
        quantity = add(quantity, delta);
        valueCents = add(valueCents, ratio(BigInt(entry.value_cents as string)));
      }
    }
    return { productId, warehouseId, stockUnit: product.stockUnit!, quantity, valueCents,
      averageCostCents: quantity.numerator === '0' ? null : divide(valueCents, quantity) };
  }
  listOpenPayables(supplierId?: string): { receiptId: string; supplierId: string; openCents: string; currency: 'CNY' }[] {
    const rows = supplierId === undefined
      ? this.#db.prepare('SELECT * FROM payable_ledger ORDER BY rowid').all()
      : this.#db.prepare('SELECT * FROM payable_ledger WHERE supplier_id = ? ORDER BY rowid').all(supplierId);
    for (const row of rows) row.amount_cents = String(BigInt(row.amount_cents as string) - this.#allocated(row.receipt_id as string));
    return rows.filter(row => BigInt(row.amount_cents as string) > 0n).map(row => ({ receiptId: row.receipt_id as string,
      supplierId: row.supplier_id as string, openCents: row.amount_cents as string, currency: 'CNY' }));
  }
  listAuditEvents(): AuditEvidence[] {
    return this.#db.prepare('SELECT evidence FROM audit_events ORDER BY rowid').all()
      .map(row => JSON.parse(row.evidence as string) as AuditEvidence);
  }
}
