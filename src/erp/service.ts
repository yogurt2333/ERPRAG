import { DraftStore, type DraftAction, type DraftContext, type DraftCommand } from './drafts.ts';
import { FollowupStore, type FollowupDecision, type NotificationEvent } from './followups.ts';
import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { openDatabase } from './database.ts';
import { add, negate, compare, decimal, divide, multiply, subtract, ratio, zero, type Rational } from './exact.ts';

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
const detailsSchema = object({ productId: text, expectedRevision: Type.Integer({ minimum: 1 }),
  aliases: Type.Array(text, { maxItems: 100, uniqueItems: true }),
  specification: Type.Union([text, Type.Null()]), barcode: Type.Union([text, Type.Null()]),
  shelfLifeDays: Type.Union([Type.Integer({ minimum: 1, maximum: 36500 }), Type.Null()]) });
const positiveInteger = Type.String({ pattern: '^[1-9][0-9]{0,17}$' });
const packSchema = object({ productId: text, unit: text, expectedVersion: Type.Integer({ minimum: 0 }),
  stockUnits: object({ numerator: positiveInteger, denominator: positiveInteger }) });
const receiptSchema = object({
  supplierId: text, warehouseId: text, dueDate: Type.Optional(dueDateSchema),
  lines: Type.Array(object({
    productId: text, unit: text,
    quantity: Type.String({ pattern: '^(0|[1-9][0-9]{0,17})(\\.[0-9]{1,6})?$' }),
    amountCents: Type.String({ pattern: '^(0|[1-9][0-9]{0,17})$' })
  }), { minItems: 1, maxItems: 500 })
});
const purchaseSchema = object({ ...receiptSchema.properties, lines: Type.Array(object({
  ...receiptSchema.properties.lines.items.properties,
  packVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  earliestProductionDate: Type.Optional(dueDateSchema)
}), { minItems: 1, maxItems: 500 }) });
export type PurchaseReceiptInput = Static<typeof purchaseSchema>;
export interface ProductDetails { aliases: string[]; specification: string | null; barcode: string | null; shelfLifeDays: number | null }
export interface PackVersion { id: string; productId: string; unit: string; version: number; stockUnits: Rational }
export interface ReceiptLineSnapshot { stockUnit: string; stockQuantity: Rational; conversion: Rational;
  shelfLifeDays: number | null; managedExpiryDate: string | null; expiryBasis: 'operational_estimate' }
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
  lines: (PurchaseReceiptInput['lines'][number] & Partial<ReceiptLineSnapshot>)[];
  id: string; status: 'posted'; currency: 'CNY'; totalCents: string; postedAt: string;
}
const reversalSchema = object({ originId: text, reason: text,
  kind: Type.Union([Type.Literal('purchase'), Type.Literal('sale'), Type.Literal('settlement')]) });
export interface ReversalProposal extends Static<typeof reversalSchema> {
  stock: { productId: string; warehouseId: string; quantity: Rational; valueCents: Rational }[];
  obligationCents: string; cashCents: string; excessCents: string;
  allocations: Allocation[]; revenueCents: string; costCents: Rational; grossProfitCents: Rational;
}
export interface PostedReversal extends ReversalProposal {
  id: string; actorId: string; channel: Confirmation['channel']; confirmationId: string; postedAt: string;
}
const returnKind = Type.Union([Type.Literal('sale'), Type.Literal('purchase')]);
const stockQuantity = object({ numerator: positiveInteger, denominator: positiveInteger });
const countQuantity = object({ numerator: Type.String({ pattern: '^(0|[1-9][0-9]{0,17})$' }), denominator: positiveInteger });
const stocktakeSchema = object({ productId: text, warehouseId: text, physicalQuantity: countQuantity, reason: text });
const stocktakeResolutionSchema = object({ stocktakeId: text, reason: text, outcome: Type.Union([
  object({ kind: Type.Literal('adjustment'), openingUnitCostCents: Type.Optional(centsSchema) }),
  object({ kind: Type.Literal('restored_source'), sourceId: text })
]) });
const transferSchema = object({ productId: text, warehouseId: text, destinationId: text, quantity: stockQuantity, reason: text });
const lossSchema = object({ productId: text, warehouseId: text, quantity: stockQuantity, reason: text });
export interface Stocktake extends Static<typeof stocktakeSchema> {
  id: string; postedAt: string; ledgerQuantity: Rational; ledgerValueCents: Rational; difference: Rational;
}
export interface InventoryProposal {
  kind: 'adjustment' | 'restored_source' | 'transfer' | 'loss'; reason: string;
  stocktakeId?: string; sourceId?: string; stock: ReversalProposal['stock']; lossCents: Rational;
}
export interface InventoryOperation extends InventoryProposal {
  id: string; postedAt: string; actorId: string; channel: Confirmation['channel']; confirmationId: string;
}
const returnSchema = object({ kind: returnKind, originId: text, lineIndex: Type.Integer({ minimum: 0, maximum: 499 }),
  quantity: stockQuantity, condition: Type.Union([Type.Literal('saleable'), Type.Literal('damaged')]), reason: text });
const quarantineSchema = object({ customerId: text, productId: text, warehouseId: text, quantity: stockQuantity,
  condition: Type.Union([Type.Literal('unknown'), Type.Literal('saleable'), Type.Literal('damaged')]), reason: text });
const resolutionSchema = object({ quarantineId: text, reason: text, outcome: Type.Union([
  object({ kind: Type.Literal('linked_return'), originId: text, lineIndex: Type.Integer({ minimum: 0, maximum: 499 }),
    condition: returnSchema.properties.condition }),
  object({ kind: Type.Literal('return_to_sender') }), object({ kind: Type.Literal('confirmed_loss') }) ]) });
export interface PostedReturn extends Static<typeof returnSchema> {
  id: string; actorId: string; channel: Confirmation['channel']; confirmationId: string; postedAt: string;
  partyId: string; productId: string; warehouseId: string; amountCents: string; originalCostCents: Rational;
  stock: ReversalProposal['stock']; revenueCents: string; costCents: Rational; lossCents: Rational;
  grossProfitCents: Rational; quarantineId?: string;
}
export interface QuarantinedReturn extends Static<typeof quarantineSchema> {
  id: string; postedAt: string;
}
export interface QuarantineResolution extends Static<typeof resolutionSchema> { id: string; postedAt: string }
export interface ReturnRefund { id: string; originId: string; kind: 'sale' | 'purchase'; amountCents: string;
  reason: string; postedAt: string; direction: 'outgoing' | 'incoming' }
export interface AuditEvidence extends Confirmation { action: string; recordId: string; recordedAt: string; allocationDecision?: unknown; reversalDecision?: unknown; draftVersion?: number; conversationId?: string }
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
  #clock: () => Date;
  #followups: FollowupStore;
  constructor(path: string, options: { beforeCommit?: () => void; clock?: () => Date } = {}) {
    this.#db = openDatabase(path);
    this.#clock = options.clock ?? (() => new Date());
    this.#followups = new FollowupStore(this.#db, this);
    // Composition-time fault seam for transaction tests; never a command field.
    this.#beforeCommit = options.beforeCommit;
  }
  close(): void { this.#db.close(); }

  /** Authenticated adapters supply identity and a stable inbound event ID. */
  handleDraft(context: DraftContext, action: DraftAction) {
    return new DraftStore(this.#db, (command, confirmation) => this.#executeDraft(command, confirmation),
      () => this.#draftSnapshot(), () => this.#beforeCommit?.(), this.#clock).handle(context, action);
  }
  #executeDraft(command: DraftCommand, confirmation: Confirmation): unknown {
    if (!command || typeof command.kind !== 'string' || Object.keys(command).some(k => !['kind', 'input'].includes(k)))
      throw new BusinessError('invalid_input', 'Invalid structured draft');
    switch (command.kind) {
      case 'purchase_receipt': return this.confirmPurchaseReceipt(command.input, confirmation);
      case 'sales_order': return this.createSalesOrder(command.input, confirmation);
      case 'change_sales_order': return this.changeSalesOrder(command.input, confirmation);
      case 'cancel_sales_order': return this.cancelSalesOrder(command.input, confirmation);
      case 'delivery': return this.confirmDelivery(command.input, confirmation);
      case 'delivery_and_receipt': return this.confirmDeliveryAndReceipt(command.input, confirmation);
      case 'allocated_settlement': return this.confirmSettlement(command.input, confirmation);
      case 'settlement': return this.confirmSettlement(this.previewSettlement(command.input), confirmation);
      case 'reversal': return this.confirmReversal(command.input, confirmation);
      case 'return': return this.confirmReturn(command.input, confirmation);
      case 'quarantine_return': return this.receiveQuarantinedReturn(command.input, confirmation);
      case 'resolve_quarantine': return this.resolveQuarantinedReturn(command.input, confirmation);
      case 'return_refund': return this.confirmReturnRefund(command.input, confirmation);
      case 'stocktake': return this.recordStocktake(command.input, confirmation);
      case 'resolve_stocktake': return this.confirmStocktakeResolution(command.input, confirmation);
      case 'transfer': return this.confirmTransfer(command.input, confirmation);
      case 'loss': return this.confirmLoss(command.input, confirmation);
      case 'product': return this.createProduct(command.input, confirmation);
      case 'supplier': return this.createSupplier(command.input, confirmation);
      case 'customer': return this.createCustomer(command.input, confirmation);
      case 'warehouse': return this.createWarehouse(command.input, confirmation);
      case 'product_details': return this.updateProductDetails(command.input, confirmation);
      case 'pack_unit': return this.definePackUnit(command.input, confirmation);
      case 'followup_decision': return this.decideFollowup(command.input, confirmation);
      default: throw new BusinessError('invalid_input', 'Unsupported draft operation');
    }
  }
  #draftSnapshot() {
    const products = this.listMasters('product'), warehouses = this.listMasters('warehouse');
    return {
      counterparties: [...this.listMasters('customer'), ...this.listMasters('supplier')], products, warehouses,
      stock: products.flatMap(p => warehouses.map(w => this.getStock(p.id, w.id))),
      payables: this.listOpenPayables(), receivables: this.listOpenReceivables(), settlements: this.listSettlements(),
      quarantine: this.listQuarantinedReturns(), refunds: this.listReturnRefunds(),
    };
  }


  listFollowups() { return this.#followups.list(); }
  listFollowupHistory() { return this.#followups.history(); }
  listNotifications() { return this.#followups.events(); }
  decideFollowup(raw: unknown, confirmation: unknown) {
    const input = validate(object({ id: text, status: Type.Union([Type.Literal('resolved'), Type.Literal('deferred'), Type.Literal('ignored')]),
      reason: text, until: Type.Optional(text) }), raw);
    return this.#post('followup_decision', input, confirmation, (context, now) =>
      this.#followups.decide(input as FollowupDecision, now, context));
  }
  runScheduler() {
    try {
      this.#db.exec('BEGIN IMMEDIATE');
      const now = this.#clock().toISOString();
      this.#followups.refresh(now, 'operator');
      this.#followups.schedule(now);
      this.#beforeCommit?.();
      this.#db.exec('COMMIT');
      return this.listNotifications();
    } catch (error) { if (this.#db.isTransaction) this.#db.exec('ROLLBACK'); throw error; }
  }
  async deliverNotifications(adapter: { deliver(event: NotificationEvent): Promise<void> }) {
    for (const event of this.#followups.pending()) {
      await adapter.deliver(event);
      this.#followups.ack(event.id);
    }
  }

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
      if (kind === 'product') {
        this.#db.prepare('INSERT INTO product_details VALUES (?, 1, ?)').run(master.id,
          JSON.stringify({ aliases: [], specification: null, barcode: null, shelfLifeDays: null }));
        this.#refreshProductFollowup(master.id);
      }
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

  getProduct(id: string): Master & ProductDetails & { revision: number; provisional: boolean } {
    const master = this.#requireMaster(id, 'product');
    const row = this.#db.prepare('SELECT revision, document FROM product_details WHERE product_id = ?').get(id)!;
    const details = JSON.parse(row.document as string) as ProductDetails;
    const followup = this.#db.prepare('SELECT status FROM product_followups WHERE product_id = ?').get(id);
    return { ...master, ...details, revision: Number(row.revision), provisional: followup?.status === 'open' };
  }
  updateProductDetails(raw: unknown, confirmation: unknown): ReturnType<ErpService['getProduct']> {
    const input = validate(detailsSchema, raw);
    return this.#post('update_product_details', input, confirmation, () => {
      const previous = this.getProduct(input.productId);
      if (previous.revision !== input.expectedRevision) throw new BusinessError('conflict', 'Product changed; refresh before confirming');
      const { productId, expectedRevision, ...details } = input;
      this.#db.prepare('UPDATE product_details SET revision = ?, document = ? WHERE product_id = ?')
        .run(expectedRevision + 1, JSON.stringify(details), productId);
      this.#refreshProductFollowup(productId);
      return this.getProduct(productId);
    });
  }
  listPackVersions(productId: string): PackVersion[] {
    this.#requireMaster(productId, 'product');
    return this.#db.prepare('SELECT document FROM pack_versions WHERE product_id = ? ORDER BY unit, version').all(productId)
      .map(row => JSON.parse(row.document as string) as PackVersion);
  }
  definePackUnit(raw: unknown, confirmation: unknown): PackVersion {
    const input = validate(packSchema, raw);
    return this.#post('define_pack_unit', input, confirmation, context => {
      const product = this.#requireMaster(input.productId, 'product');
      if (product.stockUnit === input.unit) throw new BusinessError('invalid_input', 'Cannot redefine the stock unit');
      const latest = this.listPackVersions(input.productId).filter(p => p.unit === input.unit).at(-1)?.version ?? 0;
      if (latest !== input.expectedVersion) throw new BusinessError('conflict', 'Pack changed; refresh before confirming');
      const pack = { id: context.operationId, productId: input.productId, unit: input.unit, version: latest + 1,
        stockUnits: ratio(BigInt(input.stockUnits.numerator), BigInt(input.stockUnits.denominator)) };
      this.#db.prepare('INSERT INTO pack_versions VALUES (?, ?, ?, ?)').run(pack.productId, pack.unit, pack.version, JSON.stringify(pack));
      this.#refreshProductFollowup(pack.productId);
      return pack;
    });
  }
  #refreshProductFollowup(productId: string): void {
    const row = this.#db.prepare('SELECT document FROM product_details WHERE product_id = ?').get(productId)!;
    const details = JSON.parse(row.document as string) as ProductDetails;
    const missing = [ ...(details.specification === null ? ['specification'] : []),
      ...(details.shelfLifeDays === null ? ['shelfLifeDays'] : []),
      ...(this.listPackVersions(productId).length === 0 ? ['packUnits'] : []) ];
    this.#db.prepare(`INSERT INTO product_followups VALUES (?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET missing_fields = excluded.missing_fields, status = excluded.status`)
      .run(productId, JSON.stringify(missing), missing.length ? 'open' : 'resolved');
  }
  listProductFollowups(): { productId: string; missingFields: string[]; status: 'open' | 'resolved' }[] {
    return this.#db.prepare('SELECT * FROM product_followups ORDER BY product_id').all().map(row => ({
      productId: row.product_id as string, missingFields: JSON.parse(row.missing_fields as string) as string[],
      status: row.status as 'open' | 'resolved' }));
  }
  listManagedExpiry(): { receiptId: string; lineIndex: number; productId: string; warehouseId: string;
    earliestProductionDate: string | null; shelfLifeDays: number | null; managedExpiryDate: string | null;
    basis: 'operational_estimate' }[] {
    return this.listPurchaseReceipts().filter(r => !this.#isReversed(r.id, 'purchase')).flatMap(receipt => receipt.lines.map((line, lineIndex) => ({
      receiptId: receipt.id, lineIndex, productId: line.productId, warehouseId: receipt.warehouseId,
      earliestProductionDate: line.earliestProductionDate ?? null, shelfLifeDays: line.shelfLifeDays ?? null,
      managedExpiryDate: line.managedExpiryDate ?? null, basis: 'operational_estimate' as const })));
  }
  summarizeManagedExpiry(throughDate: string): { basis: 'operational_estimate'; throughDate: string;
    receiptLinesDue: number; receiptLinesUnknown: number } {
    validate(dueDateSchema, throughDate); validateDueDate(throughDate);
    const lines = this.listManagedExpiry();
    return { basis: 'operational_estimate', throughDate,
      receiptLinesDue: lines.filter(line => line.managedExpiryDate !== null && line.managedExpiryDate <= throughDate).length,
      receiptLinesUnknown: lines.filter(line => line.managedExpiryDate === null).length };
  }

  confirmPurchaseReceipt(raw: unknown, confirmation: unknown): PostedReceipt {
    const input = validate(purchaseSchema, raw);
    validateDueDate(input.dueDate);
    for (const line of input.lines) if (BigInt(decimal(line.quantity).numerator) <= 0n)
      throw new BusinessError('invalid_input', 'Receipt quantity must be positive');
    return this.#post('purchase_receipt', input, confirmation, (context, postedAt) => {
      this.#requireMaster(input.supplierId, 'supplier');
      this.#requireMaster(input.warehouseId, 'warehouse');
      const lines = input.lines.map(line => {
        const product = this.getProduct(line.productId);
        let conversion = ratio(1n);
        if (line.unit === product.stockUnit) {
          if (line.packVersion !== undefined) throw new BusinessError('invalid_input', 'Stock units have no pack version');
        } else {
          const pack = this.listPackVersions(line.productId).find(p => p.unit === line.unit && p.version === line.packVersion);
          if (!pack) throw new BusinessError('invalid_input', 'An explicit known pack version is required');
          conversion = pack.stockUnits;
        }
        validateDueDate(line.earliestProductionDate);
        let managedExpiryDate: string | null = null;
        if (line.earliestProductionDate && product.shelfLifeDays !== null) {
          const date = new Date(line.earliestProductionDate);
          date.setUTCDate(date.getUTCDate() + product.shelfLifeDays);
          managedExpiryDate = date.toISOString().slice(0, 10);
          if (!/^[0-9]{4}-/.test(managedExpiryDate)) throw new BusinessError('invalid_input', 'Expiry date exceeds supported calendar');
        }
        return { ...line, stockUnit: product.stockUnit!, stockQuantity: multiply(decimal(line.quantity), conversion),
          conversion, shelfLifeDays: product.shelfLifeDays, managedExpiryDate, expiryBasis: 'operational_estimate' as const };
      });
      const receipt: PostedReceipt = { ...input, lines, id: context.operationId, status: 'posted', currency: 'CNY', postedAt,
        totalCents: String(input.lines.reduce((sum, line) => sum + BigInt(line.amountCents), 0n)) };
      return receipt;
    }, receipt => {
      this.#db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?)')
        .run(receipt.id, receipt.supplierId, receipt.warehouseId, JSON.stringify(receipt));
      for (const [index, line] of receipt.lines.entries()) this.#db.prepare('INSERT INTO stock_ledger VALUES (?, ?, ?, ?, ?, ?)')
        .run(receipt.id, index, line.productId, receipt.warehouseId, JSON.stringify(line.stockQuantity!), line.amountCents);
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
    const deliveries = this.listDeliveries(id).filter(d => !this.#isReversed(d.id, 'sale'));
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
    for (const row of rows) row.amount_cents = String(BigInt(row.amount_cents as string) - this.#allocated(row.delivery_id as string) - this.#returnedAmount(row.delivery_id as string));
    return rows.filter(row => !this.#isReversed(row.delivery_id as string, 'sale') && BigInt(row.amount_cents as string) > 0n).map(row => ({ deliveryId: row.delivery_id as string,
      customerId: row.customer_id as string, openCents: row.amount_cents as string, currency: 'CNY' }));
  }

  #allocated(obligationId: string): bigint {
    return this.#db.prepare(`SELECT amount_cents FROM settlement_allocations a WHERE obligation_id = ? AND NOT EXISTS (SELECT 1 FROM reversals r WHERE r.origin_id = a.settlement_id AND r.kind = 'settlement')`).all(obligationId)
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
    const rows = this.#db.prepare(`SELECT document FROM settlements s WHERE kind = ? AND party_id = ? AND NOT EXISTS (SELECT 1 FROM reversals r WHERE r.origin_id = s.id AND r.kind = 'settlement')`).all(input.kind, input.partyId);
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

  #isReversed(originId: string, kind: ReversalProposal['kind']): boolean {
    return !!this.#db.prepare('SELECT 1 FROM reversals WHERE origin_id = ? AND kind = ?').get(originId, kind);
  }
  listReturns(): PostedReturn[] {
    return this.#db.prepare('SELECT document FROM returns ORDER BY rowid').all()
      .map(row => JSON.parse(row.document as string) as PostedReturn);
  }
  #returnedAmount(originId: string): bigint {
    return this.listReturns().filter(r => r.originId === originId).reduce((n, r) => n + BigInt(r.amountCents), 0n);
  }
  #returnSource(kind: 'sale' | 'purchase', originId: string, lineIndex: number) {
    const source = kind === 'sale' ? this.getDelivery(originId) : this.getPurchaseReceipt(originId);
    if (!source) throw new BusinessError('not_found', 'Unknown return origin');
    if (this.#isReversed(originId, kind)) throw new BusinessError('conflict', 'Origin has been reversed');
    const line = source.lines[lineIndex];
    if (!line) throw new BusinessError('invalid_input', 'Unknown originating line');
    const quantity = 'stockQuantity' in line && line.stockQuantity ? line.stockQuantity : decimal(line.quantity);
    const cost = 'costCents' in line ? line.costCents : ratio(BigInt(line.amountCents));
    const returned = this.listReturns().filter(r => r.originId === originId && r.kind === kind && r.lineIndex === lineIndex)
      .reduce((q, r) => add(q, r.quantity), zero());
    return { source, line, quantity, cost, returned, remaining: subtract(quantity, returned),
      partyId: 'customerId' in source ? source.customerId : source.supplierId };
  }
  searchReturnCandidates(raw: unknown): { originId: string; lineIndex: number; postedAt: string;
    warehouseId: string; remainingQuantity: Rational }[] {
    const input = validate(object({ kind: returnKind, partyId: text, productId: text, quantity: stockQuantity,
      fromDate: dueDateSchema, throughDate: dueDateSchema }), raw);
    validateDueDate(input.fromDate); validateDueDate(input.throughDate);
    if (input.fromDate > input.throughDate) throw new BusinessError('invalid_input', 'Invalid date range');
    this.#requireMaster(input.partyId, input.kind === 'sale' ? 'customer' : 'supplier');
    this.#requireMaster(input.productId, 'product');
    const sources = input.kind === 'sale' ? this.listDeliveries() : this.listPurchaseReceipts();
    return sources.filter(s => !this.#isReversed(s.id, input.kind) && s.postedAt.slice(0, 10) >= input.fromDate &&
      s.postedAt.slice(0, 10) <= input.throughDate).flatMap(s => s.lines.flatMap((line, lineIndex) => {
        const origin = this.#returnSource(input.kind, s.id, lineIndex);
        return origin.partyId === input.partyId && line.productId === input.productId && compare(origin.remaining, input.quantity) >= 0
          ? [{ originId: s.id, lineIndex, postedAt: s.postedAt, warehouseId: s.warehouseId, remainingQuantity: origin.remaining }] : [];
      }));
  }
  previewReturn(raw: unknown): Omit<PostedReturn, 'id' | 'actorId' | 'channel' | 'confirmationId' | 'postedAt'> {
    const input = validate(returnSchema, raw);
    const origin = this.#returnSource(input.kind, input.originId, input.lineIndex);
    if (compare(input.quantity, origin.remaining) > 0) throw new BusinessError('conflict', 'Return exceeds remaining originating quantity');
    // Cumulative allocation gives deterministic integer cents and the final partial return takes the remainder.
    const allocated = (q: Rational) => {
      const exact = multiply(ratio(BigInt(origin.line.amountCents)), divide(q, origin.quantity));
      return BigInt(exact.numerator) / BigInt(exact.denominator);
    };
    const amountCents = String(allocated(add(origin.returned, input.quantity)) - allocated(origin.returned));
    const originalCostCents = multiply(origin.cost, divide(input.quantity, origin.quantity));
    const isSale = input.kind === 'sale';
    const lossCents = isSale && input.condition === 'damaged' ? originalCostCents : zero();
    const stock = isSale && input.condition === 'damaged' ? [] : [{ productId: origin.line.productId,
      warehouseId: origin.source.warehouseId, quantity: isSale ? input.quantity : negate(input.quantity),
      valueCents: isSale ? originalCostCents : negate(originalCostCents) }];
    for (const delta of stock) {
      const current = this.getStock(delta.productId, delta.warehouseId);
      const quantity = add(current.quantity, delta.quantity), value = add(current.valueCents, delta.valueCents);
      if (compare(quantity, zero()) < 0) throw new BusinessError('insufficient_stock', 'Purchase return exceeds available stock');
      if (compare(value, zero()) < 0 || (quantity.numerator === '0' && value.numerator !== '0'))
        throw new BusinessError('conflict', 'Return would leave invalid inventory valuation');
    }
    const revenueCents = isSale ? String(-BigInt(amountCents)) : '0';
    const costCents = isSale ? negate(originalCostCents) : zero();
    return { ...input, quantity: ratio(BigInt(input.quantity.numerator), BigInt(input.quantity.denominator)),
      partyId: origin.partyId, productId: origin.line.productId, warehouseId: origin.source.warehouseId,
      amountCents, originalCostCents, stock, revenueCents, costCents, lossCents,
      grossProfitCents: subtract(subtract(ratio(BigInt(revenueCents)), costCents), lossCents) };
  }
  #buildReturn(input: unknown, context: Confirmation, now: string): PostedReturn {
    return { ...this.previewReturn(input), id: context.operationId, actorId: context.actorId,
      channel: context.channel, confirmationId: context.confirmationId, postedAt: now };
  }
  #saveReturn(result: PostedReturn): void {
    this.#db.prepare('INSERT INTO returns VALUES (?, ?, ?)').run(result.id, result.originId, JSON.stringify(result));
  }
  confirmReturn(raw: unknown, confirmation: unknown): PostedReturn {
    const input = validate(returnSchema, raw);
    return this.#post('return', input, confirmation, (context, now) => this.#buildReturn(input, context, now), r => this.#saveReturn(r));
  }
  receiveQuarantinedReturn(raw: unknown, confirmation: unknown): QuarantinedReturn {
    const input = validate(quarantineSchema, raw);
    return this.#post('quarantine', input, confirmation, (context, now) => {
      this.#requireMaster(input.customerId, 'customer'); this.#requireMaster(input.productId, 'product');
      this.#requireMaster(input.warehouseId, 'warehouse');
      return { ...input, id: context.operationId, postedAt: now };
    }, r => { this.#db.prepare('INSERT INTO quarantines VALUES (?, ?)').run(r.id, JSON.stringify(r)); });
  }
  listQuarantineResolutions(): QuarantineResolution[] {
    return this.#db.prepare('SELECT document FROM quarantine_resolutions ORDER BY rowid').all()
      .map(row => JSON.parse(row.document as string) as QuarantineResolution);
  }
  listQuarantinedReturns(): (QuarantinedReturn & { status: 'open' | 'resolved'; resolutionId?: string })[] {
    const resolutions = this.listQuarantineResolutions();
    return this.#db.prepare('SELECT document FROM quarantines ORDER BY rowid').all().map(row => {
      const q = JSON.parse(row.document as string) as QuarantinedReturn;
      const resolution = resolutions.find(r => r.quarantineId === q.id);
      return { ...q, status: resolution ? 'resolved' : 'open', ...(resolution ? { resolutionId: resolution.id } : {}) };
    });
  }
  listReturnFollowups() {
    return this.listQuarantinedReturns().map(q => ({ quarantineId: q.id, productId: q.productId,
      status: q.status, reason: q.reason, resolutionId: q.resolutionId }));
  }
  resolveQuarantinedReturn(raw: unknown, confirmation: unknown): QuarantineResolution {
    const input = validate(resolutionSchema, raw);
    return this.#post('resolve_quarantine', input, confirmation, (context, now) => {
      const q = this.listQuarantinedReturns().find(q => q.id === input.quarantineId);
      if (!q) throw new BusinessError('not_found', 'Unknown quarantine');
      if (q.status !== 'open') throw new BusinessError('conflict', 'Quarantine already resolved');
      let linkedReturn: PostedReturn | undefined;
      if (input.outcome.kind === 'linked_return') {
        linkedReturn = this.#buildReturn({ kind: 'sale', originId: input.outcome.originId,
          lineIndex: input.outcome.lineIndex, quantity: q.quantity, condition: input.outcome.condition, reason: input.reason }, context, now);
        if (linkedReturn.partyId !== q.customerId || linkedReturn.productId !== q.productId || linkedReturn.warehouseId !== q.warehouseId)
          throw new BusinessError('conflict', 'Origin does not match quarantined party, product and location');
        linkedReturn.quarantineId = q.id;
      }
      return { ...input, id: context.operationId, postedAt: now, ...(linkedReturn ? { linkedReturn } : {}) };
    }, r => {
      if (r.linkedReturn) this.#saveReturn(r.linkedReturn);
      this.#db.prepare('INSERT INTO quarantine_resolutions VALUES (?, ?, ?)').run(r.id, r.quarantineId, JSON.stringify(r));
    });
  }
  listReturnRefunds(): ReturnRefund[] {
    return this.#db.prepare('SELECT document FROM return_refunds ORDER BY rowid').all()
      .map(row => JSON.parse(row.document as string) as ReturnRefund);
  }
  getReturnRefundBalance(raw: unknown): { amountCents: string; direction: 'outgoing' | 'incoming' } {
    const input = validate(object({ originId: text, kind: returnKind }), raw);
    const source = input.kind === 'sale' ? this.getDelivery(input.originId) : this.getPurchaseReceipt(input.originId);
    if (!source) throw new BusinessError('not_found', 'Unknown refund origin');
    const paidRefunds = this.listReturnRefunds().filter(r => r.originId === input.originId)
      .reduce((sum, r) => sum + BigInt(r.amountCents), 0n);
    const credit = this.#allocated(input.originId) + this.#returnedAmount(input.originId) - BigInt(source.totalCents);
    return { amountCents: String((credit > 0n ? credit : 0n) - paidRefunds), direction: input.kind === 'sale' ? 'outgoing' : 'incoming' };
  }
  confirmReturnRefund(raw: unknown, confirmation: unknown): ReturnRefund {
    const input = validate(object({ originId: text, kind: returnKind, amountCents: centsSchema, reason: text }), raw);
    return this.#post('return_refund', input, confirmation, (context, now) => {
      const balance = this.getReturnRefundBalance({ originId: input.originId, kind: input.kind });
      if (BigInt(input.amountCents) <= 0n || BigInt(input.amountCents) > BigInt(balance.amountCents))
        throw new BusinessError('conflict', 'Refund must be positive and within the outstanding return credit');
      return { ...input, id: context.operationId, postedAt: now, direction: balance.direction };
    }, r => { this.#db.prepare('INSERT INTO return_refunds VALUES (?, ?, ?)').run(r.id, r.originId, JSON.stringify(r)); });
  }

  listReversals(): PostedReversal[] {
    return this.#db.prepare('SELECT document FROM reversals ORDER BY rowid').all()
      .map(row => JSON.parse(row.document as string) as PostedReversal);
  }
  /** Full correction of an original record. Physical/partial returns are a separate operation. */
  previewReversal(raw: unknown): ReversalProposal {
    const input = validate(reversalSchema, raw);
    if (this.#isReversed(input.originId, input.kind)) throw new BusinessError('conflict', 'Record already reversed');
    const result: ReversalProposal = { ...input, stock: [], obligationCents: '0', cashCents: '0', excessCents: '0',
      allocations: [], revenueCents: '0', costCents: zero(), grossProfitCents: zero() };
    if (input.kind === 'settlement') {
      const source = this.listSettlements().find(s => s.id === input.originId);
      if (!source) throw new BusinessError('not_found', 'Unknown settlement');
      if (source.allocations.some(a => this.listReturnRefunds().some(r => r.originId === a.obligationId)))
        throw new BusinessError('conflict', 'Settlement supports a paid return refund and cannot be fully reversed');
      result.cashCents = String(-BigInt(source.amountCents));
      result.excessCents = String(-BigInt(source.excessCents));
      result.allocations = source.allocations.map(a => ({ ...a, amountCents: String(-BigInt(a.amountCents)) }));
    } else {
      const source = input.kind === 'purchase' ? this.getPurchaseReceipt(input.originId) : this.getDelivery(input.originId);
      if (!source) throw new BusinessError('not_found', 'Unknown posted stock record');
      if (this.listReturns().some(r => r.originId === input.originId))
        throw new BusinessError('conflict', 'Origin has physical returns; full reversal would double count');
      if (this.#allocated(input.originId) > 0n || (input.kind === 'sale' && this.listSettlements().some(s =>
        s.linkedDeliveryId === input.originId && !this.#isReversed(s.id, 'settlement'))))
        throw new BusinessError('conflict', 'Reverse related settlements first');
      result.obligationCents = String(-BigInt(source.totalCents));
      if (input.kind === 'purchase') {
        result.stock = (source as PostedReceipt).lines.map(l => ({ productId: l.productId, warehouseId: source.warehouseId,
          quantity: negate(l.stockQuantity ?? decimal(l.quantity)), valueCents: negate(ratio(BigInt(l.amountCents))) }));
      } else {
        const delivery = source as PostedDelivery;
        result.stock = delivery.lines.map(l => ({ productId: l.productId, warehouseId: source.warehouseId,
          quantity: decimal(l.quantity), valueCents: l.costCents }));
        result.revenueCents = String(-BigInt(delivery.totalCents));
        result.costCents = negate(delivery.costCents); result.grossProfitCents = negate(delivery.grossProfitCents);
      }
      const balances = new Map<string, ReturnType<ErpService['getStock']>>();
      for (const delta of result.stock) {
        const stock = balances.get(delta.productId) ?? this.getStock(delta.productId, delta.warehouseId);
        const quantity = add(stock.quantity, delta.quantity), valueCents = add(stock.valueCents, delta.valueCents);
        if (compare(quantity, zero()) < 0) throw new BusinessError('insufficient_stock', 'Reverse dependent deliveries first');
        if (compare(valueCents, zero()) < 0 || (quantity.numerator === '0' && valueCents.numerator !== '0'))
          throw new BusinessError('conflict', 'Reversal would leave invalid inventory valuation; reverse dependent deliveries first');
        balances.set(delta.productId, { ...stock, quantity, valueCents });
      }
    }
    return result;
  }
  confirmReversal(raw: unknown, confirmation: unknown): PostedReversal {
    const input = validate(reversalSchema, raw);
    return this.#post('reversal', input, confirmation, (context, now) => ({ ...this.previewReversal(input),
      id: context.operationId, actorId: context.actorId, channel: context.channel,
      confirmationId: context.confirmationId, postedAt: now }), result => {
      this.#db.prepare('INSERT INTO reversals VALUES (?, ?, ?, ?)')
        .run(result.id, result.originId, result.kind, JSON.stringify(result));
    });
  }
  getSalesTotals(): { revenueCents: string; costCents: Rational; grossProfitCents: Rational } {
    const active = this.listDeliveries().filter(d => !this.#isReversed(d.id, 'sale'));
    const returns = this.listReturns().filter(r => r.kind === 'sale');
    return { revenueCents: String(returns.reduce((sum, r) => sum + BigInt(r.revenueCents), active.reduce((sum, d) => sum + BigInt(d.totalCents), 0n))),
      costCents: returns.reduce((sum, r) => add(sum, r.costCents), active.reduce((sum, d) => add(sum, d.costCents), zero())),
      grossProfitCents: returns.reduce((sum, r) => add(sum, r.grossProfitCents), active.reduce((sum, d) => add(sum, d.grossProfitCents), zero())) };
  }
  getReturnLossTotals(): { knownLossCents: Rational; unvaluedQuarantineLosses: string[] } {
    return { knownLossCents: this.listReturns().reduce((sum, r) => add(sum, r.lossCents), zero()),
      unvaluedQuarantineLosses: this.listQuarantineResolutions().filter(r => r.outcome.kind === 'confirmed_loss').map(r => r.id) };
  }

  /** Recording a count preserves its comparison without changing inventory. */
  recordStocktake(raw: unknown, confirmation: unknown): Stocktake {
    const input = validate(stocktakeSchema, raw);
    return this.#post('stocktake', input, confirmation, (context, now) => {
      const stock = this.getStock(input.productId, input.warehouseId);
      const physicalQuantity = ratio(BigInt(input.physicalQuantity.numerator), BigInt(input.physicalQuantity.denominator));
      return { ...input, physicalQuantity, id: context.operationId, postedAt: now,
        ledgerQuantity: stock.quantity, ledgerValueCents: stock.valueCents, difference: subtract(physicalQuantity, stock.quantity) };
    }, result => { this.#db.prepare('INSERT INTO stocktakes VALUES (?, ?)').run(result.id, JSON.stringify(result)); });
  }
  listStocktakes(): Stocktake[] {
    return this.#db.prepare('SELECT document FROM stocktakes ORDER BY rowid').all().map(r => JSON.parse(r.document as string) as Stocktake);
  }
  listInventoryOperations(): InventoryOperation[] {
    return this.#db.prepare('SELECT document FROM inventory_operations ORDER BY rowid').all()
      .map(r => JSON.parse(r.document as string) as InventoryOperation);
  }
  previewStocktakeResolution(raw: unknown): InventoryProposal {
    const input = validate(stocktakeResolutionSchema, raw);
    const count = this.listStocktakes().find(r => r.id === input.stocktakeId);
    if (!count) throw new BusinessError('not_found', 'Unknown stocktake');
    if (this.listInventoryOperations().some(r => r.stocktakeId === count.id))
      throw new BusinessError('conflict', 'Stocktake already resolved');
    const current = this.getStock(count.productId, count.warehouseId);
    const result: InventoryProposal = { kind: input.outcome.kind, reason: input.reason, stocktakeId: count.id, stock: [], lossCents: zero() };
    if (input.outcome.kind === 'restored_source') {
      const sourceId = input.outcome.sourceId;
      const later = this.#db.prepare('SELECT 1 FROM operations s, operations c WHERE s.id = ? AND c.id = ? AND s.rowid > c.rowid').get(sourceId, count.id);
      const receipt = this.getPurchaseReceipt(sourceId), delivery = this.getDelivery(sourceId);
      let delta = zero();
      if (receipt?.warehouseId === count.warehouseId && !this.#isReversed(sourceId, 'purchase'))
        for (const line of receipt.lines) if (line.productId === count.productId) delta = add(delta, line.stockQuantity ?? decimal(line.quantity));
      if (delivery?.warehouseId === count.warehouseId && !this.#isReversed(sourceId, 'sale'))
        for (const line of delivery.lines) if (line.productId === count.productId) delta = subtract(delta, decimal(line.quantity));
      const otherSource = this.listReturns().find(r => r.id === sourceId)
        ?? this.listInventoryOperations().find(r => r.id === sourceId && (r.kind === 'loss' || r.kind === 'transfer'));
      for (const entry of otherSource?.stock ?? [])
        if (entry.productId === count.productId && entry.warehouseId === count.warehouseId) delta = add(delta, entry.quantity);
      if (!later || compare(delta, zero()) === 0 || compare(delta, count.difference) !== 0 || compare(current.quantity, count.physicalQuantity) !== 0
        || this.listReturns().some(r => r.originId === sourceId))
        throw new BusinessError('conflict', 'Restore a matching missing stock transaction, then reconcile the count');
      return { ...result, sourceId };
    }
    if (compare(current.quantity, count.ledgerQuantity) !== 0 || compare(current.valueCents, count.ledgerValueCents) !== 0)
      throw new BusinessError('conflict', 'Stock changed since count; record a new count');
    let unitCost = current.averageCostCents;
    if (compare(count.difference, zero()) > 0 && unitCost === null) {
      if (input.outcome.openingUnitCostCents === undefined)
        throw new BusinessError('invalid_input', 'Opening stock gain requires an evidenced unit cost in cents');
      unitCost = ratio(BigInt(input.outcome.openingUnitCostCents));
    } else if (input.outcome.openingUnitCostCents !== undefined)
      throw new BusinessError('invalid_input', 'Existing stock must use ledger average cost');
    result.stock = [{ productId: count.productId, warehouseId: count.warehouseId,
      quantity: count.difference, valueCents: multiply(count.difference, unitCost ?? zero()) }];
    return result;
  }
  confirmStocktakeResolution(raw: unknown, confirmation: unknown): InventoryOperation {
    const input = validate(stocktakeResolutionSchema, raw);
    return this.#postInventory('stocktake_resolution', input, confirmation, () => this.previewStocktakeResolution(input));
  }
  previewTransfer(raw: unknown): InventoryProposal {
    const input = validate(transferSchema, raw);
    this.#requireMaster(input.destinationId, 'warehouse');
    if (input.destinationId === input.warehouseId) throw new BusinessError('invalid_input', 'Transfer needs distinct warehouses');
    const issue = this.#inventoryIssue(input);
    return { kind: 'transfer', reason: input.reason, lossCents: zero(), stock: [issue,
      { ...issue, warehouseId: input.destinationId, quantity: negate(issue.quantity), valueCents: negate(issue.valueCents) }] };
  }
  confirmTransfer(raw: unknown, confirmation: unknown): InventoryOperation {
    const input = validate(transferSchema, raw);
    return this.#postInventory('transfer', input, confirmation, () => this.previewTransfer(input));
  }
  previewLoss(raw: unknown): InventoryProposal {
    const input = validate(lossSchema, raw), issue = this.#inventoryIssue(input);
    return { kind: 'loss', reason: input.reason, stock: [issue], lossCents: negate(issue.valueCents) };
  }
  confirmLoss(raw: unknown, confirmation: unknown): InventoryOperation {
    const input = validate(lossSchema, raw);
    return this.#postInventory('loss', input, confirmation, () => this.previewLoss(input));
  }
  #inventoryIssue(input: Static<typeof lossSchema>): ReversalProposal['stock'][number] {
    const current = this.getStock(input.productId, input.warehouseId);
    const quantity = ratio(BigInt(input.quantity.numerator), BigInt(input.quantity.denominator));
    if (compare(quantity, current.quantity) > 0) throw new BusinessError('insufficient_stock', 'Issue would make inventory negative');
    return { productId: input.productId, warehouseId: input.warehouseId, quantity: negate(quantity),
      valueCents: negate(multiply(quantity, current.averageCostCents!)) };
  }
  #postInventory(action: string, input: unknown, confirmation: unknown, build: () => InventoryProposal): InventoryOperation {
    return this.#post(action, input, confirmation, (context, now) => ({ ...build(), id: context.operationId, postedAt: now,
      actorId: context.actorId, channel: context.channel, confirmationId: context.confirmationId }), result => {
      this.#db.prepare('INSERT INTO inventory_operations VALUES (?, ?, ?)').run(result.id, result.stocktakeId ?? null, JSON.stringify(result));
    });
  }
  getInventoryTotals(): { lossCents: Rational; adjustmentValueCents: Rational; grossProfitAfterKnownLossCents: Rational;
    unvaluedQuarantineLosses: string[] } {
    const returns = this.getReturnLossTotals();
    const lossCents = this.listInventoryOperations().reduce((sum, r) => add(sum, r.lossCents), returns.knownLossCents);
    const sales = this.getSalesTotals();
    return { lossCents, adjustmentValueCents: this.listInventoryOperations().filter(r => r.kind === 'adjustment')
      .flatMap(r => r.stock).reduce((sum, r) => add(sum, r.valueCents), zero()),
      grossProfitAfterKnownLossCents: subtract(subtract(ratio(BigInt(sales.revenueCents)), sales.costCents), lossCents),
      unvaluedQuarantineLosses: returns.unvaluedQuarantineLosses };
  }

  #post<T extends { id: string }>(action: string, input: unknown, rawContext: unknown,
    build: (context: Confirmation, now: string) => T, effects?: (result: T) => void): T {
    const context = validate(confirmationSchema, rawContext);
    const request = canonical({ action, input, context });
    const ownsTransaction = !this.#db.isTransaction;
    try {
      if (ownsTransaction) this.#db.exec('BEGIN IMMEDIATE');
      const prior = this.#db.prepare('SELECT request, result FROM operations WHERE id = ?').get(context.operationId);
      if (prior) {
        if (prior.request !== request) throw new BusinessError('idempotency_conflict', 'Operation ID already belongs to a different confirmation');
        if (ownsTransaction) this.#db.exec('COMMIT');
        return JSON.parse(prior.result as string) as T;
      }
      const now = this.#clock().toISOString();
      const result = build(context, now);
      this.#db.prepare('INSERT INTO operations VALUES (?, ?, ?)').run(context.operationId, request, JSON.stringify(result));
      effects?.(result);
      const evidence: AuditEvidence = { ...context, action, recordId: result.id, recordedAt: now };
      if (action === 'reversal') evidence.reversalDecision = result;
      if (action === 'settlement' || action === 'delivery_and_receipt') evidence.allocationDecision = input;
      this.#db.prepare('INSERT INTO audit_events VALUES (?, ?)').run(context.operationId, JSON.stringify(evidence));
      this.#followups.refresh(now, context.actorId);
      if (ownsTransaction) this.#beforeCommit?.();
      if (ownsTransaction) this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (ownsTransaction && this.#db.isTransaction) this.#db.exec('ROLLBACK');
      if (error && typeof error === 'object' && 'errcode' in error && [5, 6].includes(Number(error.errcode) & 255))
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
    for (const entry of [...this.listReversals(), ...this.listReturns(), ...this.listInventoryOperations()].flatMap(r => r.stock)) {
      if (entry.productId !== productId || entry.warehouseId !== warehouseId) continue;
      quantity = add(quantity, entry.quantity); valueCents = add(valueCents, entry.valueCents);
    }
    return { productId, warehouseId, stockUnit: product.stockUnit!, quantity, valueCents,
      averageCostCents: quantity.numerator === '0' ? null : divide(valueCents, quantity) };
  }
  listOpenPayables(supplierId?: string): { receiptId: string; supplierId: string; openCents: string; currency: 'CNY' }[] {
    const rows = supplierId === undefined
      ? this.#db.prepare('SELECT * FROM payable_ledger ORDER BY rowid').all()
      : this.#db.prepare('SELECT * FROM payable_ledger WHERE supplier_id = ? ORDER BY rowid').all(supplierId);
    for (const row of rows) row.amount_cents = String(BigInt(row.amount_cents as string) - this.#allocated(row.receipt_id as string) - this.#returnedAmount(row.receipt_id as string));
    return rows.filter(row => !this.#isReversed(row.receipt_id as string, 'purchase') && BigInt(row.amount_cents as string) > 0n).map(row => ({ receiptId: row.receipt_id as string,
      supplierId: row.supplier_id as string, openCents: row.amount_cents as string, currency: 'CNY' }));
  }
  listAuditEvents(): AuditEvidence[] {
    return this.#db.prepare('SELECT evidence FROM audit_events ORDER BY rowid').all()
      .map(row => JSON.parse(row.evidence as string) as AuditEvidence);
  }
}
