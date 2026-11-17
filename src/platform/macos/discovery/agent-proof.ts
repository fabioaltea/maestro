import { createHmac, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { requireUuid } from '../../../domain/identifiers.js';
import { isDiscoveryFailure, type DiscoveryFailure, type RunOutcome } from '../../../domain/discovery/model.js';
export interface HostProof {
  readonly proofVersion: 1; readonly runId: string; readonly generation: string; readonly hostPid: number; readonly providerPid: number | null;
  readonly providerExited: boolean; readonly outcome: RunOutcome; readonly exitCode: number | null; readonly signal: string | null; readonly error: DiscoveryFailure | null; readonly authentication: string;
}
function payload(p: Omit<HostProof, 'authentication'>) { return JSON.stringify({ proofVersion: p.proofVersion, runId: p.runId, generation: p.generation, hostPid: p.hostPid, providerPid: p.providerPid, providerExited: p.providerExited, outcome: p.outcome, exitCode: p.exitCode, signal: p.signal, error: p.error }); }
export function signHostProof(p: Omit<HostProof, 'authentication'>, key: string): HostProof {
  return { ...p, authentication: createHmac('sha256', Buffer.from(key, 'hex')).update(payload(p)).digest('hex') };
}
export function validateHostProof(raw: unknown, key: string, expected: { runId: string; generation: string }): HostProof {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
  const p = raw as HostProof;
  if (Object.keys(p).sort().join(',') !== 'authentication,error,exitCode,generation,hostPid,outcome,proofVersion,providerExited,providerPid,runId,signal' || p.proofVersion !== 1 || p.runId !== expected.runId || p.generation !== expected.generation) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
  requireUuid(p.runId); requireUuid(p.generation);
  if (!Number.isSafeInteger(p.hostPid) || p.hostPid <= 0 || p.providerPid !== null && (!Number.isSafeInteger(p.providerPid) || p.providerPid <= 0) || p.providerExited !== true || !['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'TIMED_OUT'].includes(p.outcome) || p.exitCode !== null && (!Number.isInteger(p.exitCode) || p.exitCode < 0 || p.exitCode > 255) || p.signal !== null && !/^SIG[A-Z0-9]+$/.test(p.signal) || p.error !== null && !isDiscoveryFailure(p.error)) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
  if (typeof p.authentication !== 'string' || !/^[a-f0-9]{64}$/.test(p.authentication) || !/^[a-f0-9]{64}$/.test(key)) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
  const expectedTag = signHostProof(p, key).authentication;
  if (!timingSafeEqual(Buffer.from(p.authentication, 'hex'), Buffer.from(expectedTag, 'hex'))) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
  return p;
}
export async function writeHostProof(path: string, proof: HostProof) {
  const parent = await lstat(dirname(path)); if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid!() || (parent.mode & 0o7777) !== 0o700) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
  const bytes = Buffer.from(JSON.stringify(proof)); if (bytes.length > 4096) throw new Error('CONTEXT_LIMIT');
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW); try { await directory.sync(); } finally { await directory.close(); }
}
export async function readHostProof(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid!()) || before.nlink !== 1n || (before.mode & 0o7777n) !== 0o600n || before.size < 1n || before.size > 4096n) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
    const bytes = Buffer.alloc(4097), read = await file.read(bytes, 0, bytes.length, 0), after = await file.stat({ bigint: true });
    if (BigInt(read.bytesRead) !== before.size || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read.bytesRead)));
  } finally { await file.close(); }
}
