export interface Policy {
  id: string; version: string; section: string; ledger: string;
  from: string; to: string; text: string;
}
export const policies: readonly Policy[] = [
  { id: 'price-floor', version: '1', section: 'floor', ledger: 'demo', from: '2026-01-01', to: '2026-12-31',
    text: '【演示政策】最低限价：折后单价分摊整单优惠后，换算为不含税基本单位价格。严格低于最低限价判定违规，等于限价合规。' },
  { id: 'conversion', version: '1', section: 'units', ledger: 'demo', from: '2026-01-01', to: '2026-12-31',
    text: '【演示政策】单位换算：箱价除以每箱基本单位数量；含税价格除以一加税率。换算因子或税价口径缺失时无法判定。' },
  { id: 'precedence', version: '1', section: 'scope', ledger: 'demo', from: '2026-01-01', to: '2026-12-31',
    text: '【演示政策】规则范围：仅适用同账套、同商品、生效日期内的规则。重叠规则没有优先级时无法判定；不得自行选择较低或较高限价。' }
];
const stopwords = new Set(['的', '了', '是', '在', '和', '与', '或', '有', '没有', '是否', '可以', '怎么', '如何', '什么', '这个', '一个', '需要', '问题', '处理', '我', '你', '请']);
export function searchPolicies(query: string, scope: { ledger: string; date: string }, corpus: readonly Policy[] = policies) {
  const terms = Array.from(new Intl.Segmenter('zh', { granularity: 'word' }).segment(query.toLowerCase()))
    .filter(segment => segment.isWordLike && !stopwords.has(segment.segment)).map(segment => segment.segment);
  return corpus.filter(policy => policy.ledger === scope.ledger && policy.from <= scope.date && policy.to >= scope.date)
    .map(policy => ({ ...policy, citation: `policy:${policy.id}@${policy.version}#${policy.section}`,
      score: new Set(terms.filter(term => policy.text.toLowerCase().includes(term))).size }))
    .filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.citation.localeCompare(b.citation)).slice(0, 3);
}
