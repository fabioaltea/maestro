import { randomUUID } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import { dirname, basename, isAbsolute, join } from 'node:path';
import type { ArchiveView, PublicResult } from '../shared/bridge-contract.ts';
export interface ArchiveSelection { path: string; view: ArchiveView }
export class ArchiveContext {
  private epoch = 0;
  private listeners = new Set<() => void>();
  onChange(listener: () => void) { if (this.listeners.size >= 16) throw new Error('LOCAL_BUSY'); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed() { for (const listener of this.listeners) listener(); }
  private selection: ArchiveSelection | null = null;
  get current() { return this.selection; }
  async select(path: string): Promise<ArchiveSelection> {
    if (!isAbsolute(path) || path.includes('\0')) throw new Error('INVALID_INPUT');
    let canonical: string;
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('INVALID_INPUT');
      canonical = await realpath(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      canonical = join(await realpath(dirname(path)), basename(path));
    }
    // UI location hint only: no Git command, repair or permission change. Core validates archive storage.
    const hasEntry = async (name: string) => lstat(join(canonical, name)).then(() => true, error => {
      if (error.code === 'ENOENT') return false; throw error;
    });
    if (await hasEntry('.git') && !await hasEntry('state.sqlite')) throw new Error('ARCHIVE_IS_REPOSITORY');
    this.selection = { path: canonical, view: { selectionEpoch: ++this.epoch, archiveHandle: randomUUID(), storeId: null, displayPath: canonical } };
    this.changed(); return this.selection;
  }
  capture(): ArchiveSelection {
    if (!this.selection) throw new Error('STALE_CONTEXT');
    return { path: this.selection.path, view: { ...this.selection.view } };
  }
  apply(captured: ArchiveSelection, result: PublicResult) {
    if (!this.selection || captured.view.selectionEpoch !== this.selection.view.selectionEpoch) throw new Error('STALE_CONTEXT');
    if (this.selection.view.storeId && result.storeId && this.selection.view.storeId !== result.storeId) {
      this.selection = { path: this.selection.path, view: { ...this.selection.view, selectionEpoch: ++this.epoch, archiveHandle: randomUUID(), storeId: result.storeId } };
      this.changed(); throw new Error('STALE_CONTEXT');
    }
    if (result.storeId) this.selection.view.storeId = result.storeId;
  }
}
