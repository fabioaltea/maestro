import { _electron } from '@playwright/test';
import { access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { repositoryRoot, createScratch } from './desktop.ts';
export async function launchDesktop(f: Awaited<ReturnType<typeof createScratch>>, archive: string | null = f.archive) {
  const appPath = join(repositoryRoot, 'dist-desktop');
  await access(join(appPath, 'main/index.js'));
  const launchStarted = performance.now();
  const app = await _electron.launch({ executablePath: join(repositoryRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [appPath, `--user-data-dir=${f.userData}`, ...(archive === null ? [] : [`--maestro-state-dir=${archive}`])],
    env: { HOME: archive === null ? join(f.directory, 'profile') : process.env.HOME ?? '', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', MAESTRO_NODE_BINARY: await realpath(process.execPath) }, timeout: 15_000 });
  const page = await app.firstWindow();
  await page.waitForURL('maestro://app/index.html');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('heading', { name: 'Maestro', exact: true }).waitFor();
  return { app, page, launchStarted };
}
export async function chooseDirectory(app: Awaited<ReturnType<typeof launchDesktop>>['app'], path: string) {
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, path);
}

/** Exercises the legacy transport contract without exposing archive selection in the normal renderer. */
export async function switchArchiveForRegression(app: Awaited<ReturnType<typeof launchDesktop>>['app'],
  page: Awaited<ReturnType<typeof launchDesktop>>['page'], path: string) {
  await chooseDirectory(app, path);
  const changed = await page.evaluate(async () => {
    const current = await window.maestro.context({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: 0 });
    return window.maestro.chooseArchive({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: current.selectionEpoch });
  });
  if (changed.error) throw new Error(changed.error.code);
  await page.reload();
}
