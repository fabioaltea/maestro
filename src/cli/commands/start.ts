import { runRun } from './run.js';

/**
 * Convenience: run the next ready task. Equivalent to `maestro run` with no id.
 */
export async function runStart(): Promise<void> {
  await runRun(undefined);
}
