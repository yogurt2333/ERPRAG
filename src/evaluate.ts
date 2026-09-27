import { policies } from './retrieval.ts';
import { ollamaEmbed } from './semantic.ts';
import { evaluateRetrieval } from './evaluation.ts';

const offline = process.argv.includes('--offline');
const result = await evaluateRetrieval(undefined, offline ? undefined : ollamaEmbed());
console.log(JSON.stringify({ model: offline ? null : 'embeddinggemma', corpusSize: policies.length,
  limitation: 'Development smoke set, not held-out quality. Raw semantic negative hits are candidates, not accepted support. No calibrated threshold.', ...result }, null, 2));
