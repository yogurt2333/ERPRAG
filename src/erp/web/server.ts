import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ErpService, BusinessError, operationSchemas } from '../service.ts';
import { WebAuth, WebError, SESSION_SECONDS } from './auth.ts';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
const text = Type.String({ minLength: 1, maxLength: 200 });
const object = (properties: Record<string, import('@sinclair/typebox').TSchema>) => Type.Object(properties, { additionalProperties: false });
function check(schema: import('@sinclair/typebox').TSchema, value: unknown) {
  if (!Value.Check(schema, value)) throw new WebError(400, 'Invalid request');
}
function cookie(req: IncomingMessage, name: string) {
  const values = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : '';
}
function setCookie(res: ServerResponse, name: string, value: string, seconds: number) {
  const previous = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous.map(String) : previous ? [String(previous)] : []),
    `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`]);
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new WebError(415, 'JSON required');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 262144) throw new WebError(413, 'Request too large'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; }
  catch { throw new WebError(400, 'Invalid JSON object'); }
}
const assets: Record<string, [URL, string]> = {
  '/': [new URL('./public/index.html', import.meta.url), 'text/html; charset=utf-8'],
  '/app.js': [new URL('./public/app.js', import.meta.url), 'text/javascript; charset=utf-8'],
  '/style.css': [new URL('./public/style.css', import.meta.url), 'text/css; charset=utf-8'],
  '/sw.js': [new URL('./public/sw.js', import.meta.url), 'text/javascript; charset=utf-8'],
  '/icon.svg': [new URL('./public/icon.svg', import.meta.url), 'image/svg+xml'],
  '/manifest.webmanifest': [new URL('./public/manifest.webmanifest', import.meta.url), 'application/manifest+json'],
  '/webauthn.js': [new URL('../../../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', import.meta.url), 'text/javascript'],
};
/** HTTPS terminates at a local reverse proxy. Never trust forwarded identity/host headers. */
export function createErpWeb(path: string, origin: string, clock = Date.now) {
  const erp = new ErpService(path), auth = new WebAuth(path, origin, clock);
  const rates = new Map<string, { until: number; count: number }>();
  let verifying = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url ?? '/', origin), route = url.pathname;
      if (req.method === 'GET' && assets[route]) {
        const [file, type] = assets[route]; res.setHeader('Content-Type', type); res.end(readFileSync(file)); return;
      }
      if (!route.startsWith('/api/')) throw new WebError(404, 'Not found');
      if (url.search) throw new WebError(400, 'Unexpected query parameters');
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw new WebError(403, 'Same-origin request required');
      if (req.method !== 'GET' && req.method !== 'POST') throw new WebError(405, 'Method not allowed');
      if ((req.method === 'POST' || req.headers.origin) && req.headers.origin !== origin) throw new WebError(403, 'Origin rejected');
      const sessionToken = cookie(req, '__Host-erp-session'), flow = cookie(req, '__Host-erp-flow');
      if (req.method === 'POST') {
        const now = clock();
        for (const [key, value] of rates) if (value.until <= now) rates.delete(key);
        const key = req.socket.remoteAddress ?? 'local', rate = rates.get(key) ?? { until: now + 60_000, count: 0 };
        if (rates.size >= 1000 && !rates.has(key)) throw new WebError(429, 'Retry later');
        rates.set(key, rate); if (++rate.count > 120) throw new WebError(429, 'Retry later');
      }
      if (req.method === 'POST' && route.startsWith('/api/auth/')) {
        const b = await body(req);
        if (route === '/api/auth/register/options') {
          check(object({ grant: Type.Optional(text) }), b);
          const result = await auth.registrationOptions(b.grant as string | undefined, sessionToken);
          setCookie(res, '__Host-erp-flow', result.flow, 300); json(result.options); return;
        }
        if (route === '/api/auth/login/options' || route === '/api/auth/reauth/options') {
          check(object({}), b); const result = await auth.loginOptions(sessionToken, route.includes('/reauth/'));
          setCookie(res, '__Host-erp-flow', result.flow, 300); json(result.options); return;
        }
        if (['/api/auth/register/verify', '/api/auth/login/verify', '/api/auth/reauth/verify'].includes(route)) {
          check(object({ credential: Type.Object({ id: text, response: Type.Object({}, { additionalProperties: true }) }, { additionalProperties: true }) }), b);
          if (verifying >= 4) throw new WebError(429, 'Retry later');
          verifying++;
          try {
            let value: string, codes: string[] | undefined;
            if (route.includes('/register/')) { const result = await auth.register(flow, b.credential as RegistrationResponseJSON, sessionToken); value = result.sessionToken; codes = result.recoveryCodes; }
            else value = await auth.login(flow, b.credential as AuthenticationResponseJSON, sessionToken, route.includes('/reauth/'));
            setCookie(res, '__Host-erp-session', value, SESSION_SECONDS); setCookie(res, '__Host-erp-flow', '', 0);
            json({ ok: true, recoveryCodes: codes }); return;
          } finally { verifying--; }
        }
        if (route === '/api/auth/recover') { check(object({ code: text }), b); json({ grant: auth.recover(b.code as string) }); return; }
        throw new WebError(404, 'Not found');
      }
      const session = auth.session(sessionToken);
      if (req.method === 'GET') {
        switch (route) {
          case '/api/me': json(auth.profile(sessionToken)); return;
          case '/api/forms': json(operationSchemas); return;
          case '/api/draft': json(erp.currentWebDraft(session.user, 'workspace')); return;
          case '/api/overview': {
            const products = erp.listMasters('product'), warehouses = erp.listMasters('warehouse');
            json({ products: products.map(p => ({ ...erp.getProduct(p.id), packs: erp.listPackVersions(p.id) })), warehouses,
              customers: erp.listMasters('customer'), suppliers: erp.listMasters('supplier'),
              stock: products.flatMap(p => warehouses.map(w => erp.getStock(p.id, w.id))),
              purchases: erp.listPurchaseReceipts(), orders: erp.listSalesOrders(), deliveries: erp.listDeliveries(),
              payables: erp.listOpenPayables(), receivables: erp.listOpenReceivables(), settlements: erp.listSettlements(),
              returns: erp.listReturns(), quarantines: erp.listQuarantinedReturns(), refunds: erp.listReturnRefunds(),
              stocktakes: erp.listStocktakes(), inventory: erp.listInventoryOperations(),
              followups: erp.listFollowups(), expiry: erp.listManagedExpiry(), audit: erp.listAuditEvents(),
              security: auth.securityHistory(sessionToken) }); return;
          }
          default: throw new WebError(404, 'Not found');
        }
      }
      const b = await body(req);
      auth.session(sessionToken); // A slow upload may outlive or race revocation of its session.
      switch (route) {
        case '/api/draft': {
          check(object({ eventId: text, action: Type.Unknown() }), b);
          const action = b.action as import('../drafts.ts').DraftAction;
          if (!action || typeof action !== 'object' || !Number.isSafeInteger(action.expectedVersion) || action.expectedVersion! < 0)
            throw new WebError(400, 'Reviewed draft version required');
          const reply = erp.handleDraft({ actorId: session.user, channel: 'web', conversationId: 'workspace', eventId: b.eventId as string }, action);
          json(reply, reply.status === 'rejected' ? 409 : 200); return;
        }
        case '/api/logout': check(object({}), b); auth.logout(sessionToken); setCookie(res, '__Host-erp-session', '', 0); json({ ok: true }); return;
        case '/api/admin/invite': check(object({ name: text }), b); json({ grant: auth.invite(sessionToken, b.name as string) }); return;
        case '/api/admin/recovery-codes': check(object({}), b); json({ recoveryCodes: auth.rotateCodes(sessionToken) }); return;
        case '/api/admin/revoke-sessions': check(object({}), b); auth.revokeSessions(sessionToken); setCookie(res, '__Host-erp-session', '', 0); json({ ok: true }); return;
        case '/api/admin/remove-credential': check(object({ id: text }), b); auth.removeCredential(sessionToken, b.id as string); setCookie(res, '__Host-erp-session', '', 0); json({ ok: true }); return;
        default: throw new WebError(404, 'Not found');
      }
    } catch (e) {
      if (e instanceof WebError) json({ error: e.message }, e.status);
      else if (e instanceof BusinessError) json({ error: e.code, message: e.message }, e.code === 'invalid_input' ? 400 : e.code === 'not_found' ? 404 : e.code === 'busy' ? 503 : 409);
      else json({ error: 'Internal server error' }, 500);
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  return { server, erp, auth, close() { server.close(); erp.close(); auth.close(); } };
}
