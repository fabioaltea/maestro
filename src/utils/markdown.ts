import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';

export type ParsedMarkdown<T = Record<string, unknown>> = {
  data: T;
  content: string;
};

export function parseMarkdown<T = Record<string, unknown>>(raw: string): ParsedMarkdown<T> {
  const parsed = matter(raw);
  return { data: parsed.data as T, content: parsed.content };
}

export function readMarkdown<T = Record<string, unknown>>(path: string): ParsedMarkdown<T> {
  return parseMarkdown<T>(readFileSync(path, 'utf8'));
}

export function stringifyMarkdown(data: Record<string, unknown>, content: string): string {
  return matter.stringify(content, data);
}

/**
 * Atomic file write (write tmp, rename).
 */
export function writeFileAtomic(path: string, contents: string): void {
  const tmp = join(dirname(path), `.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, path);
}

/**
 * Append content under a markdown heading. If the heading does not exist,
 * it is appended at the end of the file. Operation is atomic on disk.
 */
export function appendUnderHeading(filePath: string, heading: string, block: string): void {
  if (!existsSync(filePath)) {
    writeFileAtomic(filePath, `${heading}\n\n${block.trim()}\n`);
    return;
  }
  const raw = readFileSync(filePath, 'utf8');
  const headingIdx = raw.indexOf(heading);
  let next: string;
  if (headingIdx === -1) {
    const sep = raw.endsWith('\n') ? '' : '\n';
    next = `${raw}${sep}\n${heading}\n\n${block.trim()}\n`;
  } else {
    const afterHeading = headingIdx + heading.length;
    // find next heading at same or higher level
    const tail = raw.slice(afterHeading);
    const nextHeadingMatch = tail.match(/\n(#{1,6})\s/);
    const insertAt = nextHeadingMatch
      ? afterHeading + (nextHeadingMatch.index ?? 0)
      : raw.length;
    const before = raw.slice(0, insertAt).replace(/\s+$/, '');
    const after = raw.slice(insertAt);
    next = `${before}\n\n${block.trim()}\n${after.startsWith('\n') ? after : `\n${after}`}`;
  }
  writeFileAtomic(filePath, next);
}
