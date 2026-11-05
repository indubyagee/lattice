import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  nativeTheme,
  nativeImage,
} from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ProjectSession } from './session';
import { atomicText, hashOnDisk } from './files';
import { sessionEvent } from '../shared/session-events';
import type { SessionSnapshot } from '../shared/contracts';
import { ensure, object } from '../domain/integrity';
import type { ArtifactBinding, CommandBatch, ResourceRef, ViewDefinition } from '../domain/types';
import type { MappingResolution, ReconciliationPreview } from '../artifacts/reconciliation';
import type { ExportProfile } from '../export/generate';
import type { SelectedScope } from '../ai/provider';
import { PreferencesService, installedFonts } from './preferences';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.env.LATTICE_TEST_HOME) app.setPath('userData', process.env.LATTICE_TEST_HOME);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let window: BrowserWindow | null = null;
let session: ProjectSession;
let closing = false;
let preferenceService: PreferencesService | undefined;
const preferences = () => (preferenceService ??= new PreferencesService(app.getPath('userData')));
const windowIcon = (theme: 'light' | 'dark') =>
  nativeImage
    .createFromPath(
      path.join(
        app.isPackaged ? process.resourcesPath : path.resolve(here, '../../public'),
        'icons',
        `icon-on-${theme}-256.png`,
      ),
    )
    .resize({ width: 256, height: 256 });
const text = (v: unknown, max = 200000): string => {
  ensure(typeof v === 'string' && v.length <= max, 'Expected bounded text');
  return v;
};
const resource = (v: unknown): ResourceRef => {
  ensure(
    object(v) && typeof v.rootId === 'string' && typeof v.path === 'string',
    'Invalid resource reference',
  );
  return { rootId: v.rootId, path: v.path };
};
const strings = (v: unknown): string[] => {
  ensure(
    Array.isArray(v) && v.length <= 5000 && v.every((s) => typeof s === 'string'),
    'Expected a list of IDs',
  );
  return v;
};
async function folder(title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog(window!, {
    title,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
async function confirmSwitch(): Promise<boolean> {
  if (!session.snapshot().dirty) return true;
  const result = await dialog.showMessageBox(window!, {
    type: 'question',
    title: 'Switch project',
    message: session.directory
      ? 'Current edits will be saved when switching.'
      : 'This example has unsaved changes. Switch without saving it?',
    buttons: ['Cancel', 'Switch project'],
    defaultId: 0,
    cancelId: 0,
  });
  return result.response === 1;
}
function register(name: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(`lattice:${name}`, async (event, ...args: unknown[]) => {
    ensure(
      window &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame,
      'Untrusted IPC sender',
    );
    const origin = new URL(event.senderFrame.url);
    const dev = process.env.ELECTRON_RENDERER_URL;
    ensure(
      (origin.protocol === 'app:' && origin.hostname === 'lattice') ||
        (!!dev && origin.origin === new URL(dev).origin),
      'Untrusted IPC origin',
    );
    try {
      return await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.notice(message);
      throw new Error(message);
    }
  });
}
function handlers(): void {
  register('getPreferences', () => preferences().read());
  register('installedFonts', () => installedFonts());
  register('setPreferences', async (value) => {
    const p = await preferences().write(value);
    nativeTheme.themeSource = p.theme;
    window?.setBackgroundColor(p.colors[p.theme].background);
    window?.setIcon(windowIcon(p.theme));
    return p;
  });
  register('snapshot', () => session.snapshot());
  register('newProject', async (name, purpose) => {
    if (!(await confirmSwitch())) return null;
    const root = await folder('Create a Lattice project in an empty folder');
    return root ? session.create(root, text(name, 500), text(purpose, 20000)) : null;
  });
  register('openProject', async () => {
    if (!(await confirmSwitch())) return null;
    const root = await folder('Open a folder containing project.json');
    return root ? session.open(root) : null;
  });
  register('loadExample', async (kind) => {
    ensure(kind === 'development', 'Unknown example');
    if (!(await confirmSwitch())) return session.snapshot();
    return session.example(kind);
  });
  register('execute', (batch) => session.commandWithAck(batch as CommandBatch));
  register('previewCommands', (batch) => session.previewCommands(batch as CommandBatch));
  register('save', async () => {
    if (!session.directory) {
      const root = await folder('Save Lattice project');
      return root ? session.saveAs(root) : session.snapshot();
    }
    return session.save();
  });
  register('undo', () => session.undo());
  register('redo', () => session.redo());
  register('saveView', (view) => session.saveView(view as ViewDefinition));
  register('saveViewport', (view, viewport) => {
    ensure(
      ['architecture', 'behavior', 'information', 'validation'].includes(String(view)) &&
        object(viewport) &&
        typeof viewport.x === 'number' &&
        typeof viewport.y === 'number' &&
        typeof viewport.zoom === 'number' &&
        Number.isFinite(viewport.x) &&
        Number.isFinite(viewport.y) &&
        Number.isFinite(viewport.zoom) &&
        viewport.zoom > 0,
      'Invalid viewport',
    );
    return session.saveViewport(
      view as ViewDefinition['id'],
      viewport as ViewDefinition['viewport'],
    );
  });
  register('recover', () => session.recover());
  register('undoView', (view) => {
    ensure(
      ['architecture', 'behavior', 'information', 'validation'].includes(String(view)),
      'Unknown view',
    );
    return session.viewHistory(view as ViewDefinition['id'], false);
  });
  register('redoView', (view) => {
    ensure(
      ['architecture', 'behavior', 'information', 'validation'].includes(String(view)),
      'Unknown view',
    );
    return session.viewHistory(view as ViewDefinition['id'], true);
  });
  register('resolveExternal', (choice) => {
    ensure(
      choice === 'import' || choice === 'keep' || choice === 'defer',
      'Invalid reconciliation choice',
    );
    return session.resolveExternal(choice);
  });
  register('attachRoot', async (label, existingId) => {
    const root = await folder('Attach a workspace root');
    return root
      ? session.attachRoot(
          root,
          text(label, 500),
          existingId === undefined ? undefined : text(existingId, 100),
        )
      : null;
  });
  register('listResources', (id, relative) =>
    session.files().list(text(id, 100), text(relative, 2000)),
  );
  register('readResource', (r) => session.files().read(resource(r)));
  register('saveResource', (r, content, hash) =>
    session.saveResource(resource(r), text(content, 6 * 1024 * 1024), text(hash, 64)),
  );
  register('externalOpen', async (r) => {
    const file = await session.files().resolve(resource(r));
    shell.showItemInFolder(file);
  });
  register('gitMetadata', (id) => session.files().git(text(id, 100)));
  register('putBinding', (b) => session.putBinding(b as ArtifactBinding));
  register('reconcilePreview', (id) => session.reconciliation(text(id, 100)));
  register('reconcileAccept', (preview, resolutions) => {
    ensure(object(preview) && object(resolutions), 'Invalid reconciliation request');
    return session.acceptReconciliation(
      preview as unknown as ReconciliationPreview,
      resolutions as Record<string, MappingResolution>,
    );
  });
  register('detachBinding', (id) => session.detachBinding(text(id, 100)));
  register('renameCandidates', (id) => session.renameCandidates(text(id, 100)));
  register('confirmRename', (id, r) => session.confirmRename(text(id, 100), resource(r)));
  register('inspect', () => session.inspect());
  register('validateNow', () => session.validateNow());
  register('batchStatuses', () => session.batchStatuses());
  register('resumeBatch', (id, reverse) => {
    ensure(typeof reverse === 'boolean', 'Invalid batch disposition');
    return session.resumeBatch(text(id, 100), reverse);
  });
  register('exportDefinitions', async () => {
    const pkg = session.definitionPackage();
    const result = await dialog.showSaveDialog(window!, {
      title: 'Export reusable definitions',
      defaultPath: 'definitions.lattice-package.json',
      filters: [{ name: 'Lattice package', extensions: ['json'] }],
    });
    if (!result.canceled && result.filePath) {
      const hash = await hashOnDisk(result.filePath);
      if (hash !== null) {
        const answer = await dialog.showMessageBox(window!, {
          type: 'question',
          message: 'Replace the selected definition package?',
          buttons: ['Cancel', 'Replace'],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response !== 1) return pkg;
      }
      await atomicText(result.filePath, JSON.stringify(pkg, null, 2) + '\n', hash);
    }
    return pkg;
  });
  register('importDefinitions', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Import hash-verified Lattice definitions',
      properties: ['openFile'],
      filters: [{ name: 'Lattice package', extensions: ['json'] }],
    });
    return !result.canceled && result.filePaths[0]
      ? session.importPackage(await fs.readFile(result.filePaths[0], 'utf8'))
      : null;
  });
  register('prepareExport', (profile, mode) => {
    ensure(mode === 'draft' || mode === 'implementation-ready', 'Unknown export mode');
    return session.export(profile as ExportProfile, mode);
  });
  register('chooseExportDestination', async (id) => {
    const root = await folder('Choose export destination; differences will be reviewed');
    return root ? session.exportDestination(text(id, 100), root) : null;
  });
  register('writeExport', (id) => session.writeExport(text(id, 100)));
  register('propose', (prompt, scope) => {
    ensure(object(scope), 'Select proposal scope');
    ensure(
      Array.isArray(scope.excerpts) &&
        scope.excerpts.every(
          (e) => object(e) && typeof e.content === 'string' && typeof e.resourceLabel === 'string',
        ),
      'Invalid excerpts',
    );
    return session.propose(text(prompt, 20000), {
      entityIds: strings(scope.entityIds),
      excerpts: scope.excerpts,
    } as SelectedScope);
  });
  register('cancelProposal', () => session.cancelProposal());
  register('acceptFilePatch', (id, index) => {
    ensure(Number.isInteger(index), 'Invalid patch index');
    return session.acceptFilePatch(text(id, 100), index as number);
  });
  register('acceptProposal', (id, groups) =>
    session.acceptProposal(text(id, 100), strings(groups)),
  );
}
async function createWindow(): Promise<void> {
  const appearance = await preferences().read();
  nativeTheme.themeSource = appearance.theme;
  const renderer = path.resolve(here, '../renderer');
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'lattice') return new Response('Not found', { status: 404 });
    const file = path.resolve(
      renderer,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!file.startsWith(renderer + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  window = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    title: 'Lattice',
    backgroundColor: appearance.colors[appearance.theme].background,
    icon: windowIcon(appearance.theme),
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      webSecurity: true,
    },
  });
  let previous: SessionSnapshot | null = null;
  session = new ProjectSession(
    app.getPath('userData'),
    (snapshot) => {
      if (window && !window.isDestroyed())
        window.webContents.send('lattice:snapshot', sessionEvent(previous, snapshot));
      previous = snapshot;
    },
    path.join(here, 'validation.js'),
  );
  await session.offerLocalDraft();
  handlers();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url),
      dev = process.env.ELECTRON_RENDERER_URL;
    const allowed = dev
      ? target.origin === new URL(dev).origin
      : target.protocol === 'app:' && target.hostname === 'lattice';
    if (!allowed) event.preventDefault();
  });
  window.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    void session
      .close()
      .then(() => {
        closing = true;
        window?.close();
      })
      .catch((error) => session.notice(String(error)));
  });
  window.on('closed', () => {
    window = null;
    void session.dispose();
  });
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadURL('app://lattice/');
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    window?.restore();
    window?.focus();
  });
  void app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
