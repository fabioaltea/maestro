/** Synthetic data only: no production Discovery approval, provider or filesystem grant. */
export function featureDraft() {
  return { version: 1 as const, title: 'A local feature', request: 'Add a readable local status.',
    specification: { scope: 'Local status', users: ['Owner'], stories: [{ storyId: 'US1', text: 'Read status' }], exclusions: ['Remote publishing'] },
    implementationPlan: { approach: 'Extend the existing status query.', dependencies: [], risks: ['Stale observation'] },
    acceptanceCriteria: [{ criterionId: 'AC1', storyId: 'US1', text: 'Status is visible offline', verification: 'Read saved status without starting work', required: true }],
    provenance: [], unknowns: [] };
}

export const featurePlanningConfiguration={providerId:'fixture-planning',modelId:'fixture-model',configurationRevision:'1',qualificationDigest:'a'.repeat(64)};
