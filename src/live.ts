import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import type { Model } from '@earendil-works/pi-ai';
import { runInvestigation } from './agent.ts';
import { demoCases } from './fixtures.ts';
import { ollamaEmbed } from './semantic.ts';

const baseUrl = process.env.ERP_MODEL_BASE_URL;
const id = process.env.ERP_MODEL_ID;
if (!baseUrl || !id) {
  console.error('Set ERP_MODEL_BASE_URL and ERP_MODEL_ID explicitly. No default provider is contacted.');
  process.exitCode = 1;
} else {
  const model: Model<'openai-completions'> = { id, name: id, provider: 'erp-configured', api: 'openai-completions', baseUrl,
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16384, maxTokens: 2048 };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    const result = await runInvestigation(demoCases().conflict!, { model, signal: controller.signal, timeoutMs: Number(process.env.ERP_TIMEOUT_MS ?? 180000),
      embed: process.env.ERP_EMBED_MODEL ? ollamaEmbed(process.env.ERP_EMBED_MODEL) : undefined,
      streamFn: (model, context, options) => streamSimple(model as Model<'openai-completions'>, context, { ...options, apiKey: process.env.ERP_MODEL_API_KEY ?? 'local-no-key', maxTokens: 2048 }) });
    console.log(JSON.stringify({ synthetic: true, costAccounting: 'not configured', ...result }, null, 2));
    if (result.status !== 'completed') process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); }
}
