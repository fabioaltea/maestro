import type { Session } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { CSP } from './security.ts';
const assets: Record<string, string> = { '/index.html': 'text/html; charset=utf-8', '/index.js': 'text/javascript; charset=utf-8', '/index.css': 'text/css; charset=utf-8' };
export async function installProtocol(session: Session, directory: string) {
  const root = await realpath(directory);
  session.protocol.handle('maestro', async request => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.host !== 'app' || url.username || url.password || !Object.hasOwn(assets, url.pathname)) return new Response(null, { status: 404 });
    try {
      const file = await realpath(join(root, url.pathname.slice(1)));
      if (relative(root, file).startsWith('..')) return new Response(null, { status: 404 });
      return new Response(await readFile(file), { headers: { 'Content-Type': assets[url.pathname]!, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response(null, { status: 404 }); }
  });
}
