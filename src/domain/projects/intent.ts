import { requireUuid } from '../identifiers.js';
import { normalizeProjectName, requireProjectRevision, type ProjectAction } from './model.js';

export interface ProjectPatch { readonly name?: string; readonly baseBranch?: string | null }
export interface RegisterParams { readonly path: string; readonly name?: string; readonly baseBranch?: string }
export interface VerifyParams { readonly projectId: string }
export interface UpdateParams extends VerifyParams { readonly expectedRevision: string; readonly patch: ProjectPatch }
export interface RemoveParams extends VerifyParams { readonly expectedRevision: string }
export type ProjectIntent = { readonly version: 1; readonly scope: 'PROJECT'; readonly storeId: string } & (
  { readonly action: 'REGISTER'; readonly params: RegisterParams }
  | { readonly action: 'VERIFY'; readonly params: VerifyParams }
  | { readonly action: 'UPDATE'; readonly params: UpdateParams }
  | { readonly action: 'REMOVE'; readonly params: RemoveParams }
);

export function projectObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST');
  return value as Record<string, unknown>;
}
export function requireProjectFields(value: Readonly<Record<string, unknown>>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error('INVALID_REQUEST');
}
export function requireProjectPath(value: unknown): string {
  if (typeof value !== 'string' || !value.isWellFormed() || !value.startsWith('/') || value.includes('\0')
    || new TextEncoder().encode(value).byteLength > 16 * 1024) throw new Error('INVALID_REQUEST');
  return value;
}
export function requireLocalBranch(value: unknown): string {
  if (typeof value !== 'string' || !value.isWellFormed() || !value || new TextEncoder().encode(value).byteLength > 1024
    || /[\x00-\x20\x7f]/.test(value) || value.startsWith('-') || value.startsWith('refs/') || value.endsWith('.') || value === '@'
    || ['~', '^', ':', '?', '*', '[', '\\', '@{', '..'].some(token => value.includes(token))
    || value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) throw new Error('INVALID_BASE_BRANCH');
  return value;
}
export function normalizeProjectIntent(storeId: string, action: ProjectAction, input: unknown): ProjectIntent {
  let normalizedStore: string;
  try { normalizedStore = requireUuid(storeId); } catch { throw new Error('INVALID_REQUEST'); }
  const p = projectObject(input);
  const head = { version: 1 as const, scope: 'PROJECT' as const, storeId: normalizedStore };
  if (action === 'REGISTER') {
    requireProjectFields(p, ['path'], ['name', 'baseBranch']);
    return { ...head, action, params: { path: requireProjectPath(p.path),
      ...(Object.hasOwn(p, 'name') ? { name: normalizeProjectName(p.name) } : {}),
      ...(Object.hasOwn(p, 'baseBranch') ? { baseBranch: requireLocalBranch(p.baseBranch) } : {}) } };
  }
  if (action !== 'VERIFY' && action !== 'UPDATE' && action !== 'REMOVE') throw new Error('INVALID_REQUEST');
  requireProjectFields(p, action === 'VERIFY' ? ['projectId'] : action === 'REMOVE'
    ? ['projectId', 'expectedRevision'] : ['projectId', 'expectedRevision', 'patch']);
  let projectId: string;
  try { projectId = requireUuid(p.projectId); } catch { throw new Error('INVALID_REQUEST'); }
  if (action === 'VERIFY') return { ...head, action, params: { projectId } };
  const expectedRevision = requireProjectRevision(p.expectedRevision);
  if (action === 'REMOVE') return { ...head, action, params: { projectId, expectedRevision } };
  const patch = projectObject(p.patch);
  requireProjectFields(patch, [], ['name', 'baseBranch']);
  if (Object.keys(patch).length === 0) throw new Error('INVALID_REQUEST');
  return { ...head, action, params: { projectId, expectedRevision, patch: {
    ...(Object.hasOwn(patch, 'name') ? { name: normalizeProjectName(patch.name) } : {}),
    ...(Object.hasOwn(patch, 'baseBranch') ? { baseBranch: patch.baseBranch === null ? null : requireLocalBranch(patch.baseBranch) } : {}),
  } } };
}
/** Fixed field order, original omissions, no filesystem, Git, clock or generated defaults. */
export function canonicalProjectIntent(storeId: string, action: ProjectAction, params: unknown): string {
  return JSON.stringify(normalizeProjectIntent(storeId, action, params));
}
