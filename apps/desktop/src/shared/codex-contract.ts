export const CODEX_ACCOUNT_STATES = ['CONNECTED', 'AUTH_REQUIRED', 'MISSING_CLI', 'INCOMPATIBLE_CLI', 'UNAVAILABLE', 'LOGIN_FAILED', 'CANCELLED'] as const;
export interface CodexAccountStatus {
  state: typeof CODEX_ACCOUNT_STATES[number];
  binary: string | null;
  version: string | null;
}
