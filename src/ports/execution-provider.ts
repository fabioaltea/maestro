import type {ExecutionProviderConfig} from './execution.js';

export interface ExecutionProviderPort {
 /** An explicit check resolves private handles locally and returns the exact qualified capability tuple digest.
  * An unavailable, unsupported or unauthenticated tuple is reported independently of other providers. */
 check(configuration:ExecutionProviderConfig):Promise<Pick<ExecutionProviderConfig,'status'|'capabilityDigest'|'error'>>;
}
