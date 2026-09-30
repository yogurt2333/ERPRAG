// Isolated live-channel acceptance fixture. Never point this at a real ERP database.
import { ErpService } from '../../../src/erp/service.ts';
import { createHermesServer } from '../../../src/erp/hermes/server.ts';
const path = process.env.ERP_DB;
if (path !== '/var/lib/lean-erp-hermes-test/erp.sqlite') throw new Error('Isolated fixture path required');
const erp = new ErpService(path);
const confirmation = (id: string) => ({ operationId: `wechat-fixture:${id}`, actorId: 'fixture', channel: 'cli', confirmationId: id, confirmed: true });
erp.createProduct({ name: '测试饮料', stockUnit: '瓶' }, confirmation('product'));
erp.createSupplier({ name: '测试供应商' }, confirmation('supplier'));
erp.createCustomer({ name: '测试客户' }, confirmation('customer'));
erp.createWarehouse({ name: '测试仓' }, confirmation('warehouse'));
const bindings = JSON.parse(process.env.ERP_HERMES_BINDINGS ?? '[]');
const app = createHermesServer(path, erp, process.env.ERP_HERMES_TOKEN ?? '', bindings, bindings[0]);
app.server.listen(3101, '127.0.0.1', () => console.log('Isolated ERP Weixin acceptance bridge ready'));
const close = () => { app.close(); erp.close(); };
process.on('SIGTERM', close); process.on('SIGINT', close);
