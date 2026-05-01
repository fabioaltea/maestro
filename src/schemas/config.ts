import { z } from 'zod';
import { ProviderModeSchema } from './agent-frontmatter.js';

export const ApprovalsSchema = z.object({
  default: z.enum(['auto', 'prompt', 'gate']).default('auto'),
  destructive: z.enum(['auto', 'prompt', 'gate']).default('prompt'),
  network: z.enum(['auto', 'prompt', 'gate']).default('prompt'),
});

export const GlobalConfigSchema = z.object({
  default_provider: ProviderModeSchema.default('claude-code'),
  default_model: z.string().default('claude-sonnet-4-6'),
  anthropic_api_key: z.string().optional(),
  approvals: ApprovalsSchema.default({}),
  ui: z
    .object({
      enable_desktop_notifications: z.boolean().default(false),
    })
    .default({}),
  logging: z
    .object({
      retain_sessions_days: z.number().int().positive().default(30),
    })
    .default({}),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export const ProjectAgentOverrideSchema = z.object({
  model: z.string().optional(),
  fallback_model: z.string().optional(),
  mode: ProviderModeSchema.optional(),
});

export const ProjectConfigSchema = z.object({
  project_name: z.string(),
  maestro_version: z.string(),
  default_model: z.string().default('claude-sonnet-4-6'),
  provider_mode: ProviderModeSchema.default('claude-code'),
  approvals: ApprovalsSchema.optional(),
  agents: z.record(ProjectAgentOverrideSchema).default({}),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
