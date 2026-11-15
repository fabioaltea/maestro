import type { Params, PublicResult } from '../shared/bridge-contract.ts';
export interface CliCommand { namespace: 'daemon' | 'project'; action: string; archive: string; requestId?: string; params?: Params }
export interface CorePort { call(command: CliCommand): Promise<PublicResult>; close(): void }
export interface DialogPort { chooseDirectory(title: string): Promise<string | null>; confirmSelection?(message: string, detail: string): Promise<boolean> }
export interface Clock { now(): number }
