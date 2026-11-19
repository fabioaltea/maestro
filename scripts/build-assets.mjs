import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';

const target = process.argv[2];
if (!['dist', 'dist-tests'].includes(target)) throw new Error('Expected dist or dist-tests');
const root = new URL('../', import.meta.url);
// Confined Node children must resolve their ESM package metadata inside the
// shipped code root, independently of the source/test compilation depth.
const codeRoot = new URL(`${target}/${target === 'dist-tests' ? 'src/' : ''}`, root);
await mkdir(codeRoot, { recursive: true });
await writeFile(new URL('package.json', codeRoot), '{"type":"module"}\n');
const relative = `${target}/${target === 'dist-tests' ? 'src/' : ''}platform/macos/git/`;
const directory = new URL(relative, root);
await mkdir(directory, { recursive: true });
for (const name of ['inspection.sb','workspace.sb']) {
  await copyFile(new URL(`src/platform/macos/git/${name}`, root), new URL(name, directory));
}
const storage = new URL(`${target}/${target === 'dist-tests' ? 'src/' : ''}platform/macos/storage/`, root);
await mkdir(storage, { recursive: true });
await copyFile(new URL('src/platform/macos/storage/readonly.sb', root), new URL('readonly.sb', storage));
if (target === 'dist-tests') {
  const fixtures = new URL('dist-tests/tests/fixtures/', root);
  await mkdir(fixtures, { recursive: true });
  await copyFile(new URL('tests/fixtures/inspection-policy-probe.c', root), new URL('inspection-policy-probe.c', fixtures));
}

// Discovery assets are introduced incrementally; only these trusted package roots
// are inspected. No project path or provider-supplied asset is accepted.
for (const source of ['platform/macos/discovery/', 'providers/codex/']) {
  const origin = new URL(`src/${source}`, root);
  let entries;
  try { entries = await readdir(origin, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const destination = new URL(`${target}/${target === 'dist-tests' ? 'src/' : ''}${source}`, root);
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:sb|schema\.json)$/.test(entry.name)) continue;
    await mkdir(destination, { recursive: true });
    await copyFile(new URL(entry.name, origin), new URL(entry.name, destination));
  }
}
