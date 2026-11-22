import { record, text, uuid, revision } from '../../shared/validation.ts';
import type { Params } from '../../shared/bridge-contract.ts';
export interface Observation extends Params {
  freshness: 'LAST_KNOWN'; completedAt: string; trackedChanges: boolean | null; untrackedChanges: boolean | null; conflicts: boolean | null;
}
export interface Project {
  projectId: string; displayName: string; referenceCheckout: string; baseBranch: string | null; baseState: string;
  configRevision: string; createdAt: string; updatedAt: string; observation: Observation | null;
}
export function decodeProject(value: unknown): Project {
  const p = record(value); uuid(p.projectId); text(p.displayName, 256); text(p.referenceCheckout, 4096); revision(p.configRevision);
  if (p.baseBranch !== null) text(p.baseBranch);
  if (typeof p.baseState !== 'string' || typeof p.createdAt !== 'string' || typeof p.updatedAt !== 'string') throw new Error('CLIENT_PROTOCOL_ERROR');
  if (p.observation !== null) {
    const o = record(p.observation);
    if (o.freshness !== 'LAST_KNOWN' || typeof o.completedAt !== 'string') throw new Error('CLIENT_PROTOCOL_ERROR');
    for (const flag of ['trackedChanges', 'untrackedChanges', 'conflicts']) if (o[flag] !== null && typeof o[flag] !== 'boolean') throw new Error('CLIENT_PROTOCOL_ERROR');
  }
  return { projectId: p.projectId as string, displayName: p.displayName as string, referenceCheckout: p.referenceCheckout as string, baseBranch: p.baseBranch as string | null,
    baseState: p.baseState, configRevision: p.configRevision as string, createdAt: p.createdAt, updatedAt: p.updatedAt, observation: p.observation as Observation | null };
}
export interface ProjectView { epoch: number; storeId: string | null; projects: Project[]; cursor: string | null; detail: Project | null; notice: string | null }
export const initialProjectView: ProjectView = { epoch: 0, storeId: null, projects: [], cursor: null, detail: null, notice: null };
export type ProjectEvent = { type: 'context'; epoch: number; storeId: string | null } | { type: 'page'; epoch: number; projects: Project[]; cursor: string | null } | { type: 'detail'; epoch: number; project: Project | null } | { type: 'invalidated'; epoch: number };
export function projectViewReducer(state: ProjectView, event: ProjectEvent): ProjectView {
  if (event.type === 'context') return { ...initialProjectView, epoch: event.epoch, storeId: event.storeId };
  if (event.epoch !== state.epoch) return state;
  if (event.type === 'page') return { ...state, projects: event.projects.slice(0, 100), cursor: event.cursor, notice: null };
  if (event.type === 'detail') return { ...state, detail: event.project };
  return { ...state, projects: [], cursor: null, detail: null, notice: 'Registro cambiato. Rileggi la prima pagina.' };
}
