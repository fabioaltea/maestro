import {FEATURE_BRIDGE_METHODS,validateFeatureBridge} from './feature-contract.ts';
import { CORE_ERRORS } from './core-errors.ts';
import { METHODS } from './bridge-contract.ts';
import type { BridgeRequest, Params } from './bridge-contract.ts';
import { DISCOVERY_BRIDGE_METHODS, validateDiscoveryBridge } from './discovery-contract.ts';
export function record(value: unknown): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('INVALID_INPUT');
  return value as Params;
}
export function keys(value: Params, allowed: readonly string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('INVALID_INPUT');
}
export function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.length || value.length > max || value.includes('\0')) throw new Error('INVALID_INPUT');
  return value;
}
export function uuid(value: unknown): string {
  const v = text(value, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new Error('INVALID_INPUT'); return v;
}
export function revision(value: unknown): string {
  const v = text(value, 20); if (!/^[1-9][0-9]*$/.test(v)) throw new Error('INVALID_INPUT'); return v;
}
// Client input convenience only: repository state, ownership and Git policy remain in the core.
export function projectName(value: unknown): string {
  const name = text(value, 256).trim().normalize('NFC');
  if (!name || !name.isWellFormed() || [...name].length > 120 || /\p{Cc}/u.test(name)) throw new Error('INVALID_NAME');
  return name;
}
export function localBranchInput(value: unknown): string {
  const name = text(value, 1024);
  if (!name.isWellFormed() || new TextEncoder().encode(name).byteLength > 1024 || /[\x00-\x20\x7f]/.test(name) || name.startsWith('-') || name.startsWith('refs/') || name.endsWith('.') || name === '@'
    || ['~', '^', ':', '?', '*', '[', '\\', '@{', '..'].some(token => name.includes(token)) || name.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) throw new Error('INVALID_BASE_BRANCH');
  return name;
}
export const ACTIONS = ['daemon.start', 'daemon.stop', 'daemon.restart', 'project.register', 'project.verify', 'project.update', 'project.remove'] as const;
export function validateAction(action: unknown, input: unknown): Params {
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) throw new Error('INVALID_INPUT');
  const p = record(input);
  if (String(action).startsWith('daemon.')) { keys(p, []); return p; }
  if (action === 'project.register') {
    keys(p, ['repositoryHandle', 'name', 'baseBranch']); uuid(p.repositoryHandle);
    if (p.name !== undefined) projectName(p.name); if (p.baseBranch !== undefined) localBranchInput(p.baseBranch); return p;
  }
  keys(p, action === 'project.verify' ? ['projectId'] : action === 'project.remove' ? ['projectId', 'expectedRevision'] : ['projectId', 'expectedRevision', 'patch']);
  uuid(p.projectId);
  if (action !== 'project.verify') revision(p.expectedRevision);
  if (action === 'project.update') {
    const patch = record(p.patch); keys(patch, ['name', 'baseBranch']); if (!Object.keys(patch).length) throw new Error('INVALID_INPUT');
    if (patch.name !== undefined) projectName(patch.name);
    if (patch.baseBranch !== undefined && patch.baseBranch !== null) localBranchInput(patch.baseBranch);
  }
  return p;
}
const extras: Record<string, readonly string[]> = {
  chooseArchive: ['newArchiveName'], listProjects: ['cursor', 'limit'], getProject: ['projectId'], prepareAction: ['action', 'params'],
  confirmAction: ['confirmationId'], cancelAction: ['confirmationId'], reconcileOperation: ['receiptId'], dismissReceipt: ['receiptId'], selectReceiptArchive: ['receiptId'],
  readEvents: ['after', 'limit'], startEvents: ['afterApplied'], stopEvents: ['subscriptionId'], ackEvents: ['subscriptionId', 'batchId', 'lastAppliedSeq'],
};
export function validateRequest(method: string, input: unknown): BridgeRequest {
  if (!(METHODS as readonly string[]).includes(method)) throw new Error('INVALID_INPUT');
  const p = record(input);
  if ((FEATURE_BRIDGE_METHODS as readonly string[]).includes(method)) validateFeatureBridge(method,p);
  else if ((DISCOVERY_BRIDGE_METHODS as readonly string[]).includes(method)) validateDiscoveryBridge(method, p);
  else keys(p, ['bridgeVersion', 'callId', 'selectionEpoch', ...(extras[method] ?? [])]);
  if (p.bridgeVersion !== 1 || !Number.isSafeInteger(p.selectionEpoch) || Number(p.selectionEpoch) < 0) throw new Error('INVALID_INPUT');
  uuid(p.callId);
  for (const name of ['projectId', 'confirmationId', 'receiptId', 'subscriptionId', 'batchId']) if ((extras[method] ?? []).includes(name)) uuid(p[name]);
  for (const name of ['cursor', 'after', 'afterApplied']) if (p[name] !== undefined) text(p[name], 2048);
  if (method === 'listProjects' && p.limit !== undefined && p.limit !== 25) throw new Error('INVALID_INPUT');
  if (method === 'readEvents' && p.limit !== undefined && (!Number.isInteger(p.limit) || Number(p.limit) < 1 || Number(p.limit) > 100)) throw new Error('INVALID_INPUT');
  if (method === 'ackEvents' && !/^(0|[1-9][0-9]*)$/.test(text(p.lastAppliedSeq, 20))) throw new Error('INVALID_INPUT');
  if (method === 'chooseArchive' && p.newArchiveName !== undefined && !/^[\p{L}\p{N}_-][\p{L}\p{N} ._-]{0,79}$/u.test(text(p.newArchiveName, 80))) throw new Error('INVALID_INPUT');
  if (method === 'prepareAction') validateAction(p.action, p.params);
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > (method === 'ackEvents' ? 1024 : 32768)) throw new Error('INVALID_INPUT');
  return p as BridgeRequest;
}
export function validateSender(sender: {webContentsId: number; frameId: number; mainFrame: boolean; url: string}, owner: {webContentsId: number; frameId: number}) {
  if (sender.webContentsId !== owner.webContentsId || sender.frameId !== owner.frameId || !sender.mainFrame || !sender.url.startsWith('maestro://app/')) throw new Error('INVALID_INPUT');
  const url = new URL(sender.url);
  if (url.protocol !== 'maestro:' || url.host !== 'app' || url.username || url.password) throw new Error('INVALID_INPUT');
}
export function safeError(code: string) {
  const messages: Record<string, string> = {
    ARCHIVE_IS_REPOSITORY: 'Hai scelto un repository Git. Apri o configura un archivio Maestro, poi usa Progetti → Importa progetto.',
    CLIENT_READ_CANCELLED: 'Lettura della vista precedente interrotta.', INVALID_INPUT: 'Richiesta non valida.', STALE_CONTEXT: 'Archivio cambiato. Aggiorna la vista.', LOCAL_BUSY: 'Il client è occupato. Attendi e aggiorna.',
    RUNTIME_UNAVAILABLE: 'Runtime Node supportato non disponibile.', BUILD_UNAVAILABLE: 'Compila il core prima di aprire Maestro.',
    CLIENT_PROTOCOL_ERROR: 'Risposta del client non valida.', CLIENT_OUTPUT_LIMIT: 'La risposta supera il limite del client.',
    CONFIRMATION_REQUIRED: 'Conferma esplicita richiesta.', CONFIRMATION_EXPIRED: 'Conferma scaduta. Rivedi il riepilogo.',
    RECEIPT_STORAGE_UNAVAILABLE: 'Impossibile conservare l’identità dell’operazione.', RECEIPT_LIMIT: 'Archivio ricevute pieno. Rivedi gli esiti terminali.',
    OPERATION_UNCERTAIN: 'Esito incerto. Interroga l’operazione originale.', STREAM_SATURATED: 'Vista attività satura. Riconnetti esplicitamente.', STREAM_GAP: 'Continuità degli eventi interrotta.',
  };
  if (Object.hasOwn(CORE_ERRORS, code)) return CORE_ERRORS[code as keyof typeof CORE_ERRORS];
  const valid = Object.hasOwn(messages, code) ? code : 'CLIENT_PROTOCOL_ERROR';
  return { code: valid, message: messages[valid]!, nextAction: 'Aggiorna lo stato o consulta la diagnostica.' };
}
