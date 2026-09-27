import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPolicies } from '../src/retrieval.ts';

test('retrieves a cited policy excerpt for price-floor investigation', () => {
  const results = searchPolicies('最低限价', { ledger: 'demo', date: '2026-09-17' });
  assert.equal(results[0]?.citation, 'policy:price-floor@1#floor');
  assert.match(results[0]!.text, /折后/);
});
test('generic words and unrelated topics do not qualify as policy evidence', () => {
  for (const query of ['的', '没有', '这个怎么处理', '这是一个问题', '如何申请年假', '旅游订单怎么处理', '']) {
    assert.deepEqual(searchPolicies(query, { ledger: 'demo', date: '2026-09-17' }), [], query);
  }
});
test('other ledgers, expired policies and irrelevant queries yield no evidence', () => {
  assert.deepEqual(searchPolicies('最低限价', { ledger: 'other', date: '2026-09-17' }), []);
  assert.deepEqual(searchPolicies('最低限价', { ledger: 'demo', date: '2027-01-01' }), []);
  assert.deepEqual(searchPolicies('火星旅游', { ledger: 'demo', date: '2026-09-17' }), []);
});
