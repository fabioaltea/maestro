import { randomUUID } from 'node:crypto';
import type { DiscoveryEligibility } from '../../domain/discovery/approval.js';
import { requireUuid } from '../../domain/identifiers.js';
/** Volatile photographs only. No result survives runtime restart. Each UUID is
 * owned by this store instance and project; polling never schedules work. */
export function createEligibilityChecks(options: { check(projectId: string): Promise<Omit<DiscoveryEligibility, 'checkId'>>; job(work: () => Promise<void>): void; now?: () => number; timeoutMs?: number }) {
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('INVALID_REQUEST');
  const now = options.now ?? Date.now, checks = new Map<string, { projectId: string; expires: number; value: DiscoveryEligibility; active: boolean }>();
  const pending = new Map<string, string>();
  return async (projectId: string, checkId?: string): Promise<DiscoveryEligibility> => {
    requireUuid(projectId);
    for (const [id, check] of checks) if (!check.active && check.expires <= now()) checks.delete(id);
    if (checkId !== undefined) {
      requireUuid(checkId); const check = checks.get(checkId);
      if (!check || check.projectId !== projectId || check.expires <= now()) throw new Error('CHECK_EXPIRED'); return { ...check.value };
    }
    const existing = pending.get(projectId); if (existing) return { ...checks.get(existing)!.value };
    if (pending.size >= 4 || checks.size >= 128) throw new Error('DISCOVERY_BUSY');
    const id = randomUUID(), check = { projectId, expires: now() + 30000, active: true, value: { projectId, eligible: false, reason: 'CHECKING', revisionId: null, approvalId: null, contextDigest: null, checkedAt: null, freshness: 'UNKNOWN', checkId: id } as DiscoveryEligibility };
    checks.set(id, check); pending.set(projectId, id);
    options.job(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = Promise.resolve().then(() => options.check(projectId));
      const release = () => { check.active = false; if (pending.get(projectId) === id) pending.delete(projectId); };
      // A public timeout is not proof that its I/O stopped. Keep both the
      // global and per-project debit until the underlying operation settles.
      void work.then(release, release);
      try { const result = await Promise.race([work, new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error('DEADLINE_EXCEEDED')), timeoutMs); })]); check.value = { ...result, checkId: id }; }
      catch { check.value = { ...check.value, eligible: false, reason: 'UNKNOWN', freshness: 'UNKNOWN', checkedAt: new Date(now()).toISOString() }; }
      finally { clearTimeout(timer); check.expires = now() + 30000; }
    });
    return { ...check.value };
  };
}
