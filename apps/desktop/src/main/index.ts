import { app, BrowserWindow, dialog, protocol, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { SafeLog } from './safe-log.ts';
import { join, isAbsolute } from 'node:path';
import { validateRuntime } from './runtime.ts';
import { CoreCli } from './core-cli.ts';
import { secureSession, secureWindow } from './security.ts';
import { installProtocol } from './protocol.ts';
import { installReads } from './read-handlers.ts';
import { installBridge } from './bridge.ts';
app.setName('Maestro');
const data = app.commandLine.getSwitchValue('user-data-dir');
if (data && isAbsolute(data)) app.setPath('userData', data);
protocol.registerSchemesAsPrivileged([{ scheme: 'maestro', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let window: BrowserWindow | null = null;
let core: CoreCli | null = null;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => core?.close());
  void app.whenReady().then(async () => {
    let runtimeError: string | null = null;
    try { core = new CoreCli(await validateRuntime(process.env.MAESTRO_NODE_BINARY ?? '', fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url)))); }
    catch (error) { runtimeError = error instanceof Error ? error.message : 'RUNTIME_UNAVAILABLE'; }
    secureSession(session.defaultSession);
    await installProtocol(session.defaultSession, fileURLToPath(new URL('../renderer/', import.meta.url)));
    window = new BrowserWindow({ width: 1280, height: 800, minWidth: 1024, minHeight: 700, title: 'Maestro', backgroundColor: '#17191c',
      webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false } });
    secureWindow(window);
    const router = installBridge(window, { core, runtimeError, log: new SafeLog(join(app.getPath('userData'), 'logs')), dialogs: { async chooseDirectory(title) {
      const result = await dialog.showOpenDialog(window!, { title, properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    } } });
    installReads(router);
    window.on('closed', () => { window = null; });
    await window.loadURL('maestro://app/index.html');
  }).catch(() => { console.error('Desktop startup unavailable.'); app.quit(); });
}
