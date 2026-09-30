import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { ErpService } from '../src/erp/service.ts';
import { HermesBridge, proposalSchema } from '../src/erp/hermes/bridge.ts';
import { createHermesServer } from '../src/erp/hermes/server.ts';
const binding = { actorId: 'operator', accountId: 'bot', senderId: 'wx-operator', chatId: 'wx-operator' };
const c = (id: string) => ({ operationId: id, actorId: 'operator', channel: 'cli', confirmationId: id, confirmed: true });
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-hermes-')), path = join(dir, 'erp.sqlite');
  let fail = false;
  const s = new ErpService(path, { clock: () => new Date('2026-09-29T02:00:00Z'), beforeCommit() { if (fail) throw new Error('crash'); } });
  const p = s.createProduct({ name: '饮料', stockUnit: '瓶' }, c('p'));
  const w = s.createWarehouse({ name: '主仓' }, c('w'));
  const supplier = s.createSupplier({ name: '供应商' }, c('s'));
  const customer = s.createCustomer({ name: '客户' }, c('c'));
  let bridge = new HermesBridge(path, s, [binding]);
  t.after(() => { bridge.close(); s.close(); rmSync(dir, { recursive: true, force: true }); });
  const m = (id: string, text: string) => ({ accountId: 'bot', senderId: 'wx-operator', chatId: 'wx-operator', messageId: id, text });
  const purchase = (quantity = '3') => ({ kind: 'purchase_receipt', input: { supplierId: supplier.id, warehouseId: w.id,
    lines: [{ productId: p.id, unit: '瓶', quantity, amountCents: '300' }] } });
  return { s, path, p, w, supplier, customer, m, purchase, get b() { return bridge; },
    fail(v: boolean) { fail = v; }, reopen() { bridge.close(); bridge = new HermesBridge(path, s, [binding]); },
    propose(id = 'p1', text = '供应商 主仓 饮料 3瓶300分', plan = purchase()): any {
      const message = m(id, text); assert.equal((bridge.prepare(message) as any).status, 'planning');
      const reply = bridge.complete(message, plan) as any; bridge.displayed(message); return reply;
    } };
}
test('Hermes: scripted Weixin purchase and sale correction/display/plain confirmation loops', t => {
  const f = fixture(t);
  assert.equal(f.propose().status, 'draft');
  assert.equal(f.propose('p2', '修改：改成5瓶', f.purchase('5')).version, 2);
  assert.equal((f.b.prepare(f.m('yes', '确认')) as any).status, 'posted');
  assert.equal(f.s.getStock(f.p.id, f.w.id).quantity.numerator, '5');
  const order = { kind: 'sales_order', input: { customerId: f.customer.id, warehouseId: f.w.id,
    lines: [{ productId: f.p.id, unit: '瓶', quantity: '2', amountCents: '400' }] } };
  assert.equal(f.propose('sale', '客户 主仓 饮料 2瓶400分', order as any).status, 'draft');
  f.b.prepare(f.m('order-confirm', '确认'));
  const orderId = f.s.listSalesOrders()[0]!.id;
  const delivery = (amountCents: string) => ({ kind: 'delivery_and_receipt', input: { delivery: { orderId, expectedRevision: 1,
    lines: [{ orderLineIndex: 0, quantity: '2', amountCents }] }, amountCents } });
  assert.equal(f.propose('delivery', '确认交货并收款', delivery('400') as any).status, 'draft');
  const correction = f.propose('delivery-edit', '修改：实收500分', delivery('500') as any);
  assert.match(correction.text, /5\.00元/);
  const result = f.b.prepare(f.m('sale-confirm', '确认'));
  assert.equal((result as any).status, 'posted');
  assert.equal(f.s.listDeliveries().length, 1); assert.equal(f.s.listSettlements().length, 1);
  assert.equal(f.s.getStock(f.p.id, f.w.id).quantity.numerator, '3');
  f.reopen(); assert.deepEqual(f.b.prepare(f.m('sale-confirm', '确认')), result);
  assert.equal(f.s.listDeliveries().length, 1);
  assert.equal(f.s.listAuditEvents().at(-1)!.channel, 'hermes');
});
test('Hermes: duplicate messages cannot overwrite a new draft or repost after restart', t => {
  const f = fixture(t), proposal = f.propose();
  const posted = f.b.prepare(f.m('yes', '确认'));
  f.propose('next'); f.reopen();
  assert.deepEqual(f.b.prepare(f.m('yes', '确认')), posted);
  assert.deepEqual(f.b.prepare(f.m('p1', '供应商 主仓 饮料 3瓶300分')), proposal);
  assert.equal(f.s.listPurchaseReceipts().length, 1);
  assert.throws(() => f.b.prepare(f.m('yes', '其他业务')), /reused/);
});
test('Hermes: second intent and model confirmation injection cannot replace/post pending draft', t => {
  const f = fixture(t); f.propose();
  assert.equal((f.b.prepare(f.m('other', '再进一批货')) as any).status, 'rejected');
  assert.equal((f.b.prepare(f.m('edit', '修改：交货')) as any).status, 'planning');
  assert.equal((f.b.complete(f.m('edit', '修改：交货'), { kind: 'confirm', input: {} }) as any).status, 'rejected');
  // Old display acknowledgment cannot re-enable a draft after failed correction.
  f.b.displayed(f.m('p1', '供应商 主仓 饮料 3瓶300分'));
  assert.equal((f.b.prepare(f.m('yes', '确认')) as any).status, 'rejected');
  assert.equal(f.s.listPurchaseReceipts().length, 0);
  assert.equal((f.b.prepare(f.m('cancel', '取消')) as any).status, 'cancelled');
});
test('Hermes: display failure blocks confirmation; successful full delivery unlocks it', t => {
  const f = fixture(t), message = f.m('prepare', '采购');
  f.b.prepare(message); f.b.complete(message, f.purchase());
  assert.equal((f.b.prepare(f.m('no-display', '确认')) as any).status, 'rejected');
  f.b.displayed(message);
  assert.equal((f.b.prepare(f.m('displayed-confirm', '确认')) as any).status, 'posted');
});
test('Hermes: durable applying action recovers after transaction failure without replanning', t => {
  const f = fixture(t); f.propose(); f.fail(true);
  assert.throws(() => f.b.prepare(f.m('yes', '确认')), /crash/);
  assert.equal(f.s.listPurchaseReceipts().length, 0); f.fail(false); f.reopen();
  assert.equal((f.b.prepare(f.m('yes', '确认')) as any).status, 'posted');
  assert.equal(f.s.listPurchaseReceipts().length, 1);
});
test('Hermes: binding checks, strict bounded input, minimal model context and provider outage', t => {
  const f = fixture(t);
  assert.throws(() => f.b.prepare({ ...f.m('bad', '采购'), senderId: 'stranger' }), /Unbound/);
  assert.throws(() => f.b.prepare({ ...f.m('bad', '采购'), actorId: 'forged' }), /Invalid/);
  const reply: any = f.b.prepare(f.m('query', '饮料'));
  assert.deepEqual(reply.context.candidates.customers, []);
  assert.equal(reply.context.candidates.products.length, 1);
  assert.doesNotMatch(JSON.stringify(reply.context), /payables|receivables|history/);
  assert.equal((f.b.complete(f.m('query', '饮料'), null) as any).status, 'rejected');
  f.s.createWarehouse({ name: '模型离线仍可操作' }, c('offline'));
  assert.equal(f.s.listMasters('warehouse').length, 2);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../deploy/lean-erp/hermes/schemas.json', import.meta.url), 'utf8')), JSON.parse(JSON.stringify(proposalSchema)));
});
test('Hermes: v10 migration preserves posted business data', t => {
  const f = fixture(t), db = new DatabaseSync(f.path);
  db.exec('DROP TABLE hermes_events; DROP TABLE hermes_displays; PRAGMA user_version=10'); db.close();
  f.reopen(); assert.equal(f.s.listMasters('product')[0]!.name, '饮料');
  assert.equal(f.propose().status, 'draft');
});
test('Hermes: a new event recovers a crash after posting but before bridge acknowledgment', t => {
  const f = fixture(t); f.propose();
  f.b.prepare(f.m('yes', '确认'));
  const db = new DatabaseSync(f.path);
  const row = db.prepare("SELECT scope, document FROM hermes_events WHERE event_id='yes'").get()!;
  const record = JSON.parse(String(row.document)); record.state = 'applying'; delete record.reply; delete record.response;
  db.prepare("UPDATE hermes_events SET document=? WHERE event_id='yes'").run(JSON.stringify(record)); db.close();
  f.reopen();
  assert.equal((f.b.prepare(f.m('retry-human', '确认')) as any).status, 'posted');
  assert.equal(f.s.listPurchaseReceipts().length, 1);
});
test('Hermes: timed-out extraction releases the conversation and late model replies cannot replace it', t => {
  const f = fixture(t), message = f.m('timeout', '采购'); f.b.prepare(message);
  const db = new DatabaseSync(f.path);
  const row = db.prepare("SELECT document FROM hermes_events WHERE event_id='timeout'").get()!;
  const record = JSON.parse(String(row.document)); record.createdAt = Date.now() - 61000;
  db.prepare("UPDATE hermes_events SET document=? WHERE event_id='timeout'").run(JSON.stringify(record)); db.close();
  assert.equal(f.propose('fresh').status, 'draft');
  assert.equal((f.b.complete(message, f.purchase('50')) as any).status, 'rejected');
  assert.equal((f.b.prepare(f.m('yes', '确认')) as any).status, 'posted');
  assert.equal(f.s.getStock(f.p.id, f.w.id).quantity.numerator, '3');
});
test('Hermes: bounded schemas and business-state changes reject unsafe drafts', t => {
  const f = fixture(t), message = f.m('oversize', '采购'); f.b.prepare(message);
  const plan = f.purchase(); plan.input.lines = Array.from({ length: 6 }, () => plan.input.lines[0]!);
  assert.equal((f.b.complete(message, plan) as any).status, 'rejected');
  f.propose('normal'); f.s.createWarehouse({ name: '另一个业务写入' }, c('new-state'));
  assert.equal((f.b.prepare(f.m('yes', '确认')) as any).status, 'rejected');
  assert.equal(f.s.listPurchaseReceipts().length, 0);
});
test('Hermes: loopback HTTP auth, notifications retry/ack and unchanged-event suppression', async t => {
  const f = fixture(t), token = 'x'.repeat(40), app = createHermesServer(f.path, f.s, token, [binding], binding);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  try {
  const port = (app.server.address() as { port: number }).port;
  const call = (route: string, body = {}, headers = {}) => fetch(`http://127.0.0.1:${port}/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
  assert.equal((await call('prepare', f.m('p', '采购'), { Authorization: 'bad' })).status, 401);
  assert.equal((await call('prepare', f.m('p', '采购'), { Origin: 'https://attacker.invalid' })).status, 401);
  const first = await (await call('notifications')).json() as any;
  assert.deepEqual(first.target, binding);
  assert.deepEqual(new Set(first.events.map((e: any) => e.kind)), new Set(['immediate', 'daily', 'weekly']));
  assert.deepEqual(await (await call('notifications')).json(), first);
  for (const e of first.events) assert.equal((await call('ack', { id: e.id })).status, 200);
  assert.deepEqual((await (await call('notifications')).json() as any).events, []);
  } finally { app.server.closeAllConnections(); app.close(); }
});

test('Hermes: readable draft, review and legacy replay preserve the unposted business values', t => {
  const f = fixture(t), first = f.propose();
  assert.match(first.text, /待确认，尚未入账/);
  assert.match(first.text, /供应商：供应商/);
  assert.match(first.text, /仓库：主仓/);
  assert.match(first.text, /饮料 3瓶，合计3\.00元/);
  assert.doesNotMatch(first.text, /amountCents|supplierId|posted|[{}]|[0-9a-f]{8}-/);
  const review = f.b.prepare(f.m('review', '查看草稿')) as any;
  assert.equal(review.text, first.text);
  assert.equal(review.version, first.version);
  assert.equal(f.s.listPurchaseReceipts().length, 0);
  const db = new DatabaseSync(f.path);
  db.prepare(`UPDATE hermes_events SET document=json_set(document,'$.response.text','{"old":"json"}') WHERE event_id='p1'`).run();
  db.close();
  assert.equal((f.b.prepare(f.m('p1', '供应商 主仓 饮料 3瓶300分')) as any).text, first.text);
  f.b.displayed(f.m('review', '查看草稿'));
  const posted = f.b.prepare(f.m('confirm-readable', '确认')) as any;
  assert.match(posted.text, /采购入库｜已完成/);
  assert.match(posted.text, /货款合计：3\.00元/);
  assert.doesNotMatch(posted.text, /[{}]|amountCents/);
  assert.equal(f.s.listPurchaseReceipts().length, 1);
});
