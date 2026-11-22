import { isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProviderProfileInput {
  readonly executable: string;
  readonly runtime: string;
  readonly authHome: string;
}
/** Parameters are passed as argv to sandbox-exec, never interpolated into Scheme. */
export function createProviderProfile(input: ProviderProfileInput) {
  if (process.platform !== 'darwin') throw new Error('PROVIDER_UNSUPPORTED');
  for (const value of [input.executable, input.runtime, input.authHome]) {
    if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value
      || !value.isWellFormed() || /[\x00-\x1f\x7f]/.test(value) || Buffer.byteLength(value) > 16 * 1024) throw new Error('INVALID_PROVIDER_CONFIGURATION');
  }
  return Object.freeze({ executable: '/usr/bin/sandbox-exec', args: Object.freeze([
    '-D', `EXECUTABLE=${input.executable}`, '-D', `RUNTIME=${input.runtime}`,
    '-D', `SCRATCH=${join(input.runtime, 'scratch')}`,
    '-D', `INSTALLATION_ID=${join(input.authHome, 'installation_id')}`,
    '-f', fileURLToPath(new URL('./provider.sb', import.meta.url)),
  ]) });
}
