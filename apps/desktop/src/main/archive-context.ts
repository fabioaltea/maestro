import { randomUUID } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import { dirname, basename, isAbsolute, join } from 'node:path';
import type { ArchiveView, PublicResult } from '../shared/bridge-contract.ts';
export interface ArchiveSelection { path: string; view: ArchiveView }
export class ArchiveContext {
  private epoch = 0;
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
    this.selection = { path: canonical, view: { selectionEpoch: ++this.epoch, archiveHandle: randomUUID(), storeId: null, displayPath: canonical } };
    return this.selection;
  }
  capture(): ArchiveSelection {
    if (!this.selection) throw new Error('STALE_CONTEXT');
    return { path: this.selection.path, view: { ...this.selection.view } };
  }
  apply(captured: ArchiveSelection, result: PublicResult) {
    if (!this.selection || captured.view.selectionEpoch !== this.selection.view.selectionEpoch) throw new Error('STALE_CONTEXT');
    if (this.selection.view.storeId && result.storeId && this.selection.view.storeId !== result.storeId) {
      this.selection = { path: this.selection.path, view: { ...this.selection.view, selectionEpoch: ++this.epoch, archiveHandle: randomUUID(), storeId: result.storeId } };
      throw new Error('STALE_CONTEXT');
    }
    if (result.storeId) this.selection.view.storeId = result.storeId;
  }
}
