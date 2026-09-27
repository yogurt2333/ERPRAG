import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRetrieval } from '../src/evaluation.ts';

test('positive hit rate and negative false acceptance are measured separately', async () => {
  const result = await evaluateRetrieval([
    { query: '最低限价', expected: 'price-floor', kind: 'positive', ledger: 'demo', date: '2026-09-17' },
    { query: '火星旅游', expected: null, kind: 'unsupported', ledger: 'demo', date: '2026-09-17' },
    { query: '最低限价', expected: null, kind: 'scope', ledger: 'other', date: '2026-09-17' }
  ]);
  assert.equal(result.metrics.lexical.positiveTop1, 1);
  assert.equal(result.metrics.accepted.negativeFalseAcceptance, 0);
  assert.equal(result.metrics.semantic, null);
  assert.equal(result.counts.positive, 1);
  assert.equal(result.counts.negative, 2);
});
