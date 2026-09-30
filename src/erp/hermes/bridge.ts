import { renderReply } from './presentation.ts';
import { createHash } from 'node:crypto';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { openDatabase } from '../database.ts';
import { ErpService, BusinessError, operationSchemas } from '../service.ts';
import type { DraftAction, DraftReply } from '../drafts.ts';

const text = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' });
const object = <T extends Record<string, TSchema>>(p: T) => Type.Object(p, { additionalProperties: false });
export const messageSchema = object({ accountId: text, senderId: text, chatId: text, messageId: text,
  text: Type.String({ minLength: 1, maxLength: 4000 }) });
export type WeixinMessage = Static<typeof messageSchema>;
export interface Binding { accountId: string; senderId: string; chatId: string; actorId: string }
const kinds = ['purchase_receipt', 'sales_order', 'delivery', 'delivery_and_receipt', 'settlement'] as const;
// Keep the same business validators, with a smaller conversational payload budget.
function bounded(schema: TSchema): TSchema {
  const result = Value.Clone(schema);
  function visit(v: any) { if (!v || typeof v !== 'object') return;
    if (v.type === 'array') v.maxItems = Math.min(v.maxItems ?? 5, 5);
    for (const child of Object.values(v)) visit(child);
  }
  visit(result); return result;
}
export const proposalSchema = Type.Union(kinds.map(kind => object({ kind: Type.Literal(kind), input: bounded(operationSchemas[kind]) })));
interface EventRecord {
  message: WeixinMessage; actorId: string; version: number; correction: boolean;
  createdAt: number;
  state: 'planning' | 'applying' | 'done'; action?: DraftAction; reply?: DraftReply;
  response?: { status: string; text: string; version?: number }; context?: unknown;
}
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Trusted gateway transport only. Neither identities nor confirmation tools are model inputs. */
export class HermesBridge {
  private db: ReturnType<typeof openDatabase>;
  private erp: ErpService;
  private bindings: Binding[];
  constructor(path: string, erp: ErpService, bindings: Binding[]) {
    if (!Value.Check(Type.Array(object({ accountId: text, senderId: text, chatId: text, actorId: text }), { minItems: 1, maxItems: 2 }), bindings) ||
      new Set(bindings.map(b => JSON.stringify([b.accountId, b.senderId, b.chatId]))).size !== bindings.length)
      throw new Error('Configure one or two unique Weixin operator bindings');
    this.bindings = structuredClone(bindings); this.erp = erp; this.db = openDatabase(path);
  }
  close() { this.db.close(); }
  private identity(raw: unknown) {
    if (!Value.Check(messageSchema, raw)) throw new BusinessError('invalid_input', 'Invalid Weixin text envelope');
    const m = raw as WeixinMessage;
    const binding = this.bindings.find(b => b.accountId === m.accountId && b.senderId === m.senderId && b.chatId === m.chatId);
    if (!binding) throw new BusinessError('invalid_input', 'Unbound Weixin operator');
    return { m, actorId: binding.actorId, scope: digest([m.accountId, m.senderId, m.chatId, binding.actorId]) };
  }
  private get(scope: string, id: string): EventRecord | undefined {
    const row = this.db.prepare('SELECT document FROM hermes_events WHERE scope=? AND event_id=?').get(scope, id);
    const record: EventRecord | undefined = row ? JSON.parse(String(row.document)) : undefined;
    if (record?.reply && record.response) record.response.text = renderReply(record.reply, this.erp);
    return record;
  }
  private save(scope: string, r: EventRecord) {
    this.db.prepare('INSERT INTO hermes_events VALUES (?, ?, ?) ON CONFLICT(scope,event_id) DO UPDATE SET document=excluded.document')
      .run(scope, r.message.messageId, JSON.stringify(r));
  }
  private done(scope: string, r: EventRecord, status: string, text: string) {
    r.state = 'done'; r.response = { status, text }; this.save(scope, r); return r.response;
  }
  private apply(scope: string, r: EventRecord) {
    // Persist exact action BEFORE crossing the draft transaction; crash recovery replays this action.
    r.state = 'applying'; this.save(scope, r);
    r.reply = this.erp.handleDraft({ actorId: r.actorId, channel: 'hermes', conversationId: scope, eventId: r.message.messageId }, r.action!);
    if (r.reply.status === 'draft' && Buffer.byteLength(JSON.stringify(r.reply.draft.summary)) > 24000) {
      this.erp.handleDraft({ actorId: r.actorId, channel: 'hermes', conversationId: scope,
        eventId: `oversize:${digest(r.message.messageId)}` }, { action: 'cancel', expectedVersion: r.reply.draft.version });
      r.reply = { status: 'rejected', reason: 'summary_too_large_use_web', nextAction: 'create_draft' };
    }
    r.state = 'done';
    const reply = r.reply;
    r.response = { status: reply.status, text: renderReply(reply, this.erp),
      ...(reply.status === 'draft' ? { version: reply.draft.version } : {}) };
    this.save(scope, r); return r.response;
  }
  prepare(raw: unknown): unknown {
    const { m, actorId, scope } = this.identity(raw), prior = this.get(scope, m.messageId);
    if (prior) {
      if (JSON.stringify(prior.message) !== JSON.stringify(m)) throw new BusinessError('idempotency_conflict', 'Message ID reused with different text');
      return prior.state === 'applying' ? this.apply(scope, prior) : prior.response ?? { status: 'planning', context: prior.context, schema: proposalSchema };
    }
    const draft = this.erp.currentDraft(actorId, 'hermes', scope);
    const r: EventRecord = { message: m, actorId, version: draft?.version ?? 0, correction: /^修改[:：]/.test(m.text.trim()), state: 'planning', createdAt: Date.now() };
    const outstanding = this.db.prepare("SELECT document FROM hermes_events WHERE scope=? AND json_extract(document, '$.state') != 'done'").all(scope)
      .map(row => JSON.parse(String(row.document)) as EventRecord);
    const interrupted = outstanding.find(e => e.state === 'applying');
    if (interrupted) {
      const recovered = this.apply(scope, interrupted);
      r.reply = interrupted.reply;
      r.state = 'done'; r.response = recovered; this.save(scope, r);
      return recovered;
    }
    for (const e of outstanding) if (e.state === 'planning' && Date.now() - e.createdAt > 60000)
      this.done(scope, e, 'rejected', '解析超时，未入账。请重新发送业务。');
    const pending = outstanding.some(e => e.state !== 'done');
    if (pending) return this.done(scope, r, 'rejected', '上一条消息仍在处理，请重试原消息或等待处理结果。');
    if (m.text.trim() === '查看草稿') {
      if (draft?.status !== 'pending') return this.done(scope, r, 'rejected', '没有待确认的草稿，请先描述要办理的业务。');
      r.reply = { status: 'draft', draft };
      r.state = 'done'; r.response = { status: 'draft', version: draft.version, text: renderReply(r.reply, this.erp) };
      this.save(scope, r); return r.response;
    }
    if (m.text.trim() === '确认') {
      const displayed = this.db.prepare('SELECT version FROM hermes_displays WHERE scope=?').get(scope);
      if (!draft || (draft.status !== 'posted' && (draft.status !== 'pending' || displayed?.version !== draft.version)))
        return this.done(scope, r, 'rejected', '没有已完整展示的待确认草稿，请先重新提案。');
      r.action = { action: 'confirm', expectedVersion: r.version }; return this.apply(scope, r);
    }
    if (m.text.trim() === '取消') { r.action = { action: 'cancel', expectedVersion: r.version }; return this.apply(scope, r); }
    if (draft?.status === 'pending' && !r.correction)
      return this.done(scope, r, 'rejected', '已有待确认草稿。请先确认或取消；修改当前草稿请以“修改：”开头。');
    if (r.correction && draft?.status !== 'pending') return this.done(scope, r, 'rejected', '没有可修改的待确认草稿，请提出新业务。');
    // A failed/uncertain correction must never leave the old version confirmable.
    this.db.prepare('DELETE FROM hermes_displays WHERE scope=?').run(scope);
    const query = m.text;
    const candidates = (kind: 'product' | 'supplier' | 'customer' | 'warehouse') => this.erp.listMasters(kind)
      .filter(p => query.includes(p.name) || query.includes(p.id)).slice(0, 10).map(p => ({ id: p.id, name: p.name, stockUnit: p.stockUnit }));
    r.context = { text: query, ...(r.correction ? { currentCommand: draft!.command } : {}),
      candidates: { products: candidates('product'), suppliers: candidates('supplier'), customers: candidates('customer'), warehouses: candidates('warehouse') },
      orders: this.erp.listSalesOrders().filter(o => query.includes(o.id)).slice(0, 5)
        .map(o => ({ id: o.id, revision: o.revision, customerId: o.customerId, warehouseId: o.warehouseId, lines: o.lines })),
      instructions: '只提取明确的业务字段。金额为分，数量为字符串。不得猜测ID、价格或单位。缺信息返回 null；不输出确认、余额、库存计算或原因推测。修改仅允许当前同类业务。' };
    this.save(scope, r); return { status: 'planning', context: r.context, schema: proposalSchema };
  }
  complete(raw: unknown, command: unknown): unknown {
    const { m, scope } = this.identity(raw), r = this.get(scope, m.messageId);
    if (!r || JSON.stringify(r.message) !== JSON.stringify(m)) throw new BusinessError('invalid_input', 'Unknown message');
    if (r.state !== 'planning') return r.state === 'applying' ? this.apply(scope, r) : r.response;
    if (!Value.Check(proposalSchema, command) || Buffer.byteLength(JSON.stringify(command)) > 16384)
      return this.done(scope, r, 'rejected', '字段不完整或模型暂不可用，未入账。请补充信息后重新发送；也可使用 Web。');
    const plan = command as { kind: string; input: unknown };
    const current = this.erp.currentDraft(r.actorId, 'hermes', scope);
    if (r.correction && plan.kind !== current?.command.kind)
      return this.done(scope, r, 'rejected', '修改不能换成另一类业务，请先取消当前草稿。');
    r.action = { action: 'propose', command: plan, expectedVersion: r.version }; return this.apply(scope, r);
  }
  displayed(raw: unknown) {
    const { m, scope, actorId } = this.identity(raw), r = this.get(scope, m.messageId);
    const draft = this.erp.currentDraft(actorId, 'hermes', scope);
    const newerCorrection = this.db.prepare(`SELECT 1 FROM hermes_events WHERE scope=? AND rowid >
      (SELECT rowid FROM hermes_events WHERE scope=? AND event_id=?) AND json_extract(document,'$.correction')=1 LIMIT 1`)
      .get(scope, scope, m.messageId);
    if (!newerCorrection && r?.reply?.status === 'draft' && draft?.status === 'pending' && r.reply.draft.version === draft.version)
      this.db.prepare('INSERT INTO hermes_displays VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET version=excluded.version').run(scope, draft.version);
    return { ok: true };
  }
}
