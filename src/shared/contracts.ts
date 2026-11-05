import type {
  ArtifactBinding,
  CommandBatch,
  DefinitionPackage,
  Finding,
  Project,
  ResourceRef,
  ViewDefinition,
  Views,
  ViewKind,
} from '../domain/types';
import type { ArtifactInspection } from '../validation/engine';
import type { MappingResolution, ReconciliationPreview } from '../artifacts/reconciliation';
import type { ExportPreview, ExportProfile } from '../export/generate';
import type { Proposal, SelectedScope } from '../ai/provider';
import type { SessionEvent } from './session-events';
import type { UserPreferences } from './preferences';

export interface RootInfo {
  id: string;
  label: string;
  resolved: boolean;
}
export interface RecoveryInfo {
  revision: number;
  compatible: boolean;
  message: string;
}
export interface ExternalSnapshot {
  hash: string | null;
  valid: boolean;
  revision?: number;
  message: string;
  content: string;
}
export interface SessionSnapshot {
  project: Project;
  views: Views;
  directory: string | null;
  readOnly: boolean;
  dirty: boolean;
  findings: Finding[];
  inspections: ArtifactInspection[];
  validationPending: boolean;
  validationDurationMs: number;
  roots: RootInfo[];
  notices: string[];
  canUndo: boolean;
  canRedo: boolean;
  recovery: RecoveryInfo | null;
  external: ExternalSnapshot | null;
  pendingBatches: string[];
}
export interface ResourceEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
}
export interface TextResource {
  resource: ResourceRef;
  content: string | null;
  hash: string;
  size: number;
  editable: boolean;
  reason?: string;
  eol: 'LF' | 'CRLF' | 'mixed';
  bom: boolean;
}
export interface GitMetadata {
  available: boolean;
  root?: string;
  branch?: string;
  commit?: string;
  status?: string;
  message?: string;
}
export interface DestinationDifference {
  path: string;
  status: 'new' | 'unchanged' | 'changed';
  before: string | null;
  after: string;
  expectedHash: string | null;
}
export interface ExportDestination {
  id: string;
  directory: string;
  differences: DestinationDifference[];
  preview: ExportPreview;
}
export interface BatchWrite {
  resource: ResourceRef;
  expectedHash: string | null;
  content: string;
}
export interface BatchStatus {
  id: string;
  state: 'prepared' | 'writing' | 'complete' | 'interrupted' | 'reversed';
  files: {
    resource: ResourceRef;
    expectedHash: string | null;
    afterHash: string;
    before: string | null;
    content: string;
    state: 'pending' | 'written' | 'reversed';
  }[];
  reason: string;
}
export interface LatticeBridge {
  getPreferences(): Promise<UserPreferences>;
  setPreferences(preferences: UserPreferences): Promise<UserPreferences>;
  installedFonts(): Promise<string[]>;
  snapshot(): Promise<SessionSnapshot>;
  onSessionEvent(listener: (event: SessionEvent) => void): () => void;
  newProject(name: string, purpose: string): Promise<SessionSnapshot | null>;
  openProject(): Promise<SessionSnapshot | null>;
  loadExample(kind: 'development'): Promise<SessionSnapshot>;
  execute(batch: CommandBatch): Promise<{ revision: number }>;
  previewCommands(
    batch: CommandBatch,
  ): Promise<{ revision: number; findings: Finding[]; entityCount: number }>;
  save(): Promise<SessionSnapshot>;
  undo(): Promise<SessionSnapshot>;
  redo(): Promise<SessionSnapshot>;
  saveView(view: ViewDefinition): Promise<{ revision: number }>;
  saveViewport(view: ViewKind, viewport: ViewDefinition['viewport']): Promise<{ revision: number }>;
  undoView(view: ViewKind): Promise<SessionSnapshot>;
  redoView(view: ViewKind): Promise<SessionSnapshot>;
  recover(): Promise<SessionSnapshot>;
  resolveExternal(choice: 'import' | 'keep' | 'defer'): Promise<SessionSnapshot>;
  attachRoot(label: string, existingId?: string): Promise<SessionSnapshot | null>;
  listResources(rootId: string, path: string): Promise<ResourceEntry[]>;
  readResource(resource: ResourceRef): Promise<TextResource>;
  saveResource(resource: ResourceRef, content: string, expectedHash: string): Promise<TextResource>;
  externalOpen(resource: ResourceRef): Promise<void>;
  gitMetadata(rootId: string): Promise<GitMetadata>;
  putBinding(binding: ArtifactBinding): Promise<SessionSnapshot>;
  reconcilePreview(bindingId: string): Promise<ReconciliationPreview>;
  reconcileAccept(
    preview: ReconciliationPreview,
    resolutions: Record<string, MappingResolution>,
  ): Promise<SessionSnapshot>;
  detachBinding(bindingId: string): Promise<SessionSnapshot>;
  renameCandidates(bindingId: string): Promise<ResourceRef[]>;
  confirmRename(bindingId: string, resource: ResourceRef): Promise<SessionSnapshot>;
  inspect(): Promise<SessionSnapshot>;
  batchStatuses(): Promise<BatchStatus[]>;
  resumeBatch(id: string, reverse: boolean): Promise<SessionSnapshot>;
  exportDefinitions(): Promise<DefinitionPackage>;
  importDefinitions(): Promise<SessionSnapshot | null>;
  prepareExport(
    profile: ExportProfile,
    mode: 'draft' | 'implementation-ready',
  ): Promise<ExportPreview>;
  chooseExportDestination(previewId: string): Promise<ExportDestination | null>;
  writeExport(destinationId: string): Promise<SessionSnapshot>;
  propose(prompt: string, scope: SelectedScope): Promise<Proposal>;
  cancelProposal(): Promise<void>;
  acceptProposal(proposalId: string, groups: string[]): Promise<SessionSnapshot>;
  acceptFilePatch(proposalId: string, index: number): Promise<TextResource>;
  validateNow(): Promise<SessionSnapshot>;
}
export interface LayoutRequest {
  view: ViewKind;
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string }[];
}
declare global {
  interface Window {
    lattice: LatticeBridge;
  }
}
