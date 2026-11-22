import type { ArchitectResult } from '../domain/discovery/documents.js';
import type { DiscoveryAnswer, DiscoveryFailure, DiscoveryResult } from '../domain/discovery/model.js';

export interface ProviderConfiguration {
  readonly providerId: string; readonly revision: string; readonly binaryRealpath: string; readonly binarySha256: string;
  readonly binaryVersion: string; readonly modelId: string; readonly authProfileRef: string;
  readonly policyVersion: string; readonly qualificationDigest: string; readonly configuredAt: string;
}
export interface ProviderCapabilities {
  readonly readOnlyAnalysis: boolean; readonly portableTurns: boolean; readonly nativeResume: boolean;
  readonly localCancellation: boolean; readonly verifiedRemoteCancellation: boolean; readonly quotaResetInfo: boolean;
}
export interface ProviderAvailability {
  readonly state: 'NOT_CONFIGURED' | 'AUTH_REQUIRED' | 'UNSUPPORTED' | 'UNSAFE' | 'AVAILABLE';
  readonly checkedAt: string; readonly capabilities: ProviderCapabilities; readonly code: DiscoveryFailure | null;
}
/** OS effects used by the Codex adapter; never supplied by an IPC caller. */
export interface CodexInspectionPort {
  inspectBinary(binary: string): Promise<DiscoveryResult<{ readonly version: string; readonly sha256: string }>>;
  checkLogin(configuration: ProviderConfiguration): Promise<'CHATGPT' | 'AUTH_REQUIRED' | 'UNAVAILABLE' | 'UNSAFE'>;
  prepareAuthHome(): Promise<DiscoveryResult<string>>;
}
export type ProviderEvent = { readonly kind: 'PROGRESS' | 'AGENT_TEXT'; readonly text: string }
  | { readonly kind: 'RESULT'; readonly result: ArchitectResult }
  | { readonly kind: 'FAILED'; readonly code: DiscoveryFailure };
export type ProviderOutputBatch = { readonly ok: true; readonly value: readonly ProviderEvent[] }
  | { readonly ok: false; readonly code: DiscoveryFailure; readonly partial?: readonly ProviderEvent[] };
export interface ProviderOutputDecoder {
  feed(bytes: Uint8Array): ProviderOutputBatch;
  /** Called only after local process exit has been independently verified. */
  finish(exitCode: number | null): DiscoveryResult<ArchitectResult>;
}
export interface DiscoveryRunFilesPort {
  prepare(runId: string): Promise<DiscoveryResult<{ readonly runtime: string; readonly schema: string }>>;
}
export interface ProviderInput {
  readonly questions?: readonly import('../domain/discovery/model.js').DiscoveryQuestion[];
  readonly runId: string; readonly generation: string; readonly schemaVersion: 1; readonly instructionsVersion: string;
  readonly requestKind: 'INITIAL' | 'ANSWER' | 'CORRECTION';
  readonly sources: readonly { readonly sourceId: string; readonly relativePath: string; readonly sha256: string; readonly text: string }[];
  readonly answers: readonly DiscoveryAnswer[]; readonly priorDraft: ArchitectResult | null; readonly correction: string | null;
}
/** Private invocation only, never a public DTO or a client-provided shell command. */
export interface ProviderInvocation {
  readonly executable: string; readonly args: readonly string[]; readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}
export interface ProviderPort {
  createOutputDecoder?(): ProviderOutputDecoder;
  inspectConfiguredBinary(configuration: ProviderConfiguration): Promise<DiscoveryResult<{ readonly version: string; readonly sha256: string }>>;
  checkAvailability(configuration: ProviderConfiguration): Promise<ProviderAvailability>;
  buildInvocation(configuration: ProviderConfiguration, runtime: string, schema: string): Promise<DiscoveryResult<ProviderInvocation>>;
  serializeInput(input: ProviderInput): DiscoveryResult<string>;
  decodeEvent(line: string): DiscoveryResult<ProviderEvent | null>;
  finalResult(): DiscoveryResult<ArchitectResult>;
}
