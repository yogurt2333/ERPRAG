import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainAudit } from '../src/explanation.ts';
import { demoCases } from '../src/fixtures.ts';

test('explanation states actual discount, tax and units rather than live-model inventions', () => {
  const result = explainAudit(demoCases().conflict!);
  assert.match(result.markdown, /172\.80 元/);
  assert.match(result.markdown, /180\.00 元/);
  assert.match(result.markdown, /无行折扣/);
  assert.match(result.markdown, /不含税/);
  assert.match(result.markdown, /基本单位换算因子：1/);
  assert.match(result.markdown, /order:DEMO-001#\/lines\/0/);
  assert.doesNotMatch(result.markdown, /缺少|10%/);
});
test('ambiguous rule identities across ledgers cannot be presented as evidence', () => {
  const input = demoCases().conflict!;
  input.rules.push({ ...input.rules[0]!, ledger: 'other', floorCents: 99999 });
  const result = explainAudit(input);
  assert.equal(result.report.status, 'inconclusive');
  assert.match(result.markdown, /来源标识重复/);
  assert.doesNotMatch(result.markdown, /999\.99 元/);
});
test('fractional cents remain exact and malformed input fails closed', () => {
  const input = demoCases().conflict!;
  input.order.lines[0]!.priceCents = 35999;
  input.order.lines[0]!.baseUnits = 2;
  assert.match(explainAudit(input).markdown, /179\.995 元/);
  const invalid = explainAudit(null);
  assert.equal(invalid.report.status, 'inconclusive');
  assert.match(invalid.markdown, /输入不符合/);
});
test('unknown conversion and overlapping rules are explained without inventing a price', () => {
  const missing = demoCases().conflict!;
  delete missing.order.lines[0]!.baseUnits;
  assert.match(explainAudit(missing).markdown, /缺少单位换算因子/);
  const overlap = explainAudit(demoCases().overlap!);
  assert.match(overlap.markdown, /多条规则同时适用/);
  assert.match(overlap.markdown, /rule:DEMO-SECOND-FLOOR@1/);
  assert.doesNotMatch(overlap.markdown, /有效价格：/);
});
