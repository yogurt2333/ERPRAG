import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit.ts';
import type { AuditRequest } from '../src/audit.ts';
import { demoCases } from '../src/fixtures.ts';

export const request = {
  order: { id: 'O1', ledger: 'demo', date: '2026-09-17', discountCents: 0,
    lines: [{ product: 'P1', quantity: 1, priceCents: 17280, discountBps: 10000, baseUnits: 1, taxBps: 0, taxInclusive: false }] },
  rules: [{ id: 'R1', version: '1', ledger: 'demo', product: 'P1', from: '2026-01-01', to: '2026-12-31', floorCents: 18000 }]
};
test('same-unit price below floor reports a violation with source locators', () => {
  const result = audit(request);
  assert.equal(result.status, 'violation');
  assert.equal(result.lines[0]?.effectiveCents, '17280/1');
  assert.deepEqual(result.lines[0]?.evidence, ['order:O1#/lines/0', 'rule:R1@1']);
});
test('demo case citations uniquely identify different orders', () => {
  const references = Object.values(demoCases()).map(input => audit(input).lines[0]!.evidence[0]);
  assert.equal(new Set(references).size, 4);
});
test('known violation survives a separate unknown tax basis without order discount', () => {
  const input: AuditRequest = structuredClone(request);
  input.order.lines.push({ ...input.order.lines[0]!, taxBps: undefined });
  const result = audit(input);
  assert.equal(result.status, 'violation');
  assert.deepEqual(result.lines.map(line => line.status), ['violation', 'inconclusive']);
});
test('ledger and effective dates are respected, equality is compliant', () => {
  const input = structuredClone(request);
  input.order.lines[0]!.priceCents = 18000;
  assert.equal(audit(input).status, 'compliant');
  input.rules[0]!.ledger = 'other';
  assert.equal(audit(input).status, 'inconclusive');
  input.rules[0]!.ledger = 'demo';
  input.rules[0]!.to = '2026-09-16';
  assert.equal(audit(input).status, 'inconclusive');
});
test('order discount is allocated proportionally across lines without rounding', () => {
  const input = structuredClone(request);
  input.order.lines[0]!.priceCents = 20000;
  input.order.lines.push({ ...input.order.lines[0]!, priceCents: 10000 });
  input.order.discountCents = 300;
  assert.deepEqual(audit(input).lines.map(line => line.effectiveCents), ['19800/1', '9900/1']);
});
test('zero priced goods and sub-cent boundary remain auditable', () => {
  const input = structuredClone(request);
  input.order.lines[0]!.priceCents = 0;
  assert.equal(audit(input).status, 'violation');
  Object.assign(input.order.lines[0]!, { priceCents: 35999, baseUnits: 2 });
  assert.equal(audit(input).status, 'violation');
  assert.equal(audit(input).lines[0]?.effectiveCents, '35999/2');
});
test('missing conversion, malformed input and excessive discounts never pass', () => {
  const missing: AuditRequest = structuredClone(request);
  delete missing.order.lines[0]!.baseUnits;
  assert.equal(audit(missing).status, 'inconclusive');
  for (const value of [null, {}, { order: null }, { ...request, rules: [null] }]) {
    assert.equal(audit(value).status, 'inconclusive');
  }
  const excessive = structuredClone(request);
  excessive.order.discountCents = 999999;
  assert.equal(audit(excessive).status, 'inconclusive');
});
test('overlapping applicable rules are inconclusive and both are cited', () => {
  const input = structuredClone(request);
  input.rules.push({ ...input.rules[0]!, id: 'R2', floorCents: 16000 });
  const result = audit(input);
  assert.equal(result.status, 'inconclusive');
  assert.deepEqual(result.lines[0]?.evidence, ['order:O1#/lines/0', 'rule:R1@1', 'rule:R2@1']);
});
test('tax-inclusive box price is normalized to exclusive base-unit price', () => {
  const input = structuredClone(request);
  Object.assign(input.order.lines[0]!, { priceCents: 226000, baseUnits: 10, taxBps: 1300, taxInclusive: true });
  const result = audit(input);
  assert.equal(result.status, 'compliant');
  assert.equal(result.lines[0]?.effectiveCents, '20000/1');
});
test('line discount followed by order discount can breach the floor', () => {
  const input = structuredClone(request);
  input.order.lines[0]!.priceCents = 20000;
  input.order.lines[0]!.discountBps = 9000;
  input.order.discountCents = 100;
  const result = audit(input);
  assert.equal(result.status, 'violation');
  assert.equal(result.lines[0]?.effectiveCents, '17900/1');
});
