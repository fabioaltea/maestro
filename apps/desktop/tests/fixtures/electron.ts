import { _electron } from '@playwright/test';
import { access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { repositoryRoot, createScratch } from './desktop.ts';
export async function launchDesktop(f: Awaited<ReturnType<typeof createScratch>>) {
  const appPath = join(repositoryRoot, 'dist-desktop');
  await access(join(appPath, 'main/index.js'));
  const launchStarted = performance.now();
  const app = await _electron.launch({ executablePath: join(repositoryRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [appPath, `--user-data-dir=${f.userData}`],
    env: { HOME: process.env.HOME ?? '', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', MAESTRO_NODE_BINARY: await realpath(process.execPath) }, timeout: 15_000 });
  const page = await app.firstWindow();
  await page.waitForURL('maestro://app/index.html');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('heading', { name: 'Maestro', exact: true }).waitFor();
  return { app, page, launchStarted };
}
export async function chooseDirectory(app: Awaited<ReturnType<typeof launchDesktop>>['app'], path: string) {
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, path);
}
