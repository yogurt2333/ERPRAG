import { explainAudit } from './explanation.ts';
import { demoCases } from './fixtures.ts';
import { searchPolicies } from './retrieval.ts';

const output = Object.entries(demoCases()).map(([name, input]) => ({
  name, synthetic: true, sources: input, ...explainAudit(input),
  supportingPolicies: searchPolicies('最低限价 单位换算 重叠规则', input.order)
}));
console.log(process.argv.includes('--markdown') ? output.map(item => `案例：${item.name}\n\n${item.markdown}`).join('\n\n---\n\n') : JSON.stringify(output, null, 2));
