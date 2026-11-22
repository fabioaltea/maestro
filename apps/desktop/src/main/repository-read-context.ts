import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

type View = 'history' | 'code';
type Selection = { selectionEpoch: number; activeProjectId?: string };
type Snapshot = { configRevision: string; roots: readonly string[] };
type Entry = Snapshot & { handle: string; epoch: number; projectId: string; expires: number };

export class RepositoryReadContext {
  private readonly entries = new Map<View, Entry>();
  private readonly cursors = new Map<string, { handle: string; key: string; offset: number }>();
  private readonly now: () => number;

  constructor(now = () => performance.now()) { this.now = now; }

  open(selection: Selection, view: View, snapshot: Snapshot): string {
    if (!selection.activeProjectId) throw new Error('STALE_CONTEXT');
    const handle = randomUUID();
    const previous = this.entries.get(view)?.handle;
    for (const [id, cursor] of this.cursors) if (cursor.handle === previous) this.cursors.delete(id);
    this.entries.set(view, { configRevision: snapshot.configRevision, roots: Object.freeze([...snapshot.roots]),
      handle, epoch: selection.selectionEpoch, projectId: selection.activeProjectId, expires: this.now() + 30 * 60 * 1000 });
    return handle;
  }

  read(selection: Selection, view: View, handle: string): Snapshot {
    const entry = this.entries.get(view);
    if (!entry || entry.handle !== handle || entry.epoch !== selection.selectionEpoch ||
        entry.projectId !== selection.activeProjectId || entry.expires <= this.now()) throw new Error('STALE_CONTEXT');
    return { configRevision: entry.configRevision, roots: entry.roots };
  }

  issue(handle: string, key: string, offset: number | null): string | null {
    if (offset === null) return null;
    if (this.cursors.size >= 128) this.cursors.delete(this.cursors.keys().next().value!);
    const cursor = randomUUID();
    this.cursors.set(cursor, { handle, key, offset });
    return cursor;
  }

  offset(handle: string, key: string, cursor: string): number {
    const entry = this.cursors.get(cursor);
    if (!entry || entry.handle !== handle || entry.key !== key) throw new Error('STALE_CONTEXT');
    return entry.offset;
  }

  clear() { this.entries.clear(); this.cursors.clear(); }
}
