import type { ProviderInvocation } from '../../src/ports/provider.js';
/** Trusted constructor seam for local process fixtures. Never configurable on the wire. */
export async function prepareProviderInvocation(invocation: ProviderInvocation): Promise<ProviderInvocation> { return invocation; }
