import { z } from 'zod';

export const EventTypeSchema = z.enum([
  'task.created',
  'task.started',
  'task.completed',
  'task.failed',
  'task.blocked',
  'task.unblocked',
  'task.status_changed',
  'agent.spawned',
  'agent.killed',
  'agent.idle',
  'agent.busy',
  'agent.waiting_user',
  'agent.user_input',
  'tool.called',
  'tool.completed',
  'tool.failed',
  'llm.call_started',
  'llm.call_completed',
  'phase.completed',
  'phase.gate_opened',
  'phase.gate_approved',
  'phase.gate_revised',
  'cross_agent.requested',
  'cross_agent.completed',
  'docs.updated',
  'learnings.appended',
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  timestamp: z.string(),
  type: EventTypeSchema,
  agent: z.string().optional(),
  task_id: z.string().optional(),
  data: z.record(z.unknown()).default({}),
});

export type Event = z.infer<typeof EventSchema>;
