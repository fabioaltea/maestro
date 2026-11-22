import {REVIEW_BRIDGE_METHODS} from './review-contract.ts';
import {SCHEDULER_BRIDGE_METHODS} from './scheduler-contract.ts';
import {EXECUTION_BRIDGE_METHODS} from './execution-contract.ts';
import {PROFILE_BRIDGE_METHODS} from './profile-contract.ts';
import {ENVIRONMENT_BRIDGE_METHODS} from './environment-contract.ts';
import {FEATURE_BRIDGE_METHODS} from './feature-contract.ts';
import {WORKSPACE_BRIDGE_METHODS} from './workspace-contract.ts';
import { DISCOVERY_BRIDGE_METHODS } from './discovery-contract.ts';
export const CODEX_ACCOUNT_METHODS = ['codexStatus', 'codexLogin', 'cancelCodexLogin'] as const;
export const METHODS = [...CODEX_ACCOUNT_METHODS, 'checkCodexDiscovery',...REVIEW_BRIDGE_METHODS,...SCHEDULER_BRIDGE_METHODS,...EXECUTION_BRIDGE_METHODS,...PROFILE_BRIDGE_METHODS,...ENVIRONMENT_BRIDGE_METHODS,...WORKSPACE_BRIDGE_METHODS, ...FEATURE_BRIDGE_METHODS, ...DISCOVERY_BRIDGE_METHODS, 'releaseViewReads', 'openRepository', 'createRepository', 'selectProject', 'closeProject', 'recoverArchive', 'chooseArchive', 'context', 'status', 'diagnostics', 'listProjects', 'getProject', 'chooseRepository', 'prepareAction', 'confirmAction', 'cancelAction', 'reconcileOperation', 'listReceipts', 'dismissReceipt', 'selectReceiptArchive', 'readEvents', 'startEvents', 'stopEvents', 'ackEvents'] as const;
export type BridgeMethod = typeof METHODS[number];
export type Params = Record<string, unknown>;
export interface BridgeRequest extends Params { bridgeVersion: 1; callId: string; selectionEpoch: number }
export interface ArchiveView { selectionEpoch: number; archiveHandle: string; storeId: string | null; displayPath: string; activeProjectId?: string }
export interface SafeError { code: string; message: string; nextAction: string }
export interface PublicResult {
  protocolVersion: 1; requestId: string | null; storeId: string | null; instanceId: string | null;
  result: 'OK' | 'BUSY' | 'BLOCKED' | 'ERROR' | 'UNKNOWN_OUTCOME';
  outcome: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'INTERRUPTED' | null;
  freshness: 'LIVE' | 'LAST_KNOWN' | 'VOLATILE'; liveness: 'LIVE_VERIFIED' | 'ABSENT_VERIFIED' | 'UNKNOWN';
  data: Params; error: SafeError | null;
}
export interface BridgeResponse {
  bridgeVersion: 1; callId: string; selectionEpoch: number; archiveHandle: string | null; storeId: string | null;
  result: unknown; error: SafeError | null;
}
export interface ActivityMessage { kind: string; [key: string]: unknown }
export type DesktopApi = { [K in BridgeMethod]: (input: BridgeRequest) => Promise<BridgeResponse> } & {
  onActivity: (callback: (message: ActivityMessage) => void) => () => void;
};
export const CHANNEL = 'maestro.desktop.v1';
export const ACTIVITY_CHANNEL = 'maestro.activity.v1';
