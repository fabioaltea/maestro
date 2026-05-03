import { z } from 'zod';

export const ProviderModeSchema = z.enum(['claude-code', 'anthropic-api', 'copilot', 'codex']);
export const SenioritySchema = z.enum(['junior', 'mid', 'senior']);

export const AgentFrontmatterSchema = z.object({
  name: z.string().min(1),
  maestro_version: z.string(),
  created: z.string(),
  model: z.string(),
  fallback_model: z.string().optional(),
  mode: ProviderModeSchema.default('claude-code'),
  skills: z.array(z.string()).default([]),
  seniority: SenioritySchema.default('mid'),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
export type ProviderMode = z.infer<typeof ProviderModeSchema>;
