import type { DiscoveryResult } from '../../domain/discovery/model.js';
import type { CodexInspectionPort, ProviderAvailability, ProviderCapabilities, ProviderConfiguration } from '../../ports/provider.js';
import { CODEX_DISCOVERY_PIN } from './argv.js';

/** Local G0 evidence, not a claim of real account/model qualification (G1). */
export const CODEX_DISCOVERY_QUALIFICATION = Object.freeze({
  digest: 'f2401ac95b4463f98b92a4eeb8cbd689f7717d1ba9f71331b3c8f94bbfad3db0',
  profileSha256: 'ccc59b0561c53c6aeef50327c7bf13dac6f331c11ecee60e5a4601eccd5f8cf6',
  schemaSha256: 'b8ed8108f43a36fa6445405f6516107e3c6c50ef4ee86393dc4d5cca01fcb74b',
});
export const CODEX_CAPABILITIES: ProviderCapabilities = Object.freeze({ readOnlyAnalysis: true, portableTurns: true,
  nativeResume: false, localCancellation: true, verifiedRemoteCancellation: false, quotaResetInfo: false });
const unavailableCapabilities: ProviderCapabilities = Object.freeze({ ...CODEX_CAPABILITIES, readOnlyAnalysis: false });
export function normalizeCodexLoginStatus(exitCode: number | null, bytes: Uint8Array): 'CHATGPT' | 'AUTH_REQUIRED' | 'UNSAFE' {
  if (bytes.byteLength > 8192) return 'UNSAFE';
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(); } catch { return 'UNSAFE'; }
  // The pinned CLI may emit this fixed startup warning even for status. No
  // wildcard diagnostic/account/token text is accepted as proof of login.
  text = text.replace(/^WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted \(os error 1\)\n/, '');
  return exitCode === 0 && text === 'Logged in using ChatGPT' ? 'CHATGPT'
    : exitCode === 1 && text === 'Not logged in' ? 'AUTH_REQUIRED' : 'UNSAFE';
}
export function validCodexModel(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value);
}
export function createCodexCapabilities(probe: CodexInspectionPort, now: () => Date = () => new Date()) {
  async function inspectConfiguredBinary(c: ProviderConfiguration): Promise<DiscoveryResult<{ version: string; sha256: string }>> {
    if (c.providerId !== 'codex' || c.binaryVersion !== CODEX_DISCOVERY_PIN.version || c.binarySha256 !== CODEX_DISCOVERY_PIN.sha256
      || c.policyVersion !== CODEX_DISCOVERY_PIN.policyVersion || c.qualificationDigest !== CODEX_DISCOVERY_QUALIFICATION.digest
      || !validCodexModel(c.modelId)) return { ok: false, code: 'PROVIDER_UNSUPPORTED' };
    try {
      const result = await probe.inspectBinary(c.binaryRealpath);
      if (!result.ok) return result;
      return result.value.version === c.binaryVersion && result.value.sha256 === c.binarySha256
        ? result : { ok: false, code: 'PROVIDER_UNSUPPORTED' };
    } catch { return { ok: false, code: 'PROVIDER_UNAVAILABLE' }; }
  }
  async function checkAvailability(c: ProviderConfiguration): Promise<ProviderAvailability> {
    const inspected = await inspectConfiguredBinary(c);
    let state: ProviderAvailability['state'] = 'UNSUPPORTED', code: ProviderAvailability['code'] = 'PROVIDER_UNSUPPORTED';
    if (inspected.ok) {
      let login: Awaited<ReturnType<CodexInspectionPort['checkLogin']>>;
      try { login = await probe.checkLogin(c); } catch { login = 'UNAVAILABLE'; }
      if (login === 'CHATGPT') { state = 'AVAILABLE'; code = null; }
      else if (login === 'AUTH_REQUIRED') { state = 'AUTH_REQUIRED'; code = 'PROVIDER_AUTH_REQUIRED'; }
      else { state = 'UNSAFE'; code = login === 'UNSAFE' ? 'PROVIDER_UNSAFE' : 'PROVIDER_UNAVAILABLE'; }
    } else code = inspected.code;
    // AVAILABLE describes local credentials and qualified invocation only. It is
    // not a quota, subscription, model access or successful inference assertion.
    return { state, checkedAt: now().toISOString(), capabilities: state === 'AVAILABLE' ? CODEX_CAPABILITIES : unavailableCapabilities, code };
  }
  return { inspectConfiguredBinary, checkAvailability };
}
