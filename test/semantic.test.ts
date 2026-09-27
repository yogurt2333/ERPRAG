import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semanticSearch } from '../src/semantic.ts';
import { policies } from '../src/retrieval.ts';

test('semantic retrieval uses vectors for paraphrases and preserves citations', async () => {
  const result = await semanticSearch('一大包和一小包怎么比', { ledger: 'demo', date: '2026-09-17' },
    async texts => texts.map((text, index) => text.includes('一大包') || text.includes('单位换算：') ? [1, 0] : [0, 1]), policies);
  assert.equal(result[0]?.citation, 'policy:conversion@1#units');
});
test('invalid vectors fail and excluded ledgers are not sent for embedding', async () => {
  await assert.rejects(semanticSearch('价格', { ledger: 'demo', date: '2026-09-17' }, async () => [[0, 0]]), /Invalid embedding/);
  const result = await semanticSearch('价格', { ledger: 'other', date: '2026-09-17' }, async () => { throw new Error('must not call'); });
  assert.deepEqual(result, []);
});
