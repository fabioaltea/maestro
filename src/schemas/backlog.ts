import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'pending',
  'ready',
  'in_progress',
  'awaiting_approval',
  'blocked',
  'blocked_needs_user',
  'failed',
  'done',
]);

export const ComplexitySchema = z.enum(['S', 'M', 'L']);

export const TaskSchema = z.object({
  id: z.string().regex(/^(ARCH|ENG)-\d{3,}$/, 'task id must be ARCH-NNN or ENG-NNN'),
  title: z.string().min(1),
  description: z.string(),
  assignee: z.string().min(1),
  status: TaskStatusSchema,
  prerequisites: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  required_skills: z.array(z.string()).default([]),
  area: z.string().default('meta'),
  complexity: ComplexitySchema.default('M'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  retry_count: z.number().int().nonnegative().default(0),
  parent_task: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type Task = z.infer<typeof TaskSchema>;

export const BacklogSchema = z.object({
  version: z.string(),
  project_name: z.string(),
  tasks: z.array(TaskSchema),
});

export type Backlog = z.infer<typeof BacklogSchema>;
