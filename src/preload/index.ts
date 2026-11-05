import { contextBridge, ipcRenderer } from 'electron';
import type { LatticeBridge } from '../shared/contracts';
import type { SessionEvent } from '../shared/session-events';

const methods = [
  'getPreferences',
  'setPreferences',
  'installedFonts',
  'snapshot',
  'newProject',
  'openProject',
  'loadExample',
  'execute',
  'previewCommands',
  'save',
  'undo',
  'redo',
  'saveView',
  'saveViewport',
  'undoView',
  'redoView',
  'recover',
  'resolveExternal',
  'attachRoot',
  'listResources',
  'readResource',
  'saveResource',
  'externalOpen',
  'gitMetadata',
  'putBinding',
  'reconcilePreview',
  'reconcileAccept',
  'detachBinding',
  'renameCandidates',
  'confirmRename',
  'inspect',
  'batchStatuses',
  'resumeBatch',
  'exportDefinitions',
  'importDefinitions',
  'prepareExport',
  'chooseExportDestination',
  'writeExport',
  'propose',
  'cancelProposal',
  'acceptProposal',
  'acceptFilePatch',
  'validateNow',
] as const;
const bridge: Record<string, unknown> = {};
for (const name of methods)
  bridge[name] = (...args: unknown[]) => ipcRenderer.invoke(`lattice:${name}`, ...args);
bridge.onSessionEvent = (listener: (event: SessionEvent) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, event: SessionEvent) => {
    listener(event);
  };
  ipcRenderer.on('lattice:snapshot', handler);
  return () => {
    ipcRenderer.removeListener('lattice:snapshot', handler);
  };
};
contextBridge.exposeInMainWorld('lattice', bridge as unknown as LatticeBridge);
