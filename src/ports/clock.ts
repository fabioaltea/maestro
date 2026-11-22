export interface Clock {
  wallUtc(): string;
  monotonicNow(): number;
}

export interface Deadline {
  readonly expiresAt: number;
  remainingMs(): number;
  expired(): boolean;
}

export const systemClock: Clock = Object.freeze({
  wallUtc: () => new Date().toISOString(),
  monotonicNow: () => performance.now(),
});

export function makeDeadline(clock: Clock, timeoutMs: number): Deadline {
  const now = clock.monotonicNow();
  const expiresAt = now + timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(now)
    || !Number.isFinite(expiresAt)) throw new Error('INVALID_TIMEOUT');
  return Object.freeze({
    expiresAt,
    remainingMs: () => Math.max(0, expiresAt - clock.monotonicNow()),
    expired: () => clock.monotonicNow() >= expiresAt,
  });
}
