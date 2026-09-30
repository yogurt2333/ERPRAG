import { writeFileSync } from 'node:fs';
import { proposalSchema } from './bridge.ts';
writeFileSync(new URL('../../../deploy/lean-erp/hermes/schemas.json', import.meta.url), JSON.stringify(proposalSchema, null, 2) + '\n');
