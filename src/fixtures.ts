import type { AuditRequest } from './audit.ts';

const base: AuditRequest = {
  order: { id: 'DEMO-001', ledger: 'demo', date: '2026-09-17', discountCents: 0,
    lines: [{ product: 'DEMO-P1', quantity: 1, priceCents: 17280, discountBps: 10000, baseUnits: 1, taxBps: 0, taxInclusive: false }] },
  rules: [{ id: 'DEMO-FLOOR', version: '1', ledger: 'demo', product: 'DEMO-P1', from: '2026-01-01', to: '2026-12-31', floorCents: 18000 }]
};
export function demoCases(): Record<string, AuditRequest> {
  const discount = structuredClone(base);
  discount.order.id = 'DEMO-002';
  Object.assign(discount.order.lines[0]!, { priceCents: 20000, discountBps: 9000 });
  discount.order.discountCents = 100;
  const conversion = structuredClone(base);
  conversion.order.id = 'DEMO-003';
  Object.assign(conversion.order.lines[0]!, { priceCents: 226000, baseUnits: 10, taxBps: 1300, taxInclusive: true });
  const overlap = structuredClone(base);
  overlap.order.id = 'DEMO-004';
  overlap.rules.push({ ...overlap.rules[0]!, id: 'DEMO-SECOND-FLOOR', floorCents: 16000 });
  return { conflict: structuredClone(base), discount, conversion, overlap };
}
