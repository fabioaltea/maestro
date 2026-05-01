export const MAESTRO_VERSION = '0.1.0';

export type ProviderMode = 'claude-code' | 'anthropic-api';

export type Complexity = 'S' | 'M' | 'L';

export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'awaiting_approval'
  | 'blocked'
  | 'blocked_needs_user'
  | 'failed'
  | 'done';
