import { renderNotification } from './presentation.ts';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { HermesBridge, type Binding } from './bridge.ts';
import { BusinessError, type ErpService } from '../service.ts';
import type { NotificationEvent } from '../followups.ts';

function notification(event: NotificationEvent) {
  return { id: event.id, kind: event.kind, text: renderNotification(event) };
}

/** Dedicated loopback socket, shared ERP service; never mount under the public reverse proxy. */
export function createHermesServer(path: string, erp: ErpService, token: string, bindings: Binding[], notificationTarget: Binding) {
  if (token.length < 32) throw new Error('ERP_HERMES_TOKEN requires at least 32 characters');
  if (!bindings.some(b => JSON.stringify(b) === JSON.stringify(notificationTarget))) throw new Error('Notification target must be bound');
  const bridge = new HermesBridge(path, erp, bindings);
  const server = createServer(async (req, res) => {
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const auth = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
      if (req.headers.origin || auth.length !== expected.length || !timingSafeEqual(auth, expected)) { json({ error: 'Unauthorized' }, 401); return; }
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') { json({ error: 'JSON POST required' }, 400); return; }
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { size += chunk.length; if (size > 32768) { json({ error: 'Too large' }, 413); return; } chunks.push(chunk); }
      let body: any;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json({ error: 'Invalid JSON' }, 400); return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { json({ error: 'Object required' }, 400); return; }
      switch (req.url) {
        case '/prepare': json(bridge.prepare(body)); return;
        case '/complete': {
          if (Object.keys(body).some(k => !['message', 'command'].includes(k))) throw new BusinessError('invalid_input', 'Unknown fields');
          json(bridge.complete(body.message, body.command)); return;
        }
        case '/displayed': json(bridge.displayed(body)); return;
        case '/notifications':
          erp.runScheduler(); json({ target: notificationTarget, events: erp.pendingNotifications().slice(0, 10).map(notification) }); return;
        case '/ack':
          if (typeof body.id !== 'string' || body.id.length > 500) throw new BusinessError('invalid_input', 'Notification ID required');
          erp.acknowledgeNotification(body.id); json({ ok: true }); return;
        default: json({ error: 'Not found' }, 404);
      }
    } catch (e) {
      if (e instanceof BusinessError) json({ error: e.code }, e.code === 'busy' ? 503 : 409);
      else json({ error: 'Bridge unavailable; retry original event' }, 503);
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, close() { server.close(); bridge.close(); } };
}
