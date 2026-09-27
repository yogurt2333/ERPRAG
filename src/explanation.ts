import { audit, parseAuditInput, type ReasonCode } from './audit.ts';

const reasons: Record<ReasonCode, string> = {
  duplicate_source: '规则来源标识重复，无法唯一定位证据。',
  invalid_input: '输入不符合审计数据格式，无法计算。', invalid_date: '订单或规则日期无效，无法确定适用范围。',
  allocation_unknown: '存在缺少税价信息的行，无法确定整单优惠分摊。', discount_exceeds_total: '整单优惠超过行折扣后的不含税合计。',
  tax_missing: '缺少税率或含税口径。', conversion_missing: '缺少单位换算因子。', gift_unsupported: '赠品规则尚未支持。',
  overlap: '多条规则同时适用，缺少明确优先级，无法判定。', no_rule: '没有找到同账套、同商品且日期有效的限价证据。',
  compared: '按不含税基本单位有效价格比较：严格低于限价为违规，等于或高于为合规。'
};

function yuan(cents: string): string {
  const [numerator, denominator = '1'] = cents.split('/');
  let n = BigInt(numerator!), d = BigInt(denominator) * 100n;
  const whole = n / d;
  n %= d;
  let decimals = '';
  while (n !== 0n && decimals.length < 12) { n *= 10n; decimals += String(n / d); n %= d; }
  return n === 0n ? `${whole}.${decimals.padEnd(2, '0')} 元` : `(${cents}) 分（精确分数，未舍入）`;
}
const labels = { violation: '违规', compliant: '合规', inconclusive: '无法判定' };
const percent = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}%`;
const literal = (value: string) => '`' + value.replace(/[\r\n`<>]/g, '_') + '`';

/** Generated only from the selected snapshot and audit calculation; never model prose. */
export function explainAudit(raw: unknown) {
  const report = audit(raw);
  const input = parseAuditInput(raw);
  const parts = [`# 价格审计：${labels[report.status]}`, '合成业务演示；仅覆盖价格规则。'];
  if (input) {
    parts.push(`订单：${literal(input.order.id)}；账套：${literal(input.order.ledger)}；日期：${input.order.date}`);
    parts.push(`整单优惠（不含税）：${yuan(String(input.order.discountCents))}；来源：${literal(`order:${input.order.id}#/discountCents`)}`);
  }
  for (const [index, finding] of report.lines.entries()) {
    parts.push(`## ${index + 1}. ${labels[finding.status]}`);
    const line = finding.evidence.some(id => id.startsWith('order:')) ? input?.order.lines[index] : undefined;
    if (line) {
      parts.push(`商品：${literal(line.product)}；原始单价：${yuan(String(line.priceCents))}／销售单位。`);
      parts.push(`数量：${line.quantity} 个销售单位。`);
      parts.push(line.discountBps === 10000 ? '无行折扣。' : `行折扣应付比例：${percent(line.discountBps)}。`);
      if (line.baseUnits !== undefined) parts.push(`基本单位换算因子：${line.baseUnits}。`);
      if (line.taxInclusive !== undefined) parts.push(`原价口径：${line.taxInclusive ? '含税' : '不含税'}。`);
      if (line.taxBps !== undefined) parts.push(`税率：${percent(line.taxBps)}。`);
    }
    if (finding.effectiveCents) parts.push(`优惠分摊后的有效价格：${yuan(finding.effectiveCents)}／基本单位（不含税）。`);
    for (const rule of input?.rules ?? []) {
      if (finding.evidence.includes(`rule:${rule.id}@${rule.version}`)) parts.push(`限价 ${literal(rule.id)}：${yuan(String(rule.floorCents))}／基本单位（不含税），有效期 ${rule.from} 至 ${rule.to}。`);
    }
    parts.push(`依据：${reasons[finding.reasonCode]}`);
    if (finding.evidence.length) parts.push(`来源：${finding.evidence.map(literal).join('、')}`);
  }
  return { report, generatedBy: 'deterministic-audit' as const, markdown: parts.join('\n\n') };
}
