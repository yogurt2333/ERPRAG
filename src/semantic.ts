import { policies, type Policy } from './retrieval.ts';

export type Embed = (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
export async function semanticSearch(query: string, scope: { ledger: string; date: string }, embed: Embed, corpus: readonly Policy[] = policies, signal?: AbortSignal) {
  const eligible = corpus.filter(policy => policy.ledger === scope.ledger && policy.from <= scope.date && policy.to >= scope.date);
  if (!query.trim() || !eligible.length) return [];
  const vectors = await embed([query, ...eligible.map(policy => policy.text)], signal);
  const dimensions = vectors[0]?.length;
  if (!dimensions || vectors.length !== eligible.length + 1 || vectors.some(vector => vector.length !== dimensions || vector.some(value => !Number.isFinite(value)) || Math.hypot(...vector) === 0)) throw new Error('Invalid embedding response');
  const target = vectors[0]!;
  return eligible.map((policy, index) => {
    const vector = vectors[index + 1]!;
    const score = target.reduce((sum, value, i) => sum + value * vector[i]!, 0) / (Math.hypot(...target) * Math.hypot(...vector));
    return { ...policy, citation: `policy:${policy.id}@${policy.version}#${policy.section}`, score };
  }).sort((a, b) => b.score - a.score || a.citation.localeCompare(b.citation)).slice(0, 3);
}

export function ollamaEmbed(model = 'embeddinggemma', baseUrl = 'http://127.0.0.1:11434'): Embed {
  return async (texts, signal) => {
    const response = await fetch(`${baseUrl}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts, truncate: false }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Ollama embedding HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('embeddings' in data) || !Array.isArray(data.embeddings) || !data.embeddings.every(vector => Array.isArray(vector) && vector.every(value => typeof value === 'number'))) throw new Error('Invalid Ollama embedding schema');
    return data.embeddings;
  };
}
