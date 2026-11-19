import { mkdir, lstat, open, rename, unlink, opendir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { record, keys, text, uuid, revision } from '../shared/validation.ts';
import { CORE_ERRORS } from '../shared/core-errors.ts';
import { FEATURE_MUTATIONS } from '../shared/feature-contract.ts';
export interface ReceiptMeta {
  requestId: string; namespace: 'foundation' | 'project' | 'discovery' | 'feature'; action: string; archivePath: string; storeId: string | null;
  featureId?: string; projectId: string | null; expectedRevision: string | null; intentHash: string;
}
export interface Receipt extends ReceiptMeta {
  receiptVersion: 1; createdAt: string; updatedAt: string; phase: 'PREPARED' | 'RECONCILING' | 'TERMINAL' | 'UNKNOWN';
  outcome: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'INTERRUPTED' | null; errorCode: string | null;
}
export function validateReceipt(value: unknown): Receipt {
  const p = record(value);
  keys(p, ['requestId', 'namespace', 'action', 'archivePath', 'storeId', 'projectId', 'expectedRevision', 'intentHash', 'featureId', 'receiptVersion', 'createdAt', 'updatedAt', 'phase', 'outcome', 'errorCode']);
  uuid(p.requestId); if(p.featureId!==undefined)uuid(p.featureId); if (p.storeId !== null) uuid(p.storeId); if (p.projectId !== null) uuid(p.projectId); if (p.expectedRevision !== null) revision(p.expectedRevision);
  if (!isAbsolute(text(p.archivePath, 2048)) || !/^[a-f0-9]{64}$/.test(text(p.intentHash, 64)) || p.receiptVersion !== 1) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
  if (!['foundation', 'project', 'discovery', 'feature'].includes(String(p.namespace))) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
  const actions: readonly string[] = p.namespace === 'foundation' ? ['start', 'stop', 'restart'] : p.namespace === 'project' ? ['register', 'verify', 'update', 'remove'] : p.namespace === 'feature' ? FEATURE_MUTATIONS : ['configure', 'check', 'preview', 'discard', 'start', 'answer', 'correct', 'approve', 'cancel'];
  if (!actions.includes(String(p.action)) || !['PREPARED', 'RECONCILING', 'TERMINAL', 'UNKNOWN'].includes(String(p.phase))) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
  if (p.outcome !== null && !['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(String(p.outcome))) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
  if (p.errorCode !== null && (typeof p.errorCode !== 'string' || !Object.hasOwn(CORE_ERRORS, p.errorCode))) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
  for (const key of ['createdAt', 'updatedAt']) if (typeof p[key] !== 'string' || !Number.isFinite(Date.parse(p[key]))) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
  if (p.phase === 'TERMINAL' && !['SUCCEEDED', 'FAILED', 'INTERRUPTED', ...(p.namespace !== 'foundation' ? ['BLOCKED'] : [])].includes(String(p.outcome))) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
  return p as unknown as Receipt;
}
export class ReceiptStore {
  readonly directory: string;
  private checkpoint: (point: string) => void;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private artifacts: string[] = [];
  constructor(directory: string, checkpoint: (point: string) => void = () => {}) { this.directory = directory; this.checkpoint = checkpoint; }
  private async ready() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
  }
  private async read(name: string): Promise<Receipt> {
    if (!/^[a-f0-9-]{36}\.json$/i.test(name)) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
    const file = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 4096) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
      const receipt = validateReceipt(JSON.parse(await file.readFile('utf8')));
      if (name !== `${receipt.requestId}.json`) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
      return receipt;
    } finally { await file.close(); }
  }
  private async scan(): Promise<Receipt[]> {
    try {
      await this.ready(); const records: Receipt[] = []; this.artifacts = []; let inspected = 0;
      for await (const file of await opendir(this.directory)) {
        if (++inspected > 201) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
        if (/^\.[a-f0-9-]{36}\.[a-f0-9-]{36}\.tmp$/i.test(file.name)) {
          const info = await lstat(join(this.directory, file.name));
          if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 4096) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
          this.artifacts.push(file.name); continue;
        }
        if (records.length >= 100) throw new Error('RECEIPT_LIMIT');
        records.push(await this.read(file.name));
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) { if (error instanceof Error && error.message === 'RECEIPT_LIMIT') throw error; throw new Error('RECEIPT_STORAGE_UNAVAILABLE'); }
  }
  list(): Promise<Receipt[]> { return this.serialize(() => this.scan()); }
  private async serialize<T>(action: () => Promise<T>): Promise<T> {
    if (this.pending >= 8) throw new Error('LOCAL_BUSY');
    this.pending++;
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    try { return await result; } catch (error) {
      if (error instanceof Error && ['LOCAL_BUSY', 'RECEIPT_LIMIT', 'OPERATION_UNCERTAIN', 'RECEIPT_STORAGE_UNAVAILABLE'].includes(error.message)) throw error;
      throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
    } finally { this.pending--; }
  }
  private async persist(receipt: Receipt) {
    validateReceipt(receipt);
    const encoded = JSON.stringify(receipt) + '\n';
    if (Buffer.byteLength(encoded) > 4096) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
    const temporary = join(this.directory, `.${receipt.requestId}.${randomUUID()}.tmp`);
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(encoded); await file.sync(); this.checkpoint('file.synced'); } finally { await file.close(); }
    await rename(temporary, join(this.directory, `${receipt.requestId}.json`)); this.checkpoint('file.renamed');
    const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); this.checkpoint('directory.synced'); } finally { await directory.close(); }
  }
  create(meta: ReceiptMeta): Promise<Receipt> {
    return this.serialize(async () => {
      const all = await this.scan(); if (this.artifacts.length) throw new Error('RECEIPT_STORAGE_UNAVAILABLE'); if (all.length >= 100) throw new Error('RECEIPT_LIMIT');
      if (all.some(r => r.requestId === meta.requestId)) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
      const now = new Date().toISOString();
      const receipt: Receipt = { ...meta, receiptVersion: 1, createdAt: now, updatedAt: now, phase: 'PREPARED', outcome: null, errorCode: null };
      await this.persist(receipt); return receipt;
    });
  }
  update(id: string, patch: Partial<Pick<Receipt, 'phase' | 'outcome' | 'errorCode' | 'storeId'>>): Promise<Receipt> {
    return this.serialize(async () => {
      uuid(id); keys(record(patch), ['phase', 'outcome', 'errorCode', 'storeId']);
      const original = (await this.scan()).find(r => r.requestId === id); if (!original) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
      if (patch.storeId !== undefined && original.storeId !== null && patch.storeId !== original.storeId) throw new Error('RECEIPT_STORAGE_UNAVAILABLE');
      if (original.phase === 'TERMINAL') { if (Object.entries(patch).some(([key, value]) => original[key as keyof Receipt] !== value)) throw new Error('RECEIPT_STORAGE_UNAVAILABLE'); return original; }
      const receipt = { ...original, ...patch, updatedAt: new Date().toISOString() }; await this.persist(receipt); return receipt;
    });
  }
  dismiss(id: string) {
    return this.serialize(async () => {
      uuid(id); const receipt = (await this.scan()).find(r => r.requestId === id);
      if (!receipt || receipt.phase !== 'TERMINAL') throw new Error('OPERATION_UNCERTAIN');
      await unlink(join(this.directory, `${id}.json`));
      for (const name of this.artifacts) if (name.startsWith(`.${id}.`)) await unlink(join(this.directory, name));
      const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    });
  }
}
