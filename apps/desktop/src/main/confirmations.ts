import { randomUUID, createHash } from 'node:crypto';
import { uuid } from '../shared/validation.ts';
import type { CliCommand } from './ports.ts';
export interface ConfirmationScope { owner: number; frame: number; epoch: number; archiveHandle: string; storeId: string | null }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
interface Token { command: CliCommand; scope: string; requestId: string; intentHash: string; expiresAt: number }
export class Confirmations {
  private tokens = new Map<string, Token>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  prepare(command: CliCommand, scope: ConfirmationScope, summary: string[]) {
    for (const [id, token] of this.tokens) if (token.expiresAt <= this.now()) this.tokens.delete(id);
    if (this.tokens.size >= 32) throw new Error('LOCAL_BUSY');
    const confirmationId = randomUUID(), requestId = randomUUID(), expiresAt = this.now() + 60_000;
    const original = structuredClone(command);
    const intentHash = createHash('sha256').update(canonical(original)).digest('hex');
    original.requestId = requestId;
    this.tokens.set(confirmationId, { command: original, scope: canonical(scope), requestId, intentHash, expiresAt });
    return { confirmationId, requestId, expiresAt, action: `${command.namespace}.${command.action}`, summary: [...summary] };
  }
  consume(id: string, scope: ConfirmationScope) {
    uuid(id); const token = this.tokens.get(id); this.tokens.delete(id);
    if (!token || token.expiresAt <= this.now() || token.scope !== canonical(scope)) throw new Error('CONFIRMATION_EXPIRED');
    return { command: structuredClone(token.command), requestId: token.requestId, intentHash: token.intentHash };
  }
  clear() { this.tokens.clear(); }
  cancel(id: string) { uuid(id); this.tokens.delete(id); }
}
interface ReceiptScope { archivePath: string; namespace: string; action: string; projectId: string | null; phase: string; outcome: string | null }
export function blocksMutation(receipts: readonly ReceiptScope[], path: string, namespace: string, action: string, projectId?: string) {
  return receipts.some(receipt => {
    if (receipt.archivePath !== path || receipt.phase === 'TERMINAL' || receipt.outcome === 'BLOCKED') return false;
    if (namespace === 'foundation') return receipt.namespace === 'foundation';
    if (receipt.namespace !== 'project') return false;
    return action === 'register' ? receipt.action === 'register' : projectId !== undefined && receipt.projectId === projectId;
  });
}
