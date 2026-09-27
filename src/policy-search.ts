import { searchPolicies, type Policy } from './retrieval.ts';
import { semanticSearch, type Embed } from './semantic.ts';

/** One acceptance path for runtime and evaluation. Semantic-only hits remain candidates. */
export async function retrievePolicies(query: string, scope: { ledger: string; date: string }, options: { embed?: Embed; signal?: AbortSignal; corpus?: readonly Policy[] } = {}) {
  const lexical = searchPolicies(query, scope, options.corpus);
  const candidates = options.embed ? await semanticSearch(query, scope, options.embed, options.corpus, options.signal) : lexical;
  const accepted = candidates.filter(candidate => lexical.some(match => match.citation === candidate.citation));
  return { lexical, candidates, accepted, acceptance: 'lexical-overlap gate; candidates alone are not supporting evidence' };
}
