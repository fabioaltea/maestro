import type { StateStore } from '../core/state-store.js';

// Hard-coded Anthropic pricing (per million tokens, in USD)
// Source: https://www.anthropic.com/api
const PRICES: Record<string, { input: number; output: number; cache_read: number }> = {
  'claude-opus-4-7': { input: 15, output: 75, cache_read: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_read: 0.3 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cache_read: 0.08 },
  default: { input: 3, output: 15, cache_read: 0.3 },
};

function getPrice(model: string): { input: number; output: number; cache_read: number } {
  return PRICES[model] ?? PRICES['default']!;
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
): number {
  const p = getPrice(model);
  const regularInput = Math.max(0, inputTokens - cachedTokens);
  return (regularInput * p.input + cachedTokens * p.cache_read + outputTokens * p.output) / 1e6;
}

export function recordCall(
  store: StateStore,
  opts: {
    taskId?: string;
    agentName?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    durationMs: number;
  },
): void {
  const cost = estimateCost(opts.model, opts.inputTokens, opts.outputTokens, opts.cachedTokens);
  store.raw
    .prepare(
      `INSERT INTO llm_calls (timestamp, task_id, agent_name, model, input_tokens, output_tokens, cached_tokens, estimated_cost_usd, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      new Date().toISOString(),
      opts.taskId ?? null,
      opts.agentName ?? null,
      opts.model,
      opts.inputTokens,
      opts.outputTokens,
      opts.cachedTokens ?? 0,
      cost,
      opts.durationMs,
    );
}

export function getTotalCost(store: StateStore): number {
  const row = store.raw
    .prepare('SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM llm_calls')
    .get() as { total: number };
  return row.total;
}

export function getCostByAgent(
  store: StateStore,
): Array<{ agentName: string; totalCostUsd: number; callCount: number }> {
  return store.raw
    .prepare(
      `SELECT agent_name as agentName, SUM(estimated_cost_usd) as totalCostUsd, COUNT(*) as callCount
       FROM llm_calls GROUP BY agent_name ORDER BY totalCostUsd DESC`,
    )
    .all() as Array<{ agentName: string; totalCostUsd: number; callCount: number }>;
}

export function getCostByTask(
  store: StateStore,
  since?: string,
): Array<{
  taskId: string | null;
  agentName: string | null;
  model: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
}> {
  const where = since ? `WHERE timestamp >= '${since}'` : '';
  return store.raw
    .prepare(
      `SELECT task_id as taskId, agent_name as agentName, model,
              SUM(estimated_cost_usd) as totalCostUsd,
              SUM(input_tokens) as inputTokens,
              SUM(output_tokens) as outputTokens,
              COUNT(*) as callCount
       FROM llm_calls ${where}
       GROUP BY task_id, agent_name, model
       ORDER BY totalCostUsd DESC`,
    )
    .all() as Array<{
    taskId: string | null;
    agentName: string | null;
    model: string;
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    callCount: number;
  }>;
}
