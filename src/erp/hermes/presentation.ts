import type { DraftReply } from '../drafts.ts';
import type { ErpService } from '../service.ts';
import type { NotificationEvent } from '../followups.ts';

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
const clean = (v: unknown) => String(v ?? '').replace(/[\r\n\u0000-\u001f]/g, ' ');
/** Integer cents never pass through floating point, including large amounts. */
export function yuan(value: unknown): string {
  const r = row(value), n = BigInt(String(r.numerator ?? value ?? '0')), d = BigInt(String(r.denominator ?? '1'));
  const negative = n < 0n, a = negative ? -n : n;
  const cents = (a + d / 2n) / d;
  return `${a % d ? '约' : ''}${negative ? '-' : ''}${cents / 100n}.${String(cents % 100n).padStart(2, '0')}元`;
}
function quantity(value: unknown): string {
  if (typeof value === 'string') return clean(value);
  const r = row(value), n = BigInt(String(r.numerator ?? '0')), d = BigInt(String(r.denominator ?? '1'));
  if (n % d === 0n) return String(n / d);
  let scale = 1n;
  for (let i = 0; i < 6; i++) {
    scale *= 10n;
    if (n * scale % d === 0n) {
      const digits = String(n * scale / d).padStart(i + 2, '0');
      return `${digits.slice(0, -i - 1)}.${digits.slice(-i - 1)}`.replace(/0+$/, '');
    }
  }
  return `${n}/${d}`;
}
function rejected(reason: string): string {
  const code = reason.split(':')[0]!;
  const messages: Record<string, string> = {
    business_state_changed: '库存或账款已发生变化，请重新生成草稿后核对。',
    stale_version: '这份草稿已被更新，请核对最新草稿。',
    insufficient_stock: '库存不足，请核对实际库存或先办理入库。',
    summary_too_large_use_web: '这笔业务的明细较多，请在网页中核对办理。',
    invalid_input: '业务信息不完整或有误，请核对商品、数量、金额和单位后重新发送。',
    cancelled: '这份草稿已经取消，请重新描述业务。',
    invalidated: '这份草稿已失效，请重新生成并核对。',
    no_current_draft: '没有待确认的草稿，请先描述要办理的业务。',
    not_found: '没有找到对应的业务记录，请核对后重新发送。',
  };
  return `未入账\n${messages[code] ?? '这笔业务暂时无法办理，请核对信息后重新生成草稿，或在网页中查看。'}`;
}
/** Deterministic operator-facing text. Never ask the model to summarize ledger effects. */
export function renderReply(reply: DraftReply, erp: ErpService): string {
  if (reply.status === 'rejected') return rejected(reply.reason);
  if (reply.status === 'cancelled') return '已取消\n这份草稿不会入账。';
  const pending = reply.status === 'draft';
  const summary = pending ? row(reply.draft.summary) : {};
  const result = row(pending ? summary.projection : reply.result);
  const kind = pending ? reply.draft.command.kind : result.delivery ? 'delivery_and_receipt'
    : result.supplierId ? 'purchase_receipt' : result.partyId ? 'settlement' : result.orderId ? 'delivery' : 'sales_order';
  const labels: Record<string, string> = { purchase_receipt: '采购入库', sales_order: '销售订单', delivery: '销售交货', delivery_and_receipt: '交货并收款', settlement: '收付款' };
  const masters = (['product', 'supplier', 'customer', 'warehouse'] as const).flatMap(k => erp.listMasters(k));
  // Draft snapshots retain the reviewed names; do not reconstruct business effects from current stock.
  const changes = row(summary.changes);
  const references = ['counterparties', 'products', 'warehouses'].flatMap(k => rows(row(changes[k]).after));
  const name = (id: unknown) => clean(references.find(m => m.id === id)?.name ?? masters.find(m => m.id === id)?.name ?? '名称未提供');
  const lines: string[] = [`${labels[kind] ?? '业务记录'}｜${pending ? '待确认，尚未入账' : '已完成'}`];
  const document = kind === 'delivery_and_receipt' ? row(result.delivery) : result;
  if (kind !== 'settlement') {
    lines.push(`${kind === 'purchase_receipt' ? '供应商' : '客户'}：${name(document.supplierId ?? document.customerId)}`,
      `仓库：${name(document.warehouseId)}`, '', '商品明细：');
    for (const [i, item] of rows(document.lines).entries()) {
      lines.push(`${i + 1}. ${name(item.productId)} ${quantity(item.quantity)}${clean(item.unit)}，合计${yuan(item.amountCents)}`);
      if (item.stockQuantity && clean(item.unit) !== clean(item.stockUnit))
        lines.push(`   折合库存：${quantity(item.stockQuantity)}${clean(item.stockUnit)}`);
      if (item.earliestProductionDate) lines.push(`   最早生产日期：${clean(item.earliestProductionDate)}`);
      if (item.managedExpiryDate) lines.push(`   管理效期：${clean(item.managedExpiryDate)}（估算，须核对实物）`);
    }
    const total = document.totalCents ?? String(rows(document.lines).reduce((n, l) => n + BigInt(String(l.amountCents)), 0n));
    lines.push('', `货款合计：${yuan(total)}`);
    if (document.dueDate) lines.push(`付款到期日：${clean(document.dueDate)}`);
    if (kind === 'purchase_receipt') lines.push(`${pending ? '确认后' : '本次'}：增加上述库存及应付货款${yuan(total)}；未登记付款。`);
    else if (kind === 'sales_order') lines.push('仅登记订单，不扣库存、不登记收款；交货需另行确认。');
    else {
      lines.push(`${pending ? '确认后' : '本次'}：扣减上述库存，登记销售货款${yuan(total)}。`);
      if (kind === 'delivery') lines.push(`未登记收款，应收货款增加${yuan(total)}。`);
      if (document.costCents) lines.push(`出库成本：${yuan(document.costCents)}`);
      if (document.grossProfitCents) lines.push(`经营毛利：${yuan(document.grossProfitCents)}（未扣税费及经营开支）`);
    }
  }
  if (kind === 'settlement' || kind === 'delivery_and_receipt') {
    const s = kind === 'settlement' ? result : row(result.settlement);
    const receiving = s.kind === 'customer_receipt';
    if (kind === 'settlement') lines.push(`${receiving ? '客户' : '供应商'}：${name(s.partyId)}`);
    lines.push(`${pending ? '拟' : '已'}${receiving ? '收款' : '付款'}：${yuan(s.amountCents)}`);
    const allocations = rows(s.allocations);
    const paid = allocations.reduce((n, a) => n + BigInt(String(a.amountCents)), 0n);
    lines.push(`用于核销货款：${yuan(String(paid))}，共${allocations.length}笔。`);
    if (kind === 'settlement') for (const [i, a] of allocations.entries()) {
      const origin = [...erp.listPurchaseReceipts(), ...erp.listDeliveries()].find(o => o.id === a.obligationId);
      const content = origin ? `${origin.postedAt.slice(0, 10)} ${origin.lines.map(l => `${name(l.productId)}${l.quantity}${l.unit}`).join('、')}` : '本次货款';
      lines.push(`  ${i + 1}. ${content}：核销${yuan(a.amountCents)}`);
    }
    lines.push(`余款转为${receiving ? '预收款' : '预付款'}：${yuan(s.excessCents)}`);
    if (kind === 'delivery_and_receipt') lines.push(`本次交货尚欠：${yuan(String(BigInt(String(document.totalCents)) - paid))}`);
  }
  if (pending) lines.push('', '核对无误请回复“确认”。', '要修改请发送“修改：……”；不办理请回复“取消”。');
  else lines.push('', '重复确认不会再次入账。');
  return lines.join('\n');
}

export function renderNotification(event: NotificationEvent): string {
  const p = row(event.payload), count = (key: string) => rows(p[key]).length;
  if (event.kind === 'daily') return `每日待办｜${clean(p.day)}\n待处理：${count('outstanding')}项\n已延期：${count('deferred')}项\n请到网页查看并处理具体事项。`;
  if (event.kind === 'immediate') {
    const labels: Record<string, string> = { incomplete_product: '商品资料尚未补全', workflow_gap: '采购入库缺少订单凭据', unresolved_return: '退货来源待核实', delivery_without_receipt: '交货后仍有货款未收', overdue_settlement: '有货款已到期', managed_expiry: '商品临近管理效期，请核对实物', stock_exception: '盘点存在差异' };
    return `待办提醒\n${labels[String(p.kind)] ?? '有新的业务事项需要处理'}。\n请到网页查看详情。`;
  }
  const debt = row(p.debtSnapshot);
  return [`每周经营汇总｜${clean(p.startInclusive)} 至 ${clean(p.endExclusive)}（不含结束日）`,
    `采购：${yuan(p.purchaseCents)}`, `销售：${yuan(p.salesCents)}`, `经营毛利：${yuan(p.grossProfitCents)}`,
    `已知损失：${yuan(p.lossCents)}`, `扣除已知损失后的毛利：${yuan(p.grossProfitAfterKnownLossCents)}`,
    `客户净回款：${yuan(p.netCollectionCents)}`, `当前应收：${yuan(debt.receivableCents)}`, `当前应付：${yuan(debt.payableCents)}`,
    '经营毛利不含税费及经营开支；应收应付为生成汇总时的余额。详情请到网页查看。'].join('\n');
}
