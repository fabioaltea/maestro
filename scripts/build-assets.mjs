import { copyFile, mkdir } from 'node:fs/promises';

const target = process.argv[2];
if (!['dist', 'dist-tests'].includes(target)) throw new Error('Expected dist or dist-tests');
const root = new URL('../', import.meta.url);
const relative = `${target}/${target === 'dist-tests' ? 'src/' : ''}platform/macos/git/`;
const directory = new URL(relative, root);
await mkdir(directory, { recursive: true });
await copyFile(new URL('src/platform/macos/git/inspection.sb', root), new URL('inspection.sb', directory));
