import { FaultSchedule, type FaultMode, type FaultRule } from './fault-schedule.js';

export const PROJECT_CHECKPOINTS = [
  'project.beforeAccept', 'project.accepted', 'project.probing',
  'project.beforeCommit', 'project.committed', 'project.beforeAck', 'project.beforeDrain',
] as const;
export type ProjectCheckpoint = typeof PROJECT_CHECKPOINTS[number];

export function projectFault(point: ProjectCheckpoint, mode: FaultMode = 'fail', occurrence = 1): FaultSchedule {
  const rule: FaultRule = { point, mode, occurrence };
  return new FaultSchedule([rule]);
}

export function snapshotDigest(snapshot: Readonly<Record<string, unknown>>): string {
  // Stable comparison data; hashing is performed by the repository fixture itself.
  return JSON.stringify(Object.fromEntries(Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b))));
}
