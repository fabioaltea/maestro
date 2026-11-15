import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { METHODS } from '../shared/bridge-contract.ts';
import { keys, record, uuid, safeError } from '../shared/validation.ts';
export class SafeLog {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private directory: string;
  private maximum: number;
  constructor(directory: string, maximum = 2 * 1024 * 1024) { this.directory = directory; this.maximum = maximum; }
  async write(input: { code: string; action?: string; requestId?: string; durationMs?: number; operationId?: string; outcome?: string }): Promise<void> {
    keys(record(input), ['code', 'action', 'requestId', 'durationMs', 'operationId', 'outcome']);
    if (input.code !== 'OK' && safeError(input.code).code !== input.code) throw new Error('INVALID_INPUT');
    if (input.action !== undefined && !(METHODS as readonly string[]).includes(input.action)) throw new Error('INVALID_INPUT');
    if (input.requestId !== undefined) uuid(input.requestId);
    if (input.operationId !== undefined) uuid(input.operationId);
    if (input.outcome !== undefined && !['IN_PROGRESS','SUCCEEDED','FAILED','BLOCKED','INTERRUPTED'].includes(input.outcome)) throw new Error('INVALID_INPUT');
    if (input.durationMs !== undefined && (!Number.isFinite(input.durationMs) || input.durationMs < 0)) throw new Error('INVALID_INPUT');
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...input }) + '\n';
    if (this.pending >= 32 || Buffer.byteLength(line) > this.maximum) return;
    this.pending++;
    const write = async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o777) !== 0o700) throw new Error('UNAUTHORIZED');
      const path = join(this.directory, 'desktop.jsonl'), previous = `${path}.1`;
      const info = await lstat(path).catch(() => null);
      if (info && (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600)) throw new Error('UNAUTHORIZED');
      if (info && info.size + Buffer.byteLength(line) > this.maximum) {
        const old=await lstat(previous).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
        if(old&&(!old.isFile()||old.isSymbolicLink()||old.uid!==process.getuid?.()||old.nlink!==1||(old.mode&0o777)!==0o600))throw new Error('UNAUTHORIZED');
        await unlink(previous).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
        await rename(path, previous);
      }
      const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try { const opened=await file.stat();if(!opened.isFile()||opened.uid!==process.getuid?.()||opened.nlink!==1||(opened.mode&0o777)!==0o600)throw new Error('UNAUTHORIZED');await file.writeFile(line); } finally { await file.close(); }
    };
    const result = this.tail.then(write);
    this.tail = result.catch(() => undefined);
    try { await result; } finally { this.pending--; }
  }
}

export function resultLogMetadata(value:unknown):{code:string;operationId?:string;outcome?:string}{
 if(!value||typeof value!=='object'||Array.isArray(value))return{code:'OK'};
 let p=value as Record<string,unknown>;
 if(p.result&&typeof p.result==='object'&&!Array.isArray(p.result))p=p.result as Record<string,unknown>;
 const error=p.error&&typeof p.error==='object'?p.error as Record<string,unknown>:null;
 const code=error&&typeof error.code==='string'?safeError(error.code).code:'OK';
 let operationId:string|undefined;try{operationId=uuid(p.requestId);}catch{/* Read-only envelopes have no operation UUID. */}
 const outcome=typeof p.outcome==='string'&&['IN_PROGRESS','SUCCEEDED','FAILED','BLOCKED','INTERRUPTED'].includes(p.outcome)?p.outcome:undefined;
 return{code,...(operationId?{operationId}:{}),...(outcome?{outcome}:{})};
}
