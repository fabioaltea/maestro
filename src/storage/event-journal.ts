import { createHash } from 'node:crypto';
import { constants, mkdirSync, lstatSync, readdirSync, readFileSync, openSync, closeSync, writeSync, fsyncSync, ftruncateSync, unlinkSync, renameSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import type { EventRecord } from '../ports/storage.js';
import { requireUuid, requireDecimal } from '../domain/identifiers.js';
import { EVENT_TYPES, MAX_EVENT_BYTES, MAX_EVENT_PAGE_BYTES, type EventPage } from '../protocol/messages.js';

export interface JournalOptions {
  directory: string; storeId: string; readonly?: boolean; segmentBytes?: number; budgetBytes?: number;
  checkpoint?: (point: string) => void;
}
interface Segment { name: string; first: bigint; last: bigint; size: number; allocated: number }
const namePattern = /^segment-([0-9]{20})\.journal$/;
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
export function privateDirectory(path: string, create: boolean): boolean {
  if (!isAbsolute(path)) throw new Error('UNAUTHORIZED');
  try { const s = lstatSync(path); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid!() || (s.mode & 0o777) !== 0o700) throw new Error('UNAUTHORIZED'); }
  catch (error) { if (!missing(error)) throw error; if (!create) return false; mkdirSync(path, {mode: 0o700}); }
  return true;
}
export function privateFile(path: string) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid!() || (s.mode & 0o777) !== 0o600) throw new Error('UNAUTHORIZED');
  return s;
}
function syncDirectory(path: string) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function writeAll(fd: number, bytes: Buffer, writer: (fd: number, bytes: Buffer, offset: number, length: number) => number = writeSync): void {
  for (let offset = 0; offset < bytes.length;) {
    const count = writer(fd, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(count) || count <= 0 || count > bytes.length - offset) throw new Error('PERSISTENCE_UNAVAILABLE');
    offset += count;
  }
}
export function encodeEvent(event: EventRecord): Buffer {
  if (event.protocolVersion !== 1 || !EVENT_TYPES.includes(event.type as typeof EVENT_TYPES[number])) throw new Error('INVALID_REQUEST');
  requireUuid(event.eventId); requireUuid(event.storeId); requireDecimal(event.seq);
  if (BigInt(event.seq) < 1n || BigInt(event.seq) > 9_223_372_036_854_775_807n) throw new Error('INVALID_REQUEST');
  if (event.instanceId !== null) requireUuid(event.instanceId);
  if (event.operationId !== null) requireUuid(event.operationId);
  const data = Buffer.from(JSON.stringify(event));
  if (data.length + 36 > MAX_EVENT_BYTES) throw new Error('EVENT_BACKPRESSURE');
  const frame = Buffer.alloc(36 + data.length); frame.writeUInt32BE(data.length); createHash('sha256').update(data).digest().copy(frame, 4); data.copy(frame, 36);
  return frame;
}

export function openJournal(options: JournalOptions) {
  requireUuid(options.storeId);
  const {directory} = options, writable = !options.readonly;
  const segmentBytes = options.segmentBytes ?? 64 * 1024, budgetBytes = options.budgetBytes ?? 40 * 1024 * 1024;
  if (segmentBytes < 1024 || segmentBytes > 1024 * 1024 || budgetBytes < segmentBytes * 2) throw new Error('INVALID_REQUEST');
  let signature = '', segments: Segment[] = [], high = 0n, floor = 1n;
  let partial: {file: string; offset: number; bytes: Buffer} | null = null;
  function refresh(through?: bigint) {
    if (!privateDirectory(directory, false)) { segments = []; high = 0n; return; }
    const names = readdirSync(directory).sort();
    for (const name of names) if (!namePattern.test(name) && !['retention.json', 'retention.next'].includes(name)) throw new Error('ENDPOINT_COLLISION');
    const stats = names.flatMap(name => {
      try { return [{name, info: privateFile(join(directory, name))}]; }
      catch (error) { if (missing(error)) { if (name === 'retention.next') return []; throw new Error('CURSOR_EXPIRED'); } throw error; }
    });
    const nextSignature = stats.map(s => `${s.name}:${s.info.ino}:${s.info.size}:${s.info.mtimeMs}:${s.info.ctimeMs}`).join('|') + `:${through === undefined ? 'all' : through}`;
    if (signature === nextSignature && signature !== '') return;
    let declaredFloor = 1n;
    for (const name of ['retention.json', 'retention.next']) {
      const stat = stats.find(s => s.name === name); if (!stat) continue;
      if (stat.info.size > 512) throw new Error('STATE_CORRUPT');
      if (name === 'retention.next') continue; // uncommitted temporary metadata never controls the retention floor
      let meta: {storeId: string; firstAvailable: string};
      try { meta = JSON.parse(readFileSync(join(directory, name), 'utf8')) as typeof meta; requireDecimal(meta.firstAvailable); }
      catch { throw new Error('STATE_CORRUPT'); }
      if (meta.storeId !== options.storeId) throw new Error('STATE_CORRUPT');
      if (name === 'retention.json') declaredFloor = BigInt(meta.firstAvailable);
    }
    segments = []; partial = null; high = 0n;
    const files = stats.filter(s => namePattern.test(s.name));
    for (let index = 0; index < files.length; index++) {
      const {name, info} = files[index]!;
      if (info.size > segmentBytes) throw new Error('STATE_CORRUPT');
      const named = BigInt(name.match(namePattern)![1]!);
      if (through !== undefined && named > through) continue;
      let bytes: Buffer;
      try { bytes = readFileSync(join(directory, name)); } catch (error) { if (missing(error)) throw new Error('CURSOR_EXPIRED'); throw error; }
      let offset = 0, first = 0n, last = 0n;
      while (offset < bytes.length && (through === undefined || high < through)) {
        const length = bytes.length - offset >= 4 ? bytes.readUInt32BE(offset) : null;
        if (length !== null && (length < 2 || length + 36 > MAX_EVENT_BYTES)) throw new Error('STATE_CORRUPT');
        if (length === null || offset + 36 + length > bytes.length) {
          if (index !== files.length - 1) throw new Error('STATE_CORRUPT');
          partial = {file: join(directory, name), offset, bytes: bytes.subarray(offset)}; break;
        }
        const payload = bytes.subarray(offset + 36, offset + 36 + length);
        if (!createHash('sha256').update(payload).digest().equals(bytes.subarray(offset + 4, offset + 36))) throw new Error('STATE_CORRUPT');
        let event: EventRecord;
        try { event = JSON.parse(payload.toString('utf8')) as EventRecord; encodeEvent(event); }
        catch { throw new Error('STATE_CORRUPT'); }
        const seq = BigInt(event.seq);
        if (event.storeId !== options.storeId || (high !== 0n && seq !== high + 1n)) throw new Error('STATE_CORRUPT');
        first ||= seq; last = seq; high = seq; offset += 36 + length;
      }
      const namedFirst = BigInt(name.match(namePattern)![1]!);
      if (first !== 0n && first !== namedFirst) throw new Error('STATE_CORRUPT');
      segments.push({name, first: first || namedFirst, last, size: bytes.length, allocated: info.blocks * 512});
    }
    if (segments.length && segments[0]!.first > declaredFloor) throw new Error('STATE_CORRUPT');
    floor = declaredFloor > (segments[0]?.first ?? 1n) ? declaredFloor : segments[0]?.first ?? declaredFloor;
    if (high === 0n && floor > 1n) high = floor - 1n;
    signature = nextSignature;
  }
  function persistFloor(next: bigint) {
    privateDirectory(directory, true);
    const temp = join(directory, 'retention.next');
    try { privateFile(temp); } catch (error) { if (!missing(error)) throw error; }
    const fd = openSync(temp, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeAll(fd, Buffer.from(JSON.stringify({storeId: options.storeId, firstAvailable: String(next)}))); fsyncSync(fd); options.checkpoint?.('journal.retentionPrepared'); } finally { closeSync(fd); }
    renameSync(temp, join(directory, 'retention.json')); syncDirectory(directory); floor = next;
  }
  function list(query: {after?: string; highWater?: string; limit?: number; maxBytes?: number} = {}): EventPage {
    refresh(query.highWater === undefined ? undefined : BigInt(requireDecimal(query.highWater))); const limit = query.limit ?? 100, maxBytes = Math.min(query.maxBytes ?? MAX_EVENT_PAGE_BYTES, MAX_EVENT_PAGE_BYTES);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(maxBytes) || maxBytes < MAX_EVENT_BYTES) throw new Error('INVALID_REQUEST');
    const cap = query.highWater === undefined ? high : BigInt(requireDecimal(query.highWater));
    if (cap > high) throw new Error('STATE_CORRUPT');
    // A replay cap is a committed prefix, never a pin on a segment. Retention may
    // overtake that prefix between pages; fail explicitly instead of advancing it.
    const after = query.after === undefined ? floor - 1n : BigInt(requireDecimal(query.after));
    if (cap < floor - 1n) throw new Error('CURSOR_EXPIRED');
    if (after > cap) throw new Error('INVALID_REQUEST');
    if (after < floor - 1n) throw new Error('CURSOR_EXPIRED');
    const records: EventRecord[] = []; let used = 512, truncated = false;
    outer: for (const segment of segments) {
      if (segment.last <= after || segment.first > cap) continue;
      let bytes: Buffer;
      try { privateFile(join(directory, segment.name)); bytes = readFileSync(join(directory, segment.name)); }
      catch (error) { if (missing(error)) throw new Error('CURSOR_EXPIRED'); throw error; }
      let offset = 0;
      while (offset + 36 <= bytes.length) {
        const length = bytes.readUInt32BE(offset); if (offset + 36 + length > bytes.length) break;
        const payload = bytes.subarray(offset + 36, offset + 36 + length);
        if (!createHash('sha256').update(payload).digest().equals(bytes.subarray(offset + 4, offset + 36))) throw new Error('STATE_CORRUPT');
        const event = JSON.parse(payload.toString('utf8')) as EventRecord; offset += 36 + length;
        const seq = BigInt(event.seq); if (seq <= after || seq < floor || seq > cap) continue;
        if (records.length === limit || used + length + 1 > maxBytes) { truncated = true; break outer; }
        records.push(event); used += length + 1;
        if (seq === cap) break outer;
      }
    }
    return {records, firstAvailable: String(floor), highWater: String(cap), truncated, nextAfter: records.at(-1)?.seq ?? String(after)};
  }
  function append(events: readonly EventRecord[], pendingFloor?: string) {
    if (!writable) throw new Error('UNAUTHORIZED'); refresh();
    pendingFloor ??= events[0]?.seq ?? String(high + 1n);
    if (partial) throw new Error('STATE_CORRUPT');
    privateDirectory(dirname(directory), false); privateDirectory(directory, true);
    for (const event of events) {
      const frame = encodeEvent(event), seq = BigInt(event.seq);
      if (event.storeId !== options.storeId) throw new Error('STATE_CORRUPT');
      if (seq <= high) {
        const existing = list({after: String(seq - 1n), highWater: String(seq), limit: 1}).records[0];
        if (!existing || !encodeEvent(existing).equals(frame)) throw new Error('STATE_CORRUPT');
        continue;
      }
      if (seq !== high + 1n) throw new Error('STATE_CORRUPT');
      let active = segments.at(-1);
      const rotate = !active || active.size + frame.length > segmentBytes;
      const desired = Math.max(rotate ? 0 : active!.allocated, Math.ceil(((rotate ? 0 : active!.size) + frame.length) / 4096) * 4096);
      const projected = segments.reduce((sum, s) => sum + s.allocated, 0) + desired - (rotate ? 0 : active!.allocated) + Math.min(64 * 1024, Math.floor(budgetBytes / 2));
      if (projected > budgetBytes) {
        const remove: Segment[] = []; let freed = 0;
        for (const segment of segments) {
          if (!rotate && segment === active) break;
          if (segment.last >= BigInt(pendingFloor)) break;
          remove.push(segment); freed += segment.allocated;
          if (projected - freed <= budgetBytes) break;
        }
        if (projected - freed > budgetBytes) throw new Error('EVENT_BACKPRESSURE');
        const retained = segments[remove.length]; persistFloor(retained?.first ?? seq);
        for (const segment of remove) { privateFile(join(directory, segment.name)); unlinkSync(join(directory, segment.name)); }
        segments = segments.slice(remove.length); syncDirectory(directory);
      }
      if (rotate) { active = {name: `segment-${event.seq.padStart(20, '0')}.journal`, first: seq, last: 0n, size: 0, allocated: 0}; segments.push(active); }
      const path = join(directory, active!.name);
      if (active!.size) privateFile(path);
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
      try { writeAll(fd, frame); options.checkpoint?.('journal.appended'); fsyncSync(fd); options.checkpoint?.('journal.synced'); }
      finally { closeSync(fd); }
      if (rotate) syncDirectory(directory);
      const info = privateFile(path); active!.size = info.size; active!.allocated = info.blocks * 512; active!.last = seq; high = seq;
    }
    options.checkpoint?.('journal.allocated');
    // Allocation can exceed a length-based estimate on a real filesystem. Check actual extents before acknowledgment.
    while (readdirSync(directory).reduce((sum, name) => sum + privateFile(join(directory, name)).blocks * 512, lstatSync(directory).blocks * 512) > budgetBytes) {
      const oldest = segments[0];
      if (!oldest || oldest === segments.at(-1) || oldest.last >= BigInt(pendingFloor)) throw new Error('EVENT_BACKPRESSURE');
      persistFloor(segments[1]!.first);
      privateFile(join(directory, oldest.name)); unlinkSync(join(directory, oldest.name)); segments.shift(); syncDirectory(directory);
    }
    // Own writes were validated and synced. Re-scan payloads only when another writer changes a file.
    signature = readdirSync(directory).sort().map(name => { const info = privateFile(join(directory, name));
      return `${name}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`; }).join('|') + ':all';
  }
  function recover(pending: readonly EventRecord[]) {
    if (!writable) throw new Error('UNAUTHORIZED'); refresh();
    if (partial) {
      const next = pending.find(e => BigInt(e.seq) === high + 1n);
      if (!next || !encodeEvent(next).subarray(0, partial.bytes.length).equals(partial.bytes)) throw new Error('STATE_CORRUPT');
      privateFile(partial.file); const fd = openSync(partial.file, constants.O_WRONLY | constants.O_NOFOLLOW);
      try { ftruncateSync(fd, partial.offset); fsyncSync(fd); } finally { closeSync(fd); }
      signature = ''; refresh();
    }
    append(pending);
    // Even deduplicated bytes must be synced again after an unobserved pre-sync crash.
    for (const segment of segments) {
      if (pending.some(e => BigInt(e.seq) >= segment.first && BigInt(e.seq) <= segment.last)) {
        const fd = openSync(join(directory, segment.name), constants.O_RDONLY | constants.O_NOFOLLOW);
        try { fsyncSync(fd); } finally { closeSync(fd); }
      }
    }
  }
  return {append, recover, list};
}
