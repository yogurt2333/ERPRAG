import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createErpWeb } from '../src/erp/web/server.ts';
import { TestPasskey } from './helpers/passkey.ts';
const origin = 'https://erp.example.test';
async function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'erp-web-')), path = join(dir, 'db.sqlite');
  let now = Date.now(), app = createErpWeb(path, origin, () => now);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  t.after(() => { app.server.closeAllConnections(); app.close(); rmSync(dir, { recursive: true, force: true }); });
  const client = () => {
    const jar = new Map<string, string>();
    return { jar, async request(route: string, data?: unknown, headers: Record<string, string> = {}) {
      const res = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST',
        headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), Cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; '), ...headers },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      for (const cookie of res.headers.getSetCookie()) { const [k,v] = cookie.split(';')[0]!.split('='); jar.set(k!, v!); }
      return { status: res.status, value: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text(), headers: res.headers };
    } };
  };
  const a = client();
  async function enroll(c = a, grant = app.auth.bootstrap('甲')) {
    const key = new TestPasskey(); const options = await c.request('/api/auth/register/options', { grant }); assert.equal(options.status, 200);
    const result = await c.request('/api/auth/register/verify', { credential: key.register(options.value) }); assert.equal(result.status, 200, JSON.stringify(result.value));
    return { key, codes: result.value.recoveryCodes as string[], result };
  }
  async function login(c: ReturnType<typeof client>, key: TestPasskey, mode = 'login') {
    const options = await c.request(`/api/auth/${mode}/options`, {});
    const result = await c.request(`/api/auth/${mode}/verify`, { credential: key.assert(options.value) }); assert.equal(result.status, 200, JSON.stringify(result.value));
    return result;
  }
  return { app, path, a, client, enroll, login, advance(ms: number) { now += ms; }, get now() { return now; } };
}
test('Web: bootstrap is private, short-lived, single-use; real passkey enrollment and secure server sessions', async t => {
  const f = await setup(t);
  assert.equal((await f.a.request('/api/me')).status, 401);
  assert.equal((await f.a.request('/api/auth/register/options', {})).status, 401);
  const expired = f.app.auth.bootstrap('甲'); f.advance(600001);
  assert.equal((await f.a.request('/api/auth/register/options', { grant: expired })).status, 401);
  const grant = f.app.auth.bootstrap('甲'), { codes, result } = await f.enroll(f.a, grant);
  assert.equal(codes.length, 8);
  const cookie = result.headers.getSetCookie().find(c => c.startsWith('__Host-erp-session='))!;
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  assert.equal((await f.a.request('/api/me')).value.user.name, '甲');
  assert.equal((await f.client().request('/api/auth/register/options', { grant })).status, 401);
  assert.throws(() => f.app.auth.bootstrap('乙'), /Already enrolled/);
  const db = new DatabaseSync(f.path); const authRows = JSON.stringify(db.prepare('SELECT * FROM web_auth').all());
  assert.ok(!authRows.includes(codes[0]!)); assert.ok(!authRows.includes(f.a.jar.get('__Host-erp-session')!)); db.close();
  f.advance(8*3600_000); assert.equal((await f.a.request('/api/me')).status, 401);
});
test('Web: challenge, RP, origin, user verification and signatures are enforced for registration and authentication', async t => {
  const f = await setup(t), grant = f.app.auth.bootstrap('甲');
  for (const bad of [{ uv:false }, { origin:'https://evil.test' }, { rp:'evil.test' }, { challenge:'wrong' }]) {
    const options = await f.a.request('/api/auth/register/options', { grant });
    assert.equal((await f.a.request('/api/auth/register/verify', { credential: new TestPasskey().register(options.value, bad) })).status, 401);
  }
  const { key } = await f.enroll(f.a, grant); await f.a.request('/api/logout', {});
  for (const bad of [{ uv:false }, { origin:'https://evil.test' }, { rp:'evil.test' }, { challenge:'wrong' }, { crossOrigin:true }]) {
    const options = await f.a.request('/api/auth/login/options', {}), response = key.assert(options.value, bad);
    assert.equal((await f.a.request('/api/auth/login/verify', { credential: response })).status, 401);
  }
  let options = await f.a.request('/api/auth/login/options', {}), response = key.assert(options.value);
  response.response.signature = Buffer.alloc(64).toString('base64url');
  assert.equal((await f.a.request('/api/auth/login/verify', { credential: response })).status, 401);
  options = await f.a.request('/api/auth/login/options', {}); response = key.assert(options.value);
  assert.equal((await f.client().request('/api/auth/login/verify', { credential: response })).status, 401); // browser binding
  assert.equal((await f.a.request('/api/auth/login/verify', { credential: response })).status, 200);
  assert.equal((await f.a.request('/api/auth/login/verify', { credential: response })).status, 401); // one use
  options = await f.a.request('/api/auth/login/options', {}); response = key.assert(options.value, { counter: 1 });
  assert.equal((await f.a.request('/api/auth/login/verify', { credential: response })).status, 401);
  options = await f.a.request('/api/auth/login/options', {}); response = key.assert(options.value); f.advance(300001);
  assert.equal((await f.a.request('/api/auth/login/verify', { credential: response })).status, 401);
});
test('Web: recent authentication, backup revocation, two equal operators and actor isolation', async t => {
  const f = await setup(t), { key } = await f.enroll(); const oldToken = f.a.jar.get('__Host-erp-session')!;
  f.advance(300001);
  assert.equal((await f.a.request('/api/admin/invite', { name:'乙' })).status, 403);
  assert.equal((await f.a.request('/api/admin/recovery-codes', {})).status, 403);
  assert.equal((await f.a.request('/api/auth/register/options', {})).status, 403);
  await f.login(f.a,key,'reauth'); assert.throws(() => f.app.auth.session(oldToken), /Sign in/);
  const invite = await f.a.request('/api/admin/invite',{name:'乙'}), b = f.client();
  await f.enroll(b, invite.value.grant);
  assert.equal((await b.request('/api/admin/invite',{name:'丙'})).status, 409);
  const action = { action:'propose',expectedVersion:0,command:{kind:'product',input:{name:'饮料',stockUnit:'瓶'}} };
  assert.equal((await f.a.request('/api/draft',{eventId:'p',action})).status,200);
  assert.equal((await b.request('/api/draft')).value,null);
  assert.equal((await b.request('/api/draft',{eventId:'c',action:{action:'confirm',expectedVersion:0}})).status,409);
  assert.equal((await b.request('/api/draft',{eventId:'p',action})).status,200);
  const posted = await b.request('/api/draft',{eventId:'c2',action:{action:'confirm',expectedVersion:1}});assert.equal(posted.status,200);
  assert.equal(f.app.erp.listAuditEvents().at(-1)!.actorId,(await b.request('/api/me')).value.user.id);
  const backup = new TestPasskey(), opts = await f.a.request('/api/auth/register/options',{});
  assert.equal((await f.a.request('/api/auth/register/verify',{credential:backup.register(opts.value)})).status,200);
  assert.equal((await f.a.request('/api/admin/remove-credential',{id:key.id.toString('base64url')})).status,200);
  assert.equal((await f.a.request('/api/me')).status,401);
  const revokedOpts = await f.a.request('/api/auth/login/options',{});
  assert.equal((await f.a.request('/api/auth/login/verify',{credential:key.assert(revokedOpts.value)})).status,401);
  await f.login(f.a,backup);
  assert.equal((await f.a.request('/api/admin/remove-credential',{id:backup.id.toString('base64url')})).status,409);
});
test('Web: recovery codes only allow replacement enrollment, consume once and revoke prior sessions/credentials', async t => {
  const f=await setup(t), { key,codes }=await f.enroll(), b=f.client();
  const results=await Promise.all([b.request('/api/auth/recover',{code:codes[0]}),f.client().request('/api/auth/recover',{code:codes[0]})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
  assert.equal((await f.a.request('/api/me')).status,401);
  assert.equal((await b.request('/api/overview')).status,401);
  const grant=results.find(r=>r.status===200)!.value.grant;
  const recovered=await f.enroll(b,grant); assert.equal(recovered.codes.length,8);
  assert.equal((await f.a.request('/api/auth/recover',{code:codes[1]})).status,401);
  const opts=await f.a.request('/api/auth/login/options',{});
  assert.equal((await f.a.request('/api/auth/login/verify',{credential:key.assert(opts.value)})).status,401);
  await f.login(f.a,recovered.key);
  assert.equal((await b.request('/api/admin/revoke-sessions',{})).status,200);
  assert.equal((await f.a.request('/api/me')).status,401);
  const abandoned=(await b.request('/api/auth/recover',{code:recovered.codes[0]})).value.grant;
  await f.login(f.a,recovered.key);
  assert.equal((await f.a.request('/api/admin/recovery-codes',{})).status,200);
  assert.equal((await b.request('/api/auth/register/options',{grant:abandoned})).status,401);
  assert.equal((await b.request('/api/auth/recover',{code:recovered.codes[1]})).status,401);
});
test('Web: origin, CSRF, strict request envelopes, draft mapping/idempotency, and static PWA shell', async t => {
  const f=await setup(t);await f.enroll();
  for(const url of ['/','/app.js','/style.css','/webauthn.js','/sw.js','/manifest.webmanifest','/icon.svg']) assert.equal((await f.a.request(url)).status,200,url);
  const forms=await f.a.request('/api/forms');assert.equal(Object.keys(forms.value).length,24);
  assert.match((await f.a.request('/sw.js')).value,/SHELL.includes/);
  assert.equal((await f.a.request('/api/draft',{}, {Origin:'https://evil.test'})).status,403);
  assert.equal((await f.a.request('/api/draft',{}, {Origin:''})).status,403);
  assert.equal((await f.a.request('/api/draft',{}, {'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.a.request('/api/overview',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await f.a.request('/api/draft',{eventId:'x',action:{action:'confirm'}})).status,400);
  assert.equal((await f.a.request('/api/draft',{eventId:'x',actorId:'forged',action:{action:'confirm',expectedVersion:0}})).status,400);
  const input={eventId:'create',action:{action:'propose',expectedVersion:0,command:{kind:'product',input:{name:'<script>alert(1)</script>',stockUnit:'瓶'}}}};
  const draft=await f.a.request('/api/draft',input);assert.equal(draft.status,200);assert.equal(f.app.erp.listMasters('product').length,0);
  const confirmation={eventId:'confirm',action:{action:'confirm',expectedVersion:1}};
  const post=await f.a.request('/api/draft',confirmation);assert.equal(post.status,200);
  assert.deepEqual((await f.a.request('/api/draft',confirmation)).value,post.value);
  assert.equal(f.app.erp.listMasters('product').length,1);
  assert.equal(f.app.erp.listAuditEvents().at(-1)!.channel,'web');
  assert.equal((await f.a.request('/api/draft',{eventId:'bad',action:{action:'propose',expectedVersion:1,command:{kind:'product',input:{name:'x',stockUnit:'瓶',balance:999}}}})).status,409);
  assert.equal((await f.a.request('/api/draft',{eventId:'method',action:{action:'propose',expectedVersion:1,command:{kind:'exec',input:{sql:'delete'}}}})).status,409);
  assert.equal((await f.a.request('/api/draft',{x:'a'.repeat(262145)})).status,413);
  const overview=await f.a.request('/api/overview');assert.equal(overview.headers.get('cache-control'),'no-store');
  assert.match(overview.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
});
test('Web: schema 9 upgrade and persistent credentials/sessions survive reopening', async t => {
  const f=await setup(t);const {key}=await f.enroll(); const token=f.a.jar.get('__Host-erp-session')!;
  const second=createErpWeb(f.path,origin,()=>f.now);try{assert.equal(second.auth.profile(token).user!.name,'甲');}finally{second.close();}
  const path=join(tmpdir(),`erp-migrate-${key.id.toString('hex')}.sqlite`);
  const old=createErpWeb(path,origin);old.close();const db=new DatabaseSync(path);
  db.exec('DROP TABLE hermes_events; DROP TABLE hermes_displays; DROP TABLE web_auth; DROP TABLE web_security_events; PRAGMA user_version=9;');db.close();
  const migrated=createErpWeb(path,origin);try{assert.ok(migrated.auth.bootstrap('迁移'));
    const check=new DatabaseSync(path);assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,11);check.close();
  }finally{migrated.close();rmSync(path,{force:true});}
});
test('Web: outstanding enrollment cannot survive issuer logout; concurrent invitation redemption respects operator cap', async t => {
  const f=await setup(t), {key}=await f.enroll();
  const invite=(await f.a.request('/api/admin/invite',{name:'乙'})).value.grant, b=f.client(), backup=new TestPasskey();
  const opts=await b.request('/api/auth/register/options',{grant:invite});
  await f.a.request('/api/logout',{});
  assert.equal((await b.request('/api/auth/register/verify',{credential:backup.register(opts.value)})).status,401);
  await f.login(f.a,key);
  const grant1=(await f.a.request('/api/admin/invite',{name:'乙'})).value.grant;
  const grant2=(await f.a.request('/api/admin/invite',{name:'丙'})).value.grant;
  const c=f.client(), k1=new TestPasskey(), k2=new TestPasskey();
  const o1=await b.request('/api/auth/register/options',{grant:grant1}), o2=await c.request('/api/auth/register/options',{grant:grant2});
  const results=await Promise.all([b.request('/api/auth/register/verify',{credential:k1.register(o1.value)}),c.request('/api/auth/register/verify',{credential:k2.register(o2.value)})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
test('Web: simultaneous assertion replay creates one session; rate limit bounds anonymous attempts', async t => {
  const f=await setup(t), {key}=await f.enroll(), b=f.client();
  const options=await b.request('/api/auth/login/options',{}), credential=key.assert(options.value);
  const replies=await Promise.all([b.request('/api/auth/login/verify',{credential}),b.request('/api/auth/login/verify',{credential})]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,401]);
  let status=0;
  for(let i=0;i<125;i++){status=(await b.request('/api/auth/recover',{code:'wrong'})).status;if(status===429)break;}
  assert.equal(status,429);f.advance(60_001);assert.equal((await b.request('/api/auth/recover',{code:'wrong'})).status,401);
});

test('Web: purchase can be reviewed and posted with no Hermes or model dependency', async t => {
  const f = await setup(t); await f.enroll();
  let version = 0;
  async function post(kind: string, input: unknown) {
    const eventId = `fallback-${kind}`;
    const draft = await f.a.request('/api/draft', { eventId, action: { action: 'propose', expectedVersion: version, command: { kind, input } } });
    assert.equal(draft.status, 200); assert.equal(draft.value.status, 'draft');
    version++;
    const action = { eventId: `${eventId}-confirm`, action: { action: 'confirm', expectedVersion: version } };
    const posted = await f.a.request('/api/draft', action);
    assert.equal(posted.status, 200); assert.equal(posted.value.status, 'posted');
    assert.deepEqual((await f.a.request('/api/draft', action)).value, posted.value);
    return posted.value.result;
  }
  const product = await post('product', { name: '断网测试饮料', stockUnit: '瓶' });
  const supplier = await post('supplier', { name: '断网测试供应商' });
  const warehouse = await post('warehouse', { name: '断网测试仓' });
  await post('purchase_receipt', { supplierId: supplier.id, warehouseId: warehouse.id,
    lines: [{ productId: product.id, unit: '瓶', quantity: '2', amountCents: '600' }] });
  assert.equal(f.app.erp.listPurchaseReceipts().length, 1);
  assert.equal(f.app.erp.getStock(product.id, warehouse.id).quantity.numerator, '2');
  assert.equal(f.app.erp.listOpenPayables()[0]!.openCents, '600');
  assert.equal(f.app.erp.listAuditEvents().at(-1)!.channel, 'web');
});
