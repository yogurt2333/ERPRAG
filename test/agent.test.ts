import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { runInvestigation } from '../src/agent.ts';
import { demoCases } from '../src/fixtures.ts';

const model: Model<'openai-completions'> = { id: 'offline', name: 'offline test', api: 'openai-completions', provider: 'offline', baseUrl: 'http://localhost', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1000 };
function scripted(steps: AssistantMessage['content'][]): StreamFn {
  let turn = 0;
  return () => {
    const content = steps[Math.min(turn++, steps.length - 1)]!;
    const message: AssistantMessage = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: 0 };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop', message });
    return stream;
  };
}
test('Pi retrieves evidence and audits through actual registered tools', async () => {
  const result = await runInvestigation(demoCases().conflict!, { model, streamFn: scripted([
    [{ type: 'toolCall', id: '1', name: 'search_policies', arguments: { query: '最低限价' } }],
    [{ type: 'toolCall', id: '2', name: 'audit_order', arguments: {} }],
    [{ type: 'text', text: '已发现违规。' }]
  ]) });
  assert.equal(result.status, 'completed');
  assert.equal(result.report?.status, 'violation');
  assert.ok(result.evidence.includes('policy:price-floor@1#floor'));
  assert.equal(result.toolCalls, 2);
});
test('a fabricated model discount never enters the deterministic explanation', async () => {
  const result = await runInvestigation(demoCases().conflict!, { model, streamFn: scripted([
    [{ type: 'toolCall', id: '1', name: 'search_policies', arguments: { query: '最低限价' } }],
    [{ type: 'toolCall', id: '2', name: 'audit_order', arguments: {} }],
    [{ type: 'text', text: '含10%折扣，缺少税价口径' }]
  ]) });
  assert.match(result.auditExplanation!.markdown, /无行折扣/);
  assert.doesNotMatch(result.auditExplanation!.markdown, /含10%折扣|缺少税价口径/);
  assert.equal(result.commentaryVerified, false);
});
test('irrelevant semantic candidates do not qualify as supporting evidence', async () => {
  const result = await runInvestigation(demoCases().conflict!, { model,
    embed: async texts => texts.map(() => [1, 0]), streamFn: scripted([
      [{ type: 'toolCall', id: '1', name: 'search_policies', arguments: { query: '火星旅游' } }],
      [{ type: 'toolCall', id: '2', name: 'audit_order', arguments: {} }],
      [{ type: 'text', text: 'done' }]
    ]) });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.evidence.some(id => id.startsWith('policy:')), false);
});
test('pre-cancelled run does not execute any tools', async () => {
  const result = await runInvestigation(demoCases().conflict!, { model, signal: AbortSignal.abort(), streamFn: scripted([[{ type: 'text', text: 'done' }]]) });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.toolCalls, 0);
});
test('model-only assertion without evidence is incomplete', async () => {
  const result = await runInvestigation(demoCases().conflict!, { model, streamFn: scripted([[{ type: 'text', text: 'Everything is compliant.' }]]) });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.report, undefined);
});
test('unknown tool fails instead of completing a report', async () => {
  const result = await runInvestigation(demoCases().conflict!, { model, maxTurns: 2, streamFn: scripted([
    [{ type: 'toolCall', id: 'bad', name: 'write_erp', arguments: {} }], [{ type: 'text', text: 'done' }]
  ]) });
  assert.equal(result.status, 'failed');
});
test('timeout bounds a nonresponding external model transport', async () => {
  const result = await runInvestigation(demoCases().conflict!, { model, timeoutMs: 20, streamFn: () => createAssistantMessageEventStream() });
  assert.equal(result.status, 'timeout');
});
test('runtime caps repeated calls and does not label budget exhaustion completed', async () => {
  const result = await runInvestigation(demoCases().conflict!, { model, maxTools: 2,
    streamFn: scripted([[{ type: 'toolCall', id: 'repeat', name: 'audit_order', arguments: {} }]]) });
  assert.equal(result.status, 'budget_exceeded');
  assert.equal(result.toolCalls, 2);
});
