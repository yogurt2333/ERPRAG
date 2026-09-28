import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { DatabaseSync } from 'node:sqlite';
import { BusinessError, type Confirmation } from './service.ts';

export interface DraftContext { actorId: string; channel: Confirmation['channel']; conversationId: string; eventId: string }
export interface DraftCommand { kind: string; input: unknown }
export interface OperationDraft {
  version: number; operationId: string; status: 'pending' | 'posted' | 'cancelled' | 'invalidated';
  command: DraftCommand; baseline: string; summary: unknown; result?: unknown;
}
export type DraftReply = { status: 'draft'; draft: OperationDraft } | { status: 'posted'; version: number; result: unknown }
  | { status: 'cancelled'; version: number } | { status: 'rejected'; reason: string; nextAction: 'review_latest' | 'create_draft' };
export type DraftAction = { action: 'propose'; command: DraftCommand; expectedVersion?: number }
  | { action: 'confirm' | 'cancel'; expectedVersion?: number };
const expectedVersion = Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const actionSchema = Type.Union([
  Type.Object({ action: Type.Literal('propose'), expectedVersion,
    command: Type.Object({ kind: Type.String({ minLength: 1, maxLength: 80 }), input: Type.Unknown() }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Union([Type.Literal('confirm'), Type.Literal('cancel')]), expectedVersion }, { additionalProperties: false }),
]);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value)!;
}
/** Durable protocol; clients supply structured corrections, never executable method names. */
export class DraftStore {
  private db: DatabaseSync;
  private execute: (command: DraftCommand, context: Confirmation) => unknown;
  private snapshot: () => Record<string, unknown[]>;
  private beforeCommit: () => void;
  private clock: () => Date;
  constructor(db: DatabaseSync, execute: (command: DraftCommand, context: Confirmation) => unknown,
    snapshot: () => Record<string, unknown[]>, beforeCommit: () => void, clock: () => Date) {
    this.db = db; this.execute = execute; this.snapshot = snapshot; this.beforeCommit = beforeCommit; this.clock = clock;
  }
  current(scope: string): OperationDraft | undefined {
    const row = this.db.prepare('SELECT document FROM operation_drafts WHERE scope = ? ORDER BY version DESC LIMIT 1').get(scope);
    return row ? JSON.parse(row.document as string) : undefined;
  }
  baseline(): string {
    // Posted operations are append-only; also invalidate defaults when the UTC business date changes.
    return canonical({ date: this.clock().toISOString().slice(0, 10),
      revision: this.db.prepare('SELECT MAX(rowid) AS revision FROM operations').get()!.revision });
  }
  handle(context: DraftContext, action: DraftAction): DraftReply {
    if (!context || !['cli', 'web', 'hermes'].includes(context.channel) ||
      [context.actorId, context.conversationId, context.eventId].some(v => typeof v !== 'string' || !v.trim() || v.length > 200) ||
      !Value.Check(actionSchema, action) ||
      (action.expectedVersion !== undefined && (!Number.isSafeInteger(action.expectedVersion) || action.expectedVersion < 0)))
      throw new BusinessError('invalid_input', 'Invalid draft context or action');
    const scope = canonical([context.actorId, context.channel, context.conversationId]);
    const request = canonical(action);
    if (Buffer.byteLength(request) > 262144) throw new BusinessError('invalid_input', 'Draft exceeds 256 KiB input limit');
    const reject = (reason: string, nextAction: 'review_latest' | 'create_draft' = 'review_latest'): DraftReply => ({ status: 'rejected', reason, nextAction });
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const prior = this.db.prepare('SELECT request, result FROM draft_events WHERE scope = ? AND event_id = ?').get(scope, context.eventId);
      if (prior) {
        if (prior.request !== request) throw new BusinessError('idempotency_conflict', 'Event ID reused with different content');
        this.db.exec('COMMIT'); return JSON.parse(prior.result as string);
      }
      let draft = this.current(scope), reply: DraftReply;
      const save = () => this.db.prepare('INSERT OR REPLACE INTO operation_drafts VALUES (?, ?, ?)').run(scope, draft!.version, JSON.stringify(draft));
      if (action.expectedVersion !== undefined && action.expectedVersion !== (draft?.version ?? 0)) reply = reject('stale_version');
      else if (action.action === 'propose') {
        // Replacing a proposal requires the version the caller actually reviewed.
        if (draft && action.expectedVersion === undefined) reply = reject('expected_version_required');
        else {
          const operationId = randomUUID(), baseline = this.baseline();
          const confirmation: Confirmation = { operationId, actorId: context.actorId, channel: context.channel,
            confirmationId: context.eventId, confirmed: true };
          this.db.exec('SAVEPOINT draft_preview');
          try {
            const before = this.snapshot();
            const projection = this.execute(action.command, confirmation);
            const after = this.snapshot();
            draft = { version: (draft?.version ?? 0) + 1, operationId, status: 'pending', command: action.command, baseline,
              summary: { projection, ...impact(before, after, action.command, projection), validationFindings: [] } };
            reply = { status: 'draft', draft };
          } catch (error) {
            if (!(error instanceof BusinessError)) throw error;
            reply = reject(error.code + ': ' + error.message);
            // A failed correction must not leave the old proposal confirmable.
            if (draft?.status === 'pending') draft.status = 'invalidated';
          } finally { this.db.exec('ROLLBACK TO draft_preview; RELEASE draft_preview'); }
          if (draft) save();
        }
      } else if (!draft) reply = reject('no_current_draft', 'create_draft');
      else if (action.action === 'cancel') {
        if (draft.status === 'posted') reply = reject('already_posted');
        else { draft.status = 'cancelled'; save(); reply = { status: 'cancelled', version: draft.version }; }
      } else if (draft.status === 'posted') reply = { status: 'posted', version: draft.version, result: draft.result };
      else if (draft.status !== 'pending') reply = reject(draft.status, 'create_draft');
      else if (draft.baseline !== this.baseline()) {
        draft.status = 'invalidated'; save(); reply = reject('business_state_changed', 'create_draft');
      } else {
        this.db.exec('SAVEPOINT draft_post');
        try {
          const result = this.execute(draft.command, { operationId: draft.operationId, actorId: context.actorId,
            channel: context.channel, confirmationId: context.eventId, confirmed: true });
          const audit = this.db.prepare('SELECT evidence FROM audit_events WHERE operation_id = ?').get(draft.operationId)!;
          this.db.prepare('UPDATE audit_events SET evidence = ? WHERE operation_id = ?').run(JSON.stringify({
            ...JSON.parse(audit.evidence as string), draftVersion: draft.version, conversationId: context.conversationId,
          }), draft.operationId);
          draft.status = 'posted'; draft.result = result;
          reply = { status: 'posted', version: draft.version, result };
          this.db.exec('RELEASE draft_post');
        } catch (error) {
          this.db.exec('ROLLBACK TO draft_post; RELEASE draft_post');
          if (!(error instanceof BusinessError)) throw error;
          draft.status = 'invalidated'; reply = reject(error.code + ': ' + error.message, 'create_draft');
        }
        save();
      }
      this.db.prepare('INSERT INTO draft_events VALUES (?, ?, ?, ?)').run(scope, context.eventId, request, JSON.stringify(reply));
      this.beforeCommit(); this.db.exec('COMMIT'); return reply;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (error && typeof error === 'object' && 'errcode' in error && [5, 6].includes(Number(error.errcode) & 255))
        throw new BusinessError('busy', 'Retry the same draft event');
      throw error;
    }
  }
}

function impact(before: Record<string, unknown[]>, after: Record<string, unknown[]>, command: DraftCommand, projection: unknown) {
  const references = canonical({ command, projection });
  const changes: Record<string, { before: unknown[]; after: unknown[] }> = {};
  for (const key of Object.keys(before)) {
    const old = before[key]!, next = after[key]!;
    if (['products', 'warehouses', 'counterparties'].includes(key)) {
      const related = (row: unknown) => references.includes(JSON.stringify((row as { id: string }).id));
      changes[key] = { before: old.filter(related), after: next.filter(related) };
    } else {
      const oldSet = new Set(old.map(canonical)), nextSet = new Set(next.map(canonical));
      changes[key] = { before: old.filter(row => !nextSet.has(canonical(row))), after: next.filter(row => !oldSet.has(canonical(row))) };
    }
  }
  return { changes };
}
