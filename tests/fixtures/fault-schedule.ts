export type FaultMode = 'fail' | 'pause';
export interface FaultRule { readonly point: string; readonly occurrence: number; readonly mode: FaultMode }

export class InjectedFault extends Error {
  constructor(readonly point: string) { super(`TEST_FAULT:${point}`); }
}

export class FaultSchedule {
  readonly visits: string[] = [];
  private readonly counts = new Map<string, number>();
  private readonly pauses = new Map<string, () => void>();
  constructor(private readonly rules: readonly FaultRule[]) {
    const unique = new Set<string>();
    for (const rule of rules) {
      const key = `${rule.point}:${rule.occurrence}`;
      if (!rule.point || !Number.isSafeInteger(rule.occurrence) || rule.occurrence <= 0 || unique.has(key)) {
        throw new Error('INVALID_FAULT_SCHEDULE');
      }
      unique.add(key);
    }
  }
  async checkpoint(point: string): Promise<void> {
    const occurrence = (this.counts.get(point) ?? 0) + 1;
    this.counts.set(point, occurrence);
    this.visits.push(`${point}:${occurrence}`);
    const rule = this.rules.find(rule => rule.point === point && rule.occurrence === occurrence);
    if (!rule) return;
    if (rule.mode === 'fail') throw new InjectedFault(point);
    await new Promise<void>(resolve => this.pauses.set(`${point}:${occurrence}`, resolve));
  }
  release(point: string, occurrence: number): void {
    const key = `${point}:${occurrence}`;
    const release = this.pauses.get(key);
    if (!release) throw new Error('NO_SUCH_PAUSED_CHECKPOINT');
    this.pauses.delete(key);
    release();
  }
}
