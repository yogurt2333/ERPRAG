import { resolve } from 'node:path';
import { createErpWeb } from './server.ts';
import { createHermesServer } from '../hermes/server.ts';
const origin = process.env.ERP_WEB_ORIGIN;
if (!origin) throw new Error('Set ERP_WEB_ORIGIN to the stable HTTPS origin (for example https://erp.example.com)');
const app = createErpWeb(resolve(process.env.ERP_DB ?? 'erp.sqlite'), origin);
if (process.argv[2] === 'bootstrap') {
  console.log('One-time enrollment token (10 minutes; share privately):');
  console.log(app.auth.bootstrap(process.argv[3] ?? '操作员')); app.close();
} else {
  const bindings = process.env.ERP_HERMES_BINDINGS ? JSON.parse(process.env.ERP_HERMES_BINDINGS) : null;
  const hermes = bindings ? createHermesServer(resolve(process.env.ERP_DB ?? 'erp.sqlite'), app.erp,
    process.env.ERP_HERMES_TOKEN ?? '', bindings, bindings[0]) : null;
  hermes?.server.listen(Number(process.env.ERP_HERMES_PORT ?? 3101), '127.0.0.1');
  const port = Number(process.env.ERP_PORT ?? 3100);
  app.server.listen(port, '127.0.0.1', () => console.log(`ERP listening on loopback:${port}; HTTPS origin ${origin}`));
  process.on('SIGINT', () => { hermes?.close(); app.close(); }); process.on('SIGTERM', () => { hermes?.close(); app.close(); });
}
