import {installReview} from './review.ts';
import {installScheduler} from './scheduler.ts';
import {installExecution} from './execution.ts';
import {installProfile} from './profile.ts';
import { app, BrowserWindow, dialog, Menu, protocol, session } from 'electron';
import { globalTools, isGlobalTool, TOOL_MENU_CHANNEL } from '../shared/tool-menu.ts';
import { fileURLToPath } from 'node:url';
import { SafeLog } from './safe-log.ts';
import { join, isAbsolute } from 'node:path';
import { archiveLocation, recoverArchiveLocation, validateRuntime } from './runtime.ts';
import { installCodex } from './codex.ts';
import { CoreCli } from './core-cli.ts';
import { secureSession, secureWindow } from './security.ts';
import { installProtocol } from './protocol.ts';
import { ClientLifecycle } from './client-lifecycle.ts';
import { installActivityStream } from './activity-bridge.ts';
import { installActivityHistory } from './activity-history.ts';
import { installProjectActions } from './project-actions.ts';
import {installEnvironment} from './environment.ts';
import {installWorkspace} from './workspace.ts';
import {installFeature} from './feature.ts';
import { installDiscovery } from './discovery.ts';
import { installLifecycle } from './lifecycle.ts';
import { installReads } from './read-handlers.ts';
import { installBridge } from './bridge.ts';
import { ArchiveContext } from './archive-context.ts';
app.setName('Maestro');
const data = app.commandLine.getSwitchValue('user-data-dir');
if (data && isAbsolute(data)) app.setPath('userData', data);
protocol.registerSchemesAsPrivileged([{ scheme: 'maestro', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let window: BrowserWindow | null = null;
let core: CoreCli | null = null;
let clients: ClientLifecycle | null = null;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { clients?.dispose(); core?.close(); });
  void app.whenReady().then(async () => {
    let runtimeError: string | null = null;
    let archive: string | null = null;
    const override = app.commandLine.getSwitchValue('maestro-state-dir');
    try {
      const runtime = await validateRuntime(process.env.MAESTRO_NODE_BINARY ?? '', fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url)));
      core = new CoreCli(runtime);
      archive = override || await archiveLocation(runtime);
    }
    catch (error) { runtimeError = error instanceof Error ? error.message : 'RUNTIME_UNAVAILABLE'; }
    secureSession(session.defaultSession);
    await installProtocol(session.defaultSession, fileURLToPath(new URL('../renderer/', import.meta.url)));
    window = new BrowserWindow({ width: 1280, height: 800, minWidth: 1024, minHeight: 700, title: 'Maestro', backgroundColor: '#17191c',
      webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false } });
    secureWindow(window);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { label: 'Strumenti', submenu: Object.entries(globalTools).flatMap(([id, label]) =>
        isGlobalTool(id) ? [{ id: `tool-${id}`, label, click: () => {
          window?.webContents.send(TOOL_MENU_CHANNEL, id);
        } }] : []) },
      { role: 'windowMenu' },
    ]));
    const router = installBridge(window, { core, runtimeError, log: new SafeLog(join(app.getPath('userData'), 'logs')), dialogs: { async chooseDirectory(title) {
      const result = await dialog.showOpenDialog(window!, { title, properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    }, async chooseFile(title) {
      const result = await dialog.showOpenDialog(window!, { title, properties: ['openFile'] }); return result.canceled ? null : result.filePaths[0] ?? null;
    }, async confirmSelection(message, detail) {
      const response = await dialog.showMessageBox(window!, { type: 'question', message, detail, buttons: ['Conferma', 'Annulla'], defaultId: 1, cancelId: 1 });
      return response.response === 0;
    } } });
    const archiveContext = installReads(router, new ArchiveContext(), Boolean(override));
    if (archive) try { const selected = await archiveContext.select(archive); router.setContext(selected.view); }
    catch { /* The repository screen reports unavailable local state. */ }
    let recoveringArchive = false;
    router.register('recoverArchive', async request => {
      if (!core) throw new Error('RUNTIME_UNAVAILABLE');
      if (override) throw new Error('ARCHIVE_RECOVERY_BLOCKED');
      if (recoveringArchive) throw new Error('LOCAL_BUSY');
      recoveringArchive = true;
      try {
        const source = await router.services.dialogs.chooseDirectory('Scegli l’archivio Maestro da recuperare');
        if (!source || !await router.services.dialogs.confirmSelection?.('Recuperare lo storico di Maestro?', source)) {
          return { context: router.context, canceled: true };
        }
        if ((router.context?.selectionEpoch ?? 0) !== request.selectionEpoch) throw new Error('STALE_CONTEXT');
        const directory = await recoverArchiveLocation(core.runtime, source);
        await core.cancelViewReads();
        router.setContext((await archiveContext.select(directory)).view);
        return { context: router.context, canceled: false };
      } finally { recoveringArchive = false; }
    });
    const lifecycle = installLifecycle(router, archiveContext, app.getPath('userData'), Boolean(override));
    installProjectActions(router, archiveContext, lifecycle.actions);
    installDiscovery(router, archiveContext, lifecycle.actions);
    installCodex(router, archiveContext, core?.runtime ?? null);
    installFeature(router,archiveContext,lifecycle.actions);
    installWorkspace(router,archiveContext,lifecycle.actions);
    installEnvironment(router,archiveContext,lifecycle.actions);
    installProfile(router,archiveContext,lifecycle.actions);
    installExecution(router,archiveContext,lifecycle.actions);
    installScheduler(router,archiveContext);
    installReview(router,archiveContext,lifecycle.actions);
    installActivityHistory(router, archiveContext);
    clients = new ClientLifecycle({ closeClient: () => core?.close(), closeRecovery: lifecycle.close, invalidateConfirmations: () => lifecycle.actions?.confirmations.clear() });
    archiveContext.onChange(() => clients?.archiveChanged());
    installActivityStream(router, archiveContext, clients, core?.runtime ?? null);
    window.webContents.once('render-process-gone', () => window?.destroy());
    window.once('closed', () => clients?.dispose());
    window.on('closed', () => { window = null; });
    await window.loadURL('maestro://app/index.html');
  }).catch(() => { console.error('Desktop startup unavailable.'); app.quit(); });
}
