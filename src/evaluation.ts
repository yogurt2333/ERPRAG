import { retrievePolicies } from './policy-search.ts';
import type { Embed } from './semantic.ts';

export interface EvaluationCase { query: string; expected: string | null; kind: 'positive' | 'unsupported' | 'scope'; ledger: string; date: string }
const scope = { ledger: 'demo', date: '2026-09-17' };
export const evaluationCases: EvaluationCase[] = [
  ...[
    ['最低限价', 'price-floor'], ['给客户让利后还能不能卖', 'price-floor'],
    ['单位换算', 'conversion'], ['一大箱的报价怎样跟一小盒对比', 'conversion'],
    ['重叠规则', 'precedence'], ['同时有两份约束都说自己有效，该听谁的', 'precedence']
  ].map(([query, expected]) => ({ query: query!, expected: expected!, kind: 'positive' as const, ...scope })),
  ...['火星旅游', '如何申请年假', '这个怎么处理', '的', '没有', ''].map(query => ({ query, expected: null, kind: 'unsupported' as const, ...scope })),
  { query: '最低限价', expected: null, kind: 'scope', ...scope, ledger: 'other' },
  { query: '最低限价', expected: null, kind: 'scope', ...scope, date: '2027-01-01' }
];

export async function evaluateRetrieval(cases: readonly EvaluationCase[] = evaluationCases, embed?: Embed) {
  const rows = [];
  for (const item of cases) {
    const result = await retrievePolicies(item.query, item, { embed });
    rows.push({ ...item, lexical: result.lexical.map(hit => hit.id),
      semantic: embed ? result.candidates.map(hit => hit.id) : null, accepted: result.accepted.map(hit => hit.id) });
  }
  const positives = rows.filter(row => row.kind === 'positive');
  const negatives = rows.filter(row => row.kind !== 'positive');
  function metrics(mode: 'lexical' | 'semantic' | 'accepted') {
    return {
      positiveTop1: positives.length ? positives.filter(row => row[mode]?.[0] === row.expected).length / positives.length : null,
      negativeFalseAcceptance: negatives.length ? negatives.filter(row => (row[mode]?.length ?? 0) > 0).length / negatives.length : null,
      scopeLeaks: negatives.filter(row => row.kind === 'scope' && (row[mode]?.length ?? 0) > 0).length
    };
  }
  return { counts: { positive: positives.length, negative: negatives.length },
    metrics: { lexical: metrics('lexical'), semantic: embed ? metrics('semantic') : null, accepted: metrics('accepted') }, rows };
}
