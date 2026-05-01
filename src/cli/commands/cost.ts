import { findProjectRoot, projectPathsFor } from '../../utils/paths.js';
import { StateStore } from '../../core/state-store.js';
import { getCostByTask } from '../../llm/cost-tracker.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

export async function runCost(opts: { since?: string }): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    console.error('[maestro] Not in a maestro project. Run `maestro init` first.');
    process.exit(1);
  }
  const paths = projectPathsFor(root);
  const store = new StateStore(paths.stateDb);

  try {
    const rows = getCostByTask(store, opts.since);
    if (rows.length === 0) {
      console.log('[maestro] No LLM calls recorded yet.');
      return;
    }

    console.log('');
    if (opts.since) console.log(`${DIM}Filtered from: ${opts.since}${RESET}\n`);
    console.log(`${BOLD}${'Task'.padEnd(12)} ${'Agent'.padEnd(16)} ${'Model'.padEnd(22)} ${'Cost (USD)'.padEnd(12)} ${'In'.padEnd(8)} ${'Out'.padEnd(8)} Calls${RESET}`);
    console.log('─'.repeat(90));

    let total = 0;
    for (const r of rows) {
      total += r.totalCostUsd;
      const task = (r.taskId ?? 'n/a').padEnd(12);
      const agent = (r.agentName ?? 'n/a').padEnd(16);
      const model = r.model.padEnd(22);
      const cost = `$${r.totalCostUsd.toFixed(4)}`.padEnd(12);
      const inp = String(r.inputTokens).padEnd(8);
      const out = String(r.outputTokens).padEnd(8);
      console.log(`${task} ${agent} ${model} ${cost} ${inp} ${out} ${r.callCount}`);
    }
    console.log('─'.repeat(90));
    console.log(`${BOLD}Total: $${total.toFixed(4)}${RESET}\n`);
  } finally {
    store.close();
  }
}
