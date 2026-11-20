import type {ExecutionProviderPort} from '../../ports/execution-provider.js';

/** The pinned binary failed the independent confined startup precheck. */
export const unqualifiedClaudeExecution:ExecutionProviderPort={
 async check(){return{status:'BLOCKED',capabilityDigest:null,error:'PROVIDER_UNSAFE'};},
};
