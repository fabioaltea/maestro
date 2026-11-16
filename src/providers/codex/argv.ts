import { isAbsolute, join, normalize, relative } from 'node:path';

export const CODEX_DISCOVERY_PIN = Object.freeze({
  version: '0.167.0',
  sha256: '030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc',
  policyVersion: 'codex-discovery-macos-v1',
});
export interface CodexInvocationInput {
  readonly binary: string;
  readonly model: string;
  readonly runtime: string;
  readonly authHome: string;
  readonly schema: string;
}
export interface CodexInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}
const overrides = Object.freeze([
  'cli_auth_credentials_store="keyring"', 'web_search="disabled"', 'project_doc_max_bytes=0',
  'features.shell_tool=false', 'features.view_image=false', 'features.multi_agent=false',
  'features.goals=false', 'features.hooks=false', 'features.apps=false', 'features.remote_plugin=false',
  'agents.enabled=false', 'features.code_mode.enabled=false', 'apps._default.enabled=false',
  'plugins._default.enabled=false', 'skills.bundled.enabled=false', 'skills.include_instructions=false',
  'mcp_servers={}', 'check_for_update_on_startup=false',
  'analytics.enabled=false', 'feedback.enabled=false', 'otel.exporter="none"', 'otel.metrics_exporter="none"',
  'otel.log_user_prompt=false', 'otel.log_agent_responses=false', 'allow_login_shell=false', 'features.shell_snapshot=false',
  'features.enable_request_compression=false',
]);
function absolute(path: string) {
  if (typeof path !== 'string' || !path.isWellFormed() || !isAbsolute(path) || normalize(path) !== path
    || /[\x00-\x1f\x7f]/.test(path) || Buffer.byteLength(path) > 16 * 1024) throw new Error('INVALID_PROVIDER_CONFIGURATION');
}
function inside(root: string, path: string) {
  const value = relative(root, path); return value === '' || (!value.startsWith('../') && value !== '..' && !isAbsolute(value));
}
/** Pure, closed invocation builder. No caller-supplied flags, URLs, prompt or environment. */
export function createCodexInvocation(input: CodexInvocationInput): CodexInvocation {
  for (const path of [input.binary, input.runtime, input.authHome, input.schema]) absolute(path);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(input.model)
    || input.schema !== join(input.runtime, 'result.schema.json')
    || inside(input.runtime, input.authHome) || inside(input.authHome, input.runtime)
    || inside(input.runtime, input.binary)) throw new Error('INVALID_PROVIDER_CONFIGURATION');
  const scratch = join(input.runtime, 'scratch');
  const env = Object.freeze({
    HOME: join(scratch, 'home'), TMPDIR: join(scratch, 'tmp'),
    XDG_CONFIG_HOME: join(scratch, 'config'), XDG_CACHE_HOME: join(scratch, 'cache'), XDG_DATA_HOME: join(scratch, 'data'),
    CODEX_HOME: input.authHome, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    NO_COLOR: '1', TERM: 'dumb', OTEL_SDK_DISABLED: 'true',
  });
  return Object.freeze({ executable: input.binary, cwd: input.runtime, env,
    args: Object.freeze(['--no-daemon', '--ask-for-approval', 'never', 'exec', '--json', '--ephemeral', '--skip-git-repo-check',
      '--ignore-user-config', '--ignore-rules', '--strict-config', '--sandbox', 'read-only',
      '--output-schema', input.schema, '--model', input.model,
      ...overrides.flatMap(value => ['-c', value]),
      '-c', `sqlite_home=${JSON.stringify(join(scratch, 'state'))}`, '-']),
  });
}
