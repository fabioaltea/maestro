import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import type { StateStore } from '../../core/state-store.js';
import type { EventBus } from '../../core/event-bus.js';
import type { BacklogManager } from '../../core/backlog-manager.js';
import type { ProjectPaths } from '../../utils/paths.js';
import { agentFilePath } from '../../utils/paths.js';
import { appendUnderHeading } from '../../utils/markdown.js';
import type { ToolDefinition } from '../../llm/provider.js';
import type { Task } from '../../schemas/backlog.js';

export const GATE_MARKER = '__maestro_gate__' as const;
export type GateResult = { [GATE_MARKER]: true; task_id: string; summary: string };
export function isGateResult(x: unknown): x is GateResult {
  return typeof x === 'object' && x !== null && GATE_MARKER in x;
}

export type ToolContext = {
  paths: ProjectPaths;
  store: StateStore;
  bus: EventBus;
  manager: BacklogManager;
};

export const ARCHITECT_TOOLS: ToolDefinition[] = [
  {
    name: 'read_doc',
    description: 'Read a file from docs/ or .agents/ directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path within the project (e.g. docs/01-functional-analysis.md or .agents/architect.md)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_doc',
    description: 'Write (create or overwrite) a file in docs/.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path under docs/ (e.g. docs/01-functional-analysis.md)' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'update_doc',
    description: 'Append content under a heading in an existing doc file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the doc file' },
        section: { type: 'string', description: 'Markdown heading to append under (e.g. "## Summary")' },
        content: { type: 'string', description: 'Content block to insert under the heading' },
      },
      required: ['path', 'section', 'content'],
    },
  },
  {
    name: 'read_agent',
    description: 'Read .agents/<name>.md file.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent name (without .md extension)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'write_agent',
    description: 'Write (create or overwrite) .agents/<name>.md.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent name (without .md extension)' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'update_backlog',
    description: 'Add, update, or remove tasks from the backlog.',
    input_schema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Array of operations to apply',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['add', 'update', 'remove'] },
              task: { type: 'object', description: 'Task data (for add/update)' },
              id: { type: 'string', description: 'Task id (for update/remove)' },
            },
            required: ['type'],
          },
        },
      },
      required: ['operations'],
    },
  },
  {
    name: 'get_backlog',
    description: 'Return all tasks in the backlog as a JSON string.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'request_user_input',
    description: 'Ask the user a question and wait for their response.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to ask the user' },
        context: { type: 'string', description: 'Optional context for the question' },
      },
      required: ['question'],
    },
  },
  {
    name: 'set_phase_status',
    description: 'Mark the current phase as complete and request user approval before proceeding.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id of the phase being completed' },
        status: { type: 'string', description: 'New status (typically "awaiting_approval")' },
        summary: { type: 'string', description: 'Summary of what was accomplished in this phase' },
      },
      required: ['task_id', 'status', 'summary'],
    },
  },
  {
    name: 'notify_failure',
    description: 'Mark the task as failed and record the reason.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id that failed' },
        reason: { type: 'string', description: 'Reason for failure' },
      },
      required: ['task_id', 'reason'],
    },
  },
];

export async function handleArchitectTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string | GateResult> {
  const { paths, store, bus, manager } = ctx;

  switch (toolName) {
    case 'read_doc': {
      const relPath = String(input['path']);
      const fullPath = join(paths.root, relPath);
      if (!existsSync(fullPath)) return `File not found: ${relPath}`;
      return readFileSync(fullPath, 'utf8');
    }

    case 'write_doc': {
      const relPath = String(input['path']);
      const content = String(input['content']);
      const fullPath = join(paths.root, relPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf8');
      bus.publish({ type: 'docs.updated', agent: 'architect', data: { path: relPath } });
      return 'ok';
    }

    case 'update_doc': {
      const relPath = String(input['path']);
      const section = String(input['section']);
      const content = String(input['content']);
      const fullPath = join(paths.root, relPath);
      appendUnderHeading(fullPath, section, content);
      bus.publish({ type: 'docs.updated', agent: 'architect', data: { path: relPath } });
      return 'ok';
    }

    case 'read_agent': {
      const name = String(input['name']);
      const fullPath = agentFilePath(paths, name);
      if (!existsSync(fullPath)) return `Agent file not found: ${fullPath}`;
      return readFileSync(fullPath, 'utf8');
    }

    case 'write_agent': {
      const name = String(input['name']);
      const content = String(input['content']);
      const fullPath = agentFilePath(paths, name);
      writeFileSync(fullPath, content, 'utf8');
      return 'ok';
    }

    case 'update_backlog': {
      const operations = input['operations'] as Array<{
        type: 'add' | 'update' | 'remove';
        task?: Partial<Task>;
        id?: string;
      }>;
      let count = 0;
      for (const op of operations) {
        if (op.type === 'add' && op.task) {
          manager.addTask(paths, store, op.task as Task);
          count++;
        } else if (op.type === 'update' && op.id && op.task) {
          manager.updateTask(paths, store, op.id, op.task);
          count++;
        } else if (op.type === 'remove' && op.id) {
          manager.updateTask(paths, store, op.id, { status: 'done' });
          count++;
        }
      }
      return `Updated ${count} task(s)`;
    }

    case 'get_backlog': {
      const tasks = manager.getTasks(paths);
      return JSON.stringify(tasks, null, 2);
    }

    case 'request_user_input': {
      const question = String(input['question']);
      const context = input['context'] ? `\nContext: ${input['context']}` : '';
      bus.publish({ type: 'agent.waiting_user', agent: 'architect', data: { question } });
      process.stdout.write(`\n[Architect asks]: ${question}${context}\nyou › `);
      const answer = await readLine();
      bus.publish({ type: 'agent.user_input', agent: 'architect', data: { answer } });
      return answer;
    }

    case 'set_phase_status': {
      const taskId = String(input['task_id']);
      const summary = String(input['summary']);
      manager.updateTask(paths, store, taskId, { status: 'awaiting_approval' });
      bus.publish({
        type: 'phase.gate_opened',
        agent: 'architect',
        task_id: taskId,
        data: { summary },
      });
      return { [GATE_MARKER]: true, task_id: taskId, summary } as GateResult;
    }

    case 'notify_failure': {
      const taskId = String(input['task_id']);
      const reason = String(input['reason']);
      manager.updateTask(paths, store, taskId, { status: 'failed' });
      bus.publish({
        type: 'task.failed',
        agent: 'architect',
        task_id: taskId,
        data: { reason },
      });
      const sessionDir = join(paths.sessionsDir, taskId);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, 'failure.md'), `# Failure\n\n${reason}\n`, 'utf8');
      return 'ok';
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.once('line', (line) => {
      rl.close();
      resolve(line);
    });
    rl.once('close', () => resolve(''));
  });
}
