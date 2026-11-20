import type { Params, PublicResult } from '../shared/bridge-contract.ts';
export interface CliCommand { namespace: 'daemon' | 'project' | 'discovery' | 'feature' | 'workspace' | 'environment' | 'profile' | 'execution' | 'scheduler' | 'review'; action: string; archive: string; requestId?: string; params?: Params; scope?: 'view'; projectId?: string; expectedRevision?: string; featureId?: string; discoveryId?: string; expectedStateRevision?: string; workspaceId?: string; jobId?: string; profileId?: string; executionTarget?: string|null;reviewTarget?:string }
export interface CorePort { call(command: CliCommand): Promise<PublicResult>; close(): void; cancelViewReads?(): Promise<void> }
export interface DialogPort { chooseDirectory(title: string): Promise<string | null>; chooseFile?(title: string): Promise<string | null>; confirmSelection?(message: string, detail: string): Promise<boolean> }
export interface Clock { now(): number }
