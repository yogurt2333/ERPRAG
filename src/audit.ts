import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export interface Line {
  product: string; quantity: number; priceCents: number; discountBps: number;
  baseUnits?: number; taxBps?: number; taxInclusive?: boolean; gift?: boolean;
}
export interface Rule {
  id: string; version: string; ledger: string; product: string;
  from: string; to: string; floorCents: number;
}
export interface AuditRequest {
  order: { id: string; ledger: string; date: string; discountCents: number; lines: Line[] };
  rules: Rule[];
}
export type Status = 'violation' | 'compliant' | 'inconclusive';
export type ReasonCode = 'invalid_input' | 'duplicate_source' | 'invalid_date' | 'allocation_unknown' | 'discount_exceeds_total' | 'tax_missing' | 'conversion_missing' | 'gift_unsupported' | 'overlap' | 'no_rule' | 'compared';
export interface Finding {
  status: Status; reason: string; reasonCode: ReasonCode; evidence: string[]; effectiveCents?: string;
}
export interface Report { status: Status; lines: Finding[] }

type Fraction = { n: bigint; d: bigint };
function fraction(n: bigint, d = 1n): Fraction {
  let a = n < 0n ? -n : n, b = d;
  while (b !== 0n) { [a, b] = [b, a % b]; }
  return { n: n / a, d: d / a };
}
function add(a: Fraction, b: Fraction): Fraction { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
function multiply(a: Fraction, b: Fraction): Fraction { return fraction(a.n * b.n, a.d * b.d); }

const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Type.Integer({ minimum, maximum });
const name = Type.String({ minLength: 1, maxLength: 200 });
const date = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const schema = Type.Object({
  order: Type.Object({ id: name, ledger: name, date, discountCents: integer(), lines: Type.Array(Type.Object({
    product: name, quantity: integer(1), priceCents: integer(), discountBps: integer(0, 10000),
    baseUnits: Type.Optional(integer(1)), taxBps: Type.Optional(integer(0, 10000)),
    taxInclusive: Type.Optional(Type.Boolean()), gift: Type.Optional(Type.Boolean())
  }), { minItems: 1, maxItems: 1000 }) }),
  rules: Type.Array(Type.Object({ id: name, version: name, ledger: name, product: name, from: date, to: date, floorCents: integer() }), { maxItems: 10000 })
});
const validDate = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function parseAuditInput(raw: unknown): AuditRequest | undefined { return Value.Check(schema, raw) ? raw : undefined; }
function inconclusive(reasonCode: ReasonCode, reason: string): Report { return { status: 'inconclusive', lines: [{ status: 'inconclusive', reasonCode, reason, evidence: [] }] }; }

export function audit(raw: unknown): Report {
  const input = parseAuditInput(raw);
  if (!input) return inconclusive('invalid_input', 'Invalid audit input');
  if (new Set(input.rules.map(rule => `rule:${rule.id}@${rule.version}`)).size !== input.rules.length) return inconclusive('duplicate_source', 'Duplicate rule source identity');
  if (!validDate(input.order.date) || input.rules.some(rule => !validDate(rule.from) || !validDate(rule.to) || rule.from > rule.to)) return inconclusive('invalid_date', 'Invalid evidence date');
  const missingTax = input.order.lines.some(line => line.taxInclusive === undefined || line.taxBps === undefined);
  if (missingTax && input.order.discountCents > 0) return inconclusive('allocation_unknown', 'Tax basis missing; discount allocation cannot be established');
  const amounts = input.order.lines.map(line => fraction(BigInt(line.priceCents) * BigInt(line.quantity) * BigInt(line.discountBps), line.taxInclusive ? 10000n + BigInt(line.taxBps ?? 0) : 10000n));
  const total = amounts.reduce(add, fraction(0n));
  if (BigInt(input.order.discountCents) * total.d > total.n) return inconclusive('discount_exceeds_total', 'Order discount exceeds subtotal');
  const remaining = total.n === 0n ? fraction(1n) : fraction(total.n - BigInt(input.order.discountCents) * total.d, total.n);
  const lines: Finding[] = input.order.lines.map((line, index) => {
    const rules = input.rules.filter(rule => rule.product === line.product && rule.ledger === input.order.ledger && rule.from <= input.order.date && rule.to >= input.order.date);
    const evidence = [`order:${input.order.id}#/lines/${index}`, ...rules.map(rule => `rule:${rule.id}@${rule.version}`)];
    if (line.taxInclusive === undefined || line.taxBps === undefined) return { status: 'inconclusive', reasonCode: 'tax_missing', reason: 'Tax basis missing', evidence };
    if (line.baseUnits === undefined) return { status: 'inconclusive', reasonCode: 'conversion_missing', reason: 'Missing conversion', evidence };
    if (line.gift) return { status: 'inconclusive', reasonCode: 'gift_unsupported', reason: 'Unsupported gift policy', evidence };
    if (rules.length !== 1) return { status: 'inconclusive', reasonCode: rules.length ? 'overlap' : 'no_rule', reason: rules.length ? 'Overlapping rules; precedence unknown' : 'No applicable floor evidence', evidence };
    const rule = rules[0]!;
    const effective = multiply(multiply(amounts[index]!, remaining), fraction(1n, BigInt(line.quantity) * BigInt(line.baseUnits!)));
    return { status: effective.n < BigInt(rule.floorCents) * effective.d ? 'violation' : 'compliant',
      reasonCode: 'compared', reason: 'Compared with applicable floor', effectiveCents: `${effective.n}/${effective.d}`,
      evidence };
  });
  return { status: lines.some(line => line.status === 'violation') ? 'violation' : lines.some(line => line.status === 'inconclusive') ? 'inconclusive' : 'compliant', lines };
}
