import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import lockfile from 'proper-lockfile';
import { watch, type FSWatcher } from 'chokidar';
import type {
  ArtifactBinding,
  CommandBatch,
  Project,
  ResourceRef,
  ViewDefinition,
  Views,
  ViewKind,
} from '../domain/types';
import { uid, VIEW_KINDS } from '../domain/types';
import { createProject } from '../domain/builtins';
import { exampleProject } from '../domain/examples';
import { assertProject, ensure, object } from '../domain/integrity';
import { execute } from '../domain/commands';
import { designHash, digest, pointerGet } from '../domain/hash';
import { emptyViews, reconcileViews, assertView } from '../projection/views';
import {
  validate,
  validateDefinitionSchemas,
  type ArtifactInspection,
  type ValidationResult,
} from '../validation/engine';
import {
  previewReconciliation,
  resolveReconciliation,
  type MappingResolution,
  type ReconciliationPreview,
} from '../artifacts/reconciliation';
import { exportDefinitions, importDefinitions } from '../domain/assemblies';
import { prepareExport, type ExportPreview, type ExportProfile } from '../export/generate';
import {
  FakeProvider,
  proposalBatch,
  scopeRequest,
  type Proposal,
  type SelectedScope,
} from '../ai/provider';
import type { BatchStatus, ExportDestination, SessionSnapshot } from '../shared/contracts';
import { atomicText, hashOnDisk, readUtf8, WorkspaceFiles } from './files';

interface RecoveryJournal {
  baseHash: string | null;
  snapshot: Project;
  views: Views;
  at: string;
}
interface LocalSettings {
  roots: Record<string, string>;
  labels: Record<string, string>;
}
export class ProjectSession {
  project: Project = createProject();
  views: Views = emptyViews();
  directory: string | null = null;
  readOnly = false;
  dirty = false;
  readonly roots = new Map<string, string>();
  private labels: Record<string, string> = {};
  private loadedHash: string | null = null;
  private release: (() => Promise<void>) | null = null;
  private watcher: FSWatcher | null = null;
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private journal: RecoveryJournal | null = null;
  private external: SessionSnapshot['external'] = null;
  private notices: string[] = [];
  private validation: ValidationResult = validate(this.project);
  private inspections: ArtifactInspection[] = [];
  private worker: Worker | null = null;
  private validationSequence = 0;
  private validationPending = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private inspectTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closeTask: Promise<void> | null = null;
  private proposals = new Map<string, Proposal>();
  private aiAbort: AbortController | null = null;
  private exports = new Map<string, ExportPreview>();
  private destinations = new Map<string, ExportDestination>();
  private pendingBatches: BatchStatus[] = [];
  private viewPast: Partial<Record<ViewKind, ViewDefinition[]>> = {};
  private viewFuture: Partial<Record<ViewKind, ViewDefinition[]>> = {};
  constructor(
    readonly localDirectory: string,
    private readonly changed: (snapshot: SessionSnapshot) => void = () => {},
    workerPath?: string,
  ) {
    if (workerPath) {
      this.worker = new Worker(workerPath);
      this.worker.on(
        'message',
        (message: { id: number; result?: ValidationResult; error?: string }) => {
          if (message.id !== this.validationSequence) return;
          this.validationPending = false;
          if (message.result && message.result.revision === this.project.revision)
            this.validation = message.result;
          else if (message.error) this.notice(`Validation failed: ${message.error}`);
          this.publish();
        },
      );
      this.worker.on('error', (error) => {
        this.worker = null;
        this.validationPending = false;
        this.notice(`Validation worker unavailable: ${error.message}`);
        this.validate();
      });
    }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private writable(): void {
    ensure(!this.readOnly, 'Project is read-only; another instance holds its write lease');
  }
  private settingsPath(): string {
    return path.join(this.localDirectory, 'workspaces', this.project.id, 'roots.json');
  }
  private recoveryPath(): string {
    ensure(this.directory, 'Save the project first');
    return path.join(this.directory, '.lattice', 'recovery', 'semantic.json');
  }
  private localDraftPath(): string {
    return path.join(this.localDirectory, 'drafts', `${this.project.id}.json`);
  }
  private async writeDraft(project = this.project, views = this.views): Promise<void> {
    await atomicText(
      path.join(this.localDirectory, 'drafts', `${project.id}.json`),
      JSON.stringify({
        baseHash: null,
        snapshot: project,
        views,
        at: new Date().toISOString(),
      } satisfies RecoveryJournal),
    );
    await atomicText(
      path.join(this.localDirectory, 'drafts', 'latest.json'),
      JSON.stringify({ id: project.id }),
    );
  }
  async offerLocalDraft(): Promise<void> {
    try {
      const latest = JSON.parse(
        await fs.readFile(path.join(this.localDirectory, 'drafts', 'latest.json'), 'utf8'),
      ) as { id: string };
      ensure(/^[\w-]+$/.test(latest.id), 'Invalid draft identity');
      const journal = JSON.parse(
        await fs.readFile(path.join(this.localDirectory, 'drafts', `${latest.id}.json`), 'utf8'),
      ) as RecoveryJournal;
      assertProject(journal.snapshot);
      this.journal = journal;
      this.publish();
    } catch {
      /* No valid local draft to offer; original data is preserved. */
    }
  }
  files(): WorkspaceFiles {
    return new WorkspaceFiles(
      this.roots,
      path.join(this.localDirectory, 'workspaces', this.project.id, 'batches'),
      () => !this.readOnly,
    );
  }
  snapshot(clone = true): SessionSnapshot {
    return {
      project: clone ? structuredClone(this.project) : this.project,
      views: clone ? structuredClone(this.views) : { ...this.views },
      directory: this.directory,
      readOnly: this.readOnly,
      dirty: this.dirty,
      findings: (clone ? structuredClone(this.validation.findings) : this.validation.findings).map(
        (f) => ({
          ...f,
          stale: f.stale || f.revision !== this.project.revision,
        }),
      ),
      inspections: structuredClone(this.inspections),
      validationPending: this.validationPending,
      validationDurationMs: this.validation.durationMs,
      roots: [
        ...new Set([
          ...this.roots.keys(),
          ...Object.keys(this.portableRootLabels()),
          ...Object.values(this.project.bindings).map((b) => b.resource.rootId),
        ]),
      ].map((id) => ({
        id,
        label: this.portableRootLabels()[id] ?? this.labels[id] ?? id,
        resolved: this.roots.has(id),
      })),
      notices: [...this.notices],
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      recovery: this.journal
        ? {
            revision: this.journal.snapshot.revision,
            compatible: this.journal.baseHash === this.loadedHash,
            message:
              this.journal.baseHash === this.loadedHash
                ? 'Interrupted edits can be recovered.'
                : 'Recovery snapshot and disk baseline differ; original recovery data is preserved.',
          }
        : null,
      external: this.external ? structuredClone(this.external) : null,
      pendingBatches: this.pendingBatches
        .filter((b) => b.state === 'interrupted' || b.state === 'prepared' || b.state === 'writing')
        .map((b) => b.id),
    };
  }
  private publish(): void {
    this.changed(this.snapshot(false));
  }
  notice(message: string): void {
    this.notices = [message, ...this.notices].slice(0, 6);
    this.publish();
  }
  private async localSettings(): Promise<void> {
    await atomicText(
      this.settingsPath(),
      JSON.stringify({ roots: Object.fromEntries(this.roots), labels: this.labels }, null, 2),
    );
  }
  private portableRootLabels(): Record<string, string> {
    const value = this.project.extensions.workspaceRoots;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }
  async close(): Promise<void> {
    await this.queue;
    await this.closeInternal();
  }
  private closeInternal(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closeTask = this.performClose().catch((error) => {
      this.closeTask = null;
      throw error;
    });
    return this.closeTask;
  }
  private async performClose(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.inspectTimer) clearTimeout(this.inspectTimer);
    if (this.directory && !this.readOnly && !this.external && this.dirty)
      await this.persist().catch((error) =>
        this.notice(`Unsaved work retained in recovery journal: ${String(error)}`),
      );
    if (!this.directory && this.dirty && !this.readOnly) await this.writeDraft();
    await this.watcher?.close();
    this.watcher = null;
    if (this.release) {
      await this.release().catch(() => undefined);
      this.release = null;
    }
    this.aiAbort?.abort();
  }
  async dispose(): Promise<void> {
    await this.close();
    await this.worker?.terminate();
  }
  private async reset(project: Project, directory: string | null): Promise<void> {
    await this.closeInternal();
    this.closeTask = null;
    this.project = project;
    this.directory = directory;
    this.views = reconcileViews(project, emptyViews());
    this.readOnly = false;
    this.dirty = false;
    this.loadedHash = null;
    this.undoStack = [];
    this.redoStack = [];
    this.roots.clear();
    this.labels = {};
    this.journal = null;
    this.external = null;
    this.notices = [];
    this.proposals.clear();
    this.inspections = [];
    this.pendingBatches = [];
    this.viewPast = {};
    this.viewFuture = {};
    if (directory) {
      this.loadedHash = await hashOnDisk(path.join(directory, 'project.json'));
      try {
        this.release = await lockfile.lock(path.join(directory, 'project.json'), {
          realpath: true,
          retries: 0,
          stale: 15000,
          update: 5000,
          onCompromised: (error) => {
            this.readOnly = true;
            this.notice(`Project write lease was lost: ${error.message}`);
          },
        });
      } catch {
        this.readOnly = true;
        this.notice('Opened read-only: another process holds the project write lease.');
      }
      try {
        const settings = JSON.parse(
          await fs.readFile(this.settingsPath(), 'utf8'),
        ) as LocalSettings;
        for (const [id, root] of Object.entries(settings.roots)) this.roots.set(id, root);
        this.labels = settings.labels ?? {};
      } catch {
        /* First open or moved local settings. */
      }
      this.roots.set('project', directory);
      this.labels.project = 'Project folder';
      if (!this.readOnly) await this.localSettings();
      for (const kind of VIEW_KINDS)
        try {
          const v = JSON.parse(
            await fs.readFile(path.join(directory, 'views', `${kind}.json`), 'utf8'),
          ) as ViewDefinition;
          ensure(v.id === kind, 'View filename and identity differ');
          assertView(v, this.project, this.views);
          this.views[kind] = v;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            const source = path.join(directory, 'views', `${kind}.json`);
            if (!this.readOnly)
              await fs
                .copyFile(
                  source,
                  path.join(directory, '.lattice', 'recovery', `invalid-${kind}-${uid()}.json`),
                )
                .catch(async () => {
                  await fs.mkdir(path.join(directory, '.lattice', 'recovery'), { recursive: true });
                  await fs.copyFile(
                    source,
                    path.join(directory, '.lattice', 'recovery', `invalid-${kind}-${uid()}.json`),
                  );
                });
            this.notices.push(
              `Invalid ${kind} layout preserved; a fresh projection is in use: ${String(error)}`,
            );
          }
        }
      this.views = reconcileViews(this.project, this.views);
      try {
        const journal = JSON.parse(
          await fs.readFile(this.recoveryPath(), 'utf8'),
        ) as RecoveryJournal;
        assertProject(journal.snapshot);
        if (
          journal.snapshot.id === this.project.id &&
          journal.snapshot.revision >= this.project.revision &&
          (digest(journal.snapshot) !== digest(this.project) ||
            digest(journal.views) !== digest(this.views))
        )
          this.journal = journal;
      } catch {
        /* Missing journal is normal; malformed journals remain on disk. */
      }
      this.pendingBatches = await this.files().statuses();
      await this.watchRoots();
    }
    await this.inspectInternal();
    this.validate();
    this.publish();
  }
  async create(directory: string, name: string, purpose: string): Promise<SessionSnapshot> {
    return this.serial(async () => {
      ensure(
        typeof name === 'string' && typeof purpose === 'string',
        'Project name and purpose must be text',
      );
      await fs.mkdir(directory, { recursive: true });
      ensure(
        (await fs.readdir(directory)).filter((name) => name !== '.git').length === 0,
        'Choose an empty folder; existing contents are preserved',
      );
      ensure(
        (await hashOnDisk(path.join(directory, 'project.json'))) === null,
        'This folder already contains a project',
      );
      const p = createProject(name, purpose);
      await atomicText(
        path.join(directory, 'project.json'),
        JSON.stringify(p, null, 2) + '\n',
        null,
      );
      await this.reset(p, directory);
      return this.snapshot();
    });
  }
  async open(directory: string): Promise<SessionSnapshot> {
    return this.serial(async () => {
      if (
        this.directory &&
        path.resolve(this.directory) === path.resolve(directory) &&
        this.dirty &&
        !this.readOnly &&
        !this.external
      )
        await this.persist();
      const p: unknown = JSON.parse(
        await fs.readFile(path.join(directory, 'project.json'), 'utf8'),
      );
      assertProject(p);
      await this.reset(p, directory);
      return this.snapshot();
    });
  }
  async example(kind: 'development'): Promise<SessionSnapshot> {
    return this.serial(async () => {
      ensure(kind === 'development', 'Unknown example');
      await this.reset(exampleProject(kind), null);
      this.dirty = true;
      this.validate();
      return this.snapshot();
    });
  }
  async saveAs(directory: string): Promise<SessionSnapshot> {
    return this.serial(async () => {
      ensure(!this.directory, 'Project already has a location');
      await fs.mkdir(directory, { recursive: true });
      ensure(
        (await fs.readdir(directory)).filter((name) => name !== '.git').length === 0,
        'Choose an empty folder; existing contents are preserved',
      );
      ensure(
        (await hashOnDisk(path.join(directory, 'project.json'))) === null,
        'Destination already contains a project',
      );
      const p = this.project,
        views = this.views;
      await atomicText(
        path.join(directory, 'project.json'),
        JSON.stringify(p, null, 2) + '\n',
        null,
      );
      await this.reset(p, directory);
      this.views = views;
      this.dirty = true;
      await this.persist();
      return this.snapshot();
    });
  }
  async command(batch: CommandBatch): Promise<SessionSnapshot> {
    return this.serial(async () => {
      await this.commandInternal(batch);
      return this.snapshot();
    });
  }
  async commandWithAck(batch: CommandBatch): Promise<{ revision: number }> {
    return this.serial(async () => {
      await this.commandInternal(batch);
      return { revision: this.project.revision };
    });
  }
  previewCommands(batch: CommandBatch) {
    const next = execute(this.project, batch).project;
    const result = validate(next, this.inspections);
    return {
      revision: next.revision,
      findings: result.findings,
      entityCount: Object.keys(next.entities).length,
    };
  }
  private async commandInternal(batch: CommandBatch, history = true): Promise<void> {
    const started = performance.now(),
      timings: Record<string, number> = {};
    let previousTime = started;
    const phase = (name: string) => {
      const now = performance.now();
      timings[name] = now - previousTime;
      previousTime = now;
    };
    this.writable();
    const result = execute(this.project, batch);
    phase('domain');
    validateDefinitionSchemas(result.project);
    phase('schema');
    const views = reconcileViews(result.project, this.views);
    phase('projection');
    if (this.directory)
      await atomicText(
        this.recoveryPath(),
        JSON.stringify({
          baseHash: this.loadedHash,
          snapshot: result.project,
          views,
          at: new Date().toISOString(),
        } satisfies RecoveryJournal),
      );
    else await this.writeDraft(result.project, views);
    phase('journal');
    if (history) {
      this.undoStack.push(this.project);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    }
    this.project = result.project;
    this.views = views;
    this.dirty = true;
    this.journal = null;
    this.validate();
    phase('validationDispatch');
    this.scheduleSave();
    this.publish();
    phase('notification');
    if (process.env.LATTICE_PROFILE === '1')
      console.info(
        'LATTICE_PROFILE ' +
          JSON.stringify({
            revision: this.project.revision,
            timings,
            totalMs: performance.now() - started,
          }),
      );
  }
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.directory && !this.readOnly && !this.external)
      this.saveTimer = setTimeout(() => {
        void this.serial(async () => {
          await this.persist();
          this.publish();
        }).catch((error) => this.notice(`Save pending: ${String(error)}`));
      }, 1000);
  }
  async save(): Promise<SessionSnapshot> {
    return this.serial(async () => {
      await this.persist();
      this.publish();
      return this.snapshot();
    });
  }
  private async persist(): Promise<void> {
    this.writable();
    ensure(this.directory, 'Choose a project folder first');
    ensure(!this.external, 'Resolve the external project change before saving');
    const snapshotFile = path.join(this.directory, 'project.json');
    this.loadedHash = await atomicText(
      snapshotFile,
      JSON.stringify(this.project, null, 2) + '\n',
      this.loadedHash,
    );
    // A canonical save can finish before layout writes; retain a journal until the complete save succeeds.
    await atomicText(
      this.recoveryPath(),
      JSON.stringify({
        baseHash: this.loadedHash,
        snapshot: this.project,
        views: this.views,
        at: new Date().toISOString(),
      } satisfies RecoveryJournal),
    );
    for (const kind of VIEW_KINDS)
      await atomicText(
        path.join(this.directory, 'views', `${kind}.json`),
        JSON.stringify(this.views[kind], null, 2) + '\n',
      );
    const definitions = {
      ...this.project.types,
      ...this.project.relationTypes,
      ...this.project.assemblies,
    };
    for (const d of Object.values(definitions)) {
      const hash = digest(d),
        file = path.join(this.directory, 'definitions', `${hash}.json`);
      if ((await hashOnDisk(file)) === null)
        await atomicText(file, JSON.stringify(d, null, 2) + '\n', null);
    }
    await fs.unlink(this.recoveryPath()).catch(() => undefined);
    this.dirty = false;
    this.journal = null;
    await fs.unlink(this.localDraftPath()).catch(() => undefined);
  }
  async undo(): Promise<SessionSnapshot> {
    return this.serial(async () => {
      const previous = this.undoStack.pop();
      ensure(previous, 'Nothing to undo');
      const current = this.project;
      await this.commandInternal(
        {
          baseRevision: current.revision,
          reason: 'Undo semantic edit',
          operations: [{ kind: 'replace-snapshot', snapshot: previous }],
        },
        false,
      );
      this.redoStack.push(current);
      this.publish();
      return this.snapshot();
    });
  }
  async redo(): Promise<SessionSnapshot> {
    return this.serial(async () => {
      const next = this.redoStack.pop();
      ensure(next, 'Nothing to redo');
      const current = this.project;
      await this.commandInternal(
        {
          baseRevision: current.revision,
          reason: 'Redo semantic edit',
          operations: [{ kind: 'replace-snapshot', snapshot: next }],
        },
        false,
      );
      this.undoStack.push(current);
      this.publish();
      return this.snapshot();
    });
  }
  async saveViewport(
    kind: ViewKind,
    viewport: ViewDefinition['viewport'],
  ): Promise<{ revision: number }> {
    return this.serial(async () => {
      this.writable();
      this.views[kind] = { ...this.views[kind], viewport: structuredClone(viewport) };
      if (this.directory)
        await atomicText(
          this.recoveryPath(),
          JSON.stringify({
            baseHash: this.loadedHash,
            snapshot: this.project,
            views: this.views,
            at: new Date().toISOString(),
          } satisfies RecoveryJournal),
        );
      else await this.writeDraft();
      this.dirty = true;
      this.scheduleSave();
      this.publish();
      return { revision: this.project.revision };
    });
  }
  async saveView(view: ViewDefinition): Promise<{ revision: number }> {
    return this.serial(async () => {
      this.writable();
      assertView(view, this.project, this.views);
      ensure(
        VIEW_KINDS.includes(view.id) &&
          Array.isArray(view.appearances) &&
          Array.isArray(view.collapsedIds) &&
          object(view.viewport),
        'Invalid view',
      );
      for (const a of view.appearances)
        ensure(
          typeof a.id === 'string' &&
            !!this.project.entities[a.entityId] &&
            Number.isFinite(a.x) &&
            Number.isFinite(a.y),
          'Invalid appearance',
        );
      ensure(
        new Set(view.appearances.map((a) => a.id)).size === view.appearances.length,
        'Appearance ID collision',
      );
      this.viewPast[view.id] = [
        ...(this.viewPast[view.id] ?? []),
        structuredClone(this.views[view.id]),
      ].slice(-50);
      this.viewFuture[view.id] = [];
      this.views[view.id] = structuredClone(view);
      if (this.directory)
        await atomicText(
          this.recoveryPath(),
          JSON.stringify({
            baseHash: this.loadedHash,
            snapshot: this.project,
            views: this.views,
            at: new Date().toISOString(),
          } satisfies RecoveryJournal),
        );
      else await this.writeDraft();
      this.dirty = true;
      this.scheduleSave();
      this.publish();
      return { revision: this.project.revision };
    });
  }
  async recover(): Promise<SessionSnapshot> {
    return this.serial(async () => {
      this.writable();
      ensure(
        this.journal && this.journal.baseHash === this.loadedHash,
        'Recovery needs the original disk baseline',
      );
      if (this.directory)
        ensure(
          (await hashOnDisk(path.join(this.directory, 'project.json'))) === this.loadedHash,
          'Disk changed since recovery was offered',
        );
      this.project = this.journal.snapshot;
      this.views = reconcileViews(this.project, this.journal.views);
      this.journal = null;
      this.dirty = true;
      this.validate();
      if (this.directory) await this.persist();
      else await this.writeDraft();
      this.publish();
      return this.snapshot();
    });
  }
  async viewHistory(kind: ViewKind, redo: boolean): Promise<SessionSnapshot> {
    return this.serial(async () => {
      this.writable();
      const source = redo ? this.viewFuture : this.viewPast,
        target = redo ? this.viewPast : this.viewFuture;
      const previous = source[kind]?.pop();
      ensure(previous, 'No view layout history');
      target[kind] = [...(target[kind] ?? []), structuredClone(this.views[kind])];
      this.views[kind] = previous;
      if (this.directory)
        await atomicText(
          this.recoveryPath(),
          JSON.stringify({
            baseHash: this.loadedHash,
            snapshot: this.project,
            views: this.views,
            at: new Date().toISOString(),
          } satisfies RecoveryJournal),
        );
      else await this.writeDraft();
      this.dirty = true;
      this.scheduleSave();
      this.publish();
      return this.snapshot();
    });
  }
  async resolveExternal(choice: 'import' | 'keep' | 'defer'): Promise<SessionSnapshot> {
    return this.serial(async () => {
      ensure(this.external, 'No external change to reconcile');
      if (choice === 'defer') return this.snapshot();
      this.writable();
      ensure(this.directory, 'Project has no directory');
      const file = path.join(this.directory, 'project.json');
      ensure(
        (await hashOnDisk(file)) === this.external.hash,
        'External file changed again; refresh comparison',
      );
      await atomicText(
        path.join(this.directory, '.lattice', 'recovery', `external-${uid()}.json`),
        this.external.content,
      );
      const incoming: unknown = choice === 'import' ? JSON.parse(this.external.content) : null;
      if (choice === 'import') assertProject(incoming);
      this.loadedHash = this.external.hash;
      this.external = null;
      if (choice === 'import')
        await this.commandInternal({
          baseRevision: this.project.revision,
          reason: 'Import externally edited project snapshot',
          operations: [{ kind: 'replace-snapshot', snapshot: incoming as Project }],
        });
      else this.dirty = true;
      await this.persist();
      this.publish();
      return this.snapshot();
    });
  }
  private async watchRoots(): Promise<void> {
    await this.watcher?.close();
    this.watcher = watch([...this.roots.values()], {
      ignoreInitial: true,
      ignored: /(^|[\\/])(?:node_modules|\.git|\.lattice|definitions|views)([\\/]|$)/,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      depth: 8,
    });
    this.watcher.on('all', () => {
      if (this.inspectTimer) clearTimeout(this.inspectTimer);
      this.inspectTimer = setTimeout(() => {
        void this.serial(async () => {
          await this.detectCanonical();
          await this.inspectInternal();
          this.validate();
          this.publish();
        }).catch((error) => this.notice(`File inspection failed: ${String(error)}`));
      }, 200);
    });
    this.watcher.on('error', (error) =>
      this.notice(`File watcher unavailable: ${String(error)}; use Refresh`),
    );
  }
  private async detectCanonical(): Promise<void> {
    if (!this.directory) return;
    const file = path.join(this.directory, 'project.json'),
      hash = await hashOnDisk(file);
    if (hash === this.loadedHash) {
      this.external = null;
      return;
    }
    if (hash === null) {
      this.external = {
        hash: null,
        content: '',
        valid: false,
        message:
          'project.json is missing. Keep the current model explicitly to recreate it, or restore the file externally.',
      };
      if (this.saveTimer) clearTimeout(this.saveTimer);
      return;
    }
    const content = await readUtf8(file);
    let valid = false,
      revision: number | undefined,
      message = 'External project edit requires review';
    try {
      const parsed: unknown = JSON.parse(content);
      assertProject(parsed);
      ensure(parsed.id === this.project.id, 'External snapshot has another project identity');
      valid = true;
      revision = parsed.revision;
    } catch (error) {
      message = `Invalid external snapshot preserved: ${String(error)}`;
    }
    this.external = { hash, content, valid, revision, message };
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }
  private async inspectInternal(): Promise<void> {
    const files = this.files();
    const inspections: ArtifactInspection[] = [];
    for (const binding of Object.values(this.project.bindings)) {
      try {
        const file = await files.resolve(binding.resource);
        const hash = await hashOnDisk(file);
        const mappedChanged =
          !!binding.baseline &&
          binding.mappings.some(
            (m) =>
              digest(pointerGet(this.project.entities[m.entityId], m.pointer) ?? null) !==
              digest(binding.baseline!.values[m.id] ?? null),
          );
        const current = hash === binding.baseline?.resourceHash && !mappedChanged;
        inspections.push({
          bindingId: binding.id,
          state: current ? 'current' : 'changed',
          hash: hash ?? undefined,
          message: `${binding.resource.path}: ${current ? 'accepted content' : 'content needs association or reconciliation review'}`,
        });
      } catch (error) {
        const unresolved = !this.roots.has(binding.resource.rootId);
        inspections.push({
          bindingId: binding.id,
          state: unresolved ? 'unknown' : 'missing',
          message: `${binding.resource.path}: ${unresolved ? 'workspace root unresolved' : String(error)}`,
        });
      }
    }
    this.inspections = inspections;
  }
  async inspect(): Promise<SessionSnapshot> {
    return this.serial(async () => {
      await this.detectCanonical();
      await this.inspectInternal();
      this.validate();
      this.pendingBatches = await this.files().statuses();
      this.publish();
      return this.snapshot();
    });
  }
  private validate(): void {
    const id = ++this.validationSequence;
    if (this.worker) {
      this.validationPending = true;
      this.worker.postMessage({ id, project: this.project, inspections: this.inspections });
    } else {
      this.validation = validate(this.project, this.inspections);
      this.validationPending = false;
    }
  }
  async validateNow(): Promise<SessionSnapshot> {
    return this.serial(async () => {
      await this.inspectInternal();
      this.validationSequence++;
      this.validation = validate(this.project, this.inspections);
      this.validationPending = false;
      this.publish();
      return this.snapshot();
    });
  }
  async attachRoot(root: string, label: string, existingId?: string): Promise<SessionSnapshot> {
    return this.serial(async () => {
      this.writable();
      const canonicalRoot = await fs.realpath(root);
      ensure((await fs.stat(canonicalRoot)).isDirectory(), 'Root must be a directory');
      const id = existingId ?? uid();
      const rootLabel = label || this.portableRootLabels()[id] || path.basename(canonicalRoot);
      if (this.portableRootLabels()[id] !== rootLabel) {
        const snapshot = {
          ...this.project,
          extensions: {
            ...this.project.extensions,
            workspaceRoots: { ...this.portableRootLabels(), [id]: rootLabel },
          },
        };
        await this.commandInternal({
          baseRevision: this.project.revision,
          reason: 'Declare a named workspace root',
          operations: [{ kind: 'replace-snapshot', snapshot }],
        });
      }
      this.roots.set(id, canonicalRoot);
      this.labels[id] = rootLabel;
      await this.localSettings();
      await this.watchRoots();
      await this.inspectInternal();
      this.validate();
      this.publish();
      return this.snapshot();
    });
  }
  async saveResource(resource: ResourceRef, content: string, expectedHash: string) {
    return this.serial(async () => {
      this.writable();
      const resolved = await this.files().resolve(resource);
      if (
        this.directory &&
        resolved.toLowerCase() === path.join(this.directory, 'project.json').toLowerCase()
      )
        throw new Error(
          'Canonical project content is edited through commands or external snapshot reconciliation',
        );
      const status = await this.files().prepare(
        [{ resource, content, expectedHash }],
        'Save associated text',
      );
      const result = await this.files().run(status);
      this.pendingBatches.push(result);
      const bindings = Object.values(this.project.bindings).filter(
        (b) => b.resource.rootId === resource.rootId && b.resource.path === resource.path,
      );
      if (bindings.length)
        await this.commandInternal({
          baseRevision: this.project.revision,
          reason: 'Raw text edit requires reconciliation',
          operations: bindings.map((binding) => ({
            kind: 'put-binding',
            binding: { ...binding, state: 'pending' },
          })),
        });
      await this.inspectInternal();
      this.validate();
      this.publish();
      return this.files().read(resource);
    });
  }
  async putBinding(binding: ArtifactBinding): Promise<SessionSnapshot> {
    return this.serial(async () => {
      await this.files().resolve(binding.resource);
      const state: ArtifactBinding = { ...binding, state: 'unreviewed' };
      await this.commandInternal({
        baseRevision: this.project.revision,
        reason: 'Associate artifact',
        operations: [{ kind: 'put-binding', binding: state }],
      });
      await this.inspectInternal();
      this.validate();
      return this.snapshot();
    });
  }
  async reconciliation(bindingId: string): Promise<ReconciliationPreview> {
    const binding = this.project.bindings[bindingId];
    ensure(binding, 'Binding not found');
    const file = await this.files().read(binding.resource);
    ensure(file.content !== null && file.editable, 'Mapped content must be editable UTF-8');
    return previewReconciliation(this.project, binding, file.content);
  }
  async acceptReconciliation(
    preview: ReconciliationPreview,
    resolutions: Record<string, MappingResolution>,
  ): Promise<SessionSnapshot> {
    return this.serial(async () => {
      this.writable();
      const binding = this.project.bindings[preview.bindingId];
      ensure(binding, 'Binding missing');
      const fresh = await this.reconciliation(binding.id);
      ensure(
        fresh.revision === preview.revision && fresh.resourceHash === preview.resourceHash,
        'Reconciliation is stale; compare again',
      );
      const resolved = resolveReconciliation(this.project, binding, fresh, resolutions);
      // Validate the entire semantic batch before touching any associated file.
      const batch: CommandBatch = {
        baseRevision: this.project.revision,
        reason: 'Accept artifact reconciliation',
        operations: resolved.operations,
      };
      execute(this.project, batch);
      if (resolved.content !== fresh.content) {
        const status = await this.files().prepare(
          [
            {
              resource: binding.resource,
              expectedHash: fresh.resourceHash,
              content: resolved.content,
            },
          ],
          'Accepted reconciliation',
        );
        await this.files().run(status);
      }
      await this.commandInternal(batch);
      await this.inspectInternal();
      this.validate();
      this.publish();
      return this.snapshot();
    });
  }
  async detachBinding(id: string): Promise<SessionSnapshot> {
    return this.command({
      baseRevision: this.project.revision,
      reason: 'Detach artifact association; retain file',
      operations: [{ kind: 'remove-binding', id }],
    });
  }
  async renameCandidates(id: string): Promise<ResourceRef[]> {
    const binding = this.project.bindings[id];
    ensure(binding?.baseline, 'An accepted resource hash is needed');
    return this.files().renameCandidates(binding.resource, binding.baseline.resourceHash);
  }
  async confirmRename(id: string, resource: ResourceRef): Promise<SessionSnapshot> {
    return this.serial(async () => {
      const binding = this.project.bindings[id];
      ensure(binding?.baseline, 'Binding baseline missing');
      const file = await this.files().read(resource);
      ensure(
        file.hash === binding.baseline.resourceHash,
        'Candidate content differs from the accepted baseline',
      );
      await this.commandInternal({
        baseRevision: this.project.revision,
        reason: 'Confirm unchanged resource rename',
        operations: [{ kind: 'put-binding', binding: { ...binding, resource } }],
      });
      await this.inspectInternal();
      this.validate();
      this.publish();
      return this.snapshot();
    });
  }
  async batchStatuses(): Promise<BatchStatus[]> {
    return this.files().statuses();
  }
  async resumeBatch(id: string, reverse: boolean): Promise<SessionSnapshot> {
    return this.serial(async () => {
      const status = (await this.files().statuses()).find((s) => s.id === id);
      ensure(status, 'Recovery batch missing');
      await this.files().run(status, reverse);
      this.pendingBatches = await this.files().statuses();
      await this.inspectInternal();
      this.validate();
      this.publish();
      return this.snapshot();
    });
  }
  definitionPackage() {
    return exportDefinitions(this.project);
  }
  async importPackage(content: string): Promise<SessionSnapshot> {
    const pkg: unknown = JSON.parse(content);
    return this.command({
      baseRevision: this.project.revision,
      reason: 'Import hash-verified definition package',
      operations: importDefinitions(pkg as Parameters<typeof importDefinitions>[0]),
    });
  }
  async export(
    profile: ExportProfile,
    mode: 'draft' | 'implementation-ready',
  ): Promise<ExportPreview> {
    return this.serial(async () => {
      await this.inspectInternal();
      const preview = prepareExport(
        this.project,
        profile,
        mode,
        new Date().toISOString(),
        this.inspections,
      );
      this.exports.set(preview.id, preview);
      return preview;
    });
  }
  async exportDestination(previewId: string, directory: string): Promise<ExportDestination> {
    return this.serial(async () => {
      const preview = this.exports.get(previewId);
      ensure(preview, 'Export preview expired');
      const rootId = `export-${uid()}`;
      this.roots.set(rootId, directory);
      this.labels[rootId] = 'Export destination';
      await this.localSettings();
      const files = this.files();
      const differences: ExportDestination['differences'] = [];
      for (const generated of preview.files) {
        const file = await files.resolve({ rootId, path: generated.path }, true);
        const hash = await hashOnDisk(file);
        differences.push({
          path: generated.path,
          status: hash === null ? 'new' : hash === generated.hash ? 'unchanged' : 'changed',
          before: hash === null ? null : await readUtf8(file),
          after: generated.content,
          expectedHash: hash,
        });
      }
      const result: ExportDestination = { id: uid(), directory, differences, preview };
      this.destinations.set(result.id, result);
      return result;
    });
  }
  async writeExport(id: string): Promise<SessionSnapshot> {
    return this.serial(async () => {
      this.writable();
      const destination = this.destinations.get(id);
      ensure(destination, 'Destination preview expired');
      ensure(
        destination.preview.revision === this.project.revision &&
          destination.preview.designHash === designHash(this.project),
        'Model changed; regenerate export preview',
      );
      const rootId = [...this.roots.entries()].find(
        ([, root]) => root === destination.directory,
      )?.[0];
      ensure(rootId, 'Export destination not selected');
      const changed = destination.differences.filter((d) => d.status !== 'unchanged');
      if (changed.length) {
        const status = await this.files().prepare(
          changed.map((d) => ({
            resource: { rootId, path: d.path },
            content: d.after,
            expectedHash: d.expectedHash,
          })),
          `Export ${destination.preview.id}`,
        );
        await this.files().run(status);
      }
      this.notice(`Exported ${destination.preview.files.length} files to ${destination.directory}`);
      this.destinations.delete(id);
      this.publish();
      return this.snapshot();
    });
  }
  async propose(prompt: string, scope: SelectedScope): Promise<Proposal> {
    ensure(!this.aiAbort, 'A proposal request is already running');
    this.aiAbort = new AbortController();
    try {
      for (const excerpt of scope.excerpts)
        if (excerpt.resource) {
          const current = await this.files().read(excerpt.resource);
          ensure(
            current.hash === excerpt.hash && current.content === excerpt.content,
            'Selected file changed before the proposal; reload its scope',
          );
        }
      let proposal: Proposal | undefined;
      for await (const event of new FakeProvider().propose(
        scopeRequest(this.project, prompt, scope),
        this.aiAbort.signal,
      )) {
        if (event.kind === 'progress') this.notice(event.message);
        else proposal = event.proposal;
      }
      ensure(proposal, 'Provider returned no proposal');
      this.proposals.set(proposal.id, proposal);
      return structuredClone(proposal);
    } finally {
      this.aiAbort = null;
    }
  }
  cancelProposal(): void {
    this.aiAbort?.abort();
  }
  async acceptFilePatch(id: string, index: number) {
    const proposal = this.proposals.get(id);
    ensure(proposal && Number.isInteger(index) && index >= 0, 'Proposal patch missing');
    const patch = proposal.patches[index];
    ensure(patch, 'Proposal patch missing');
    return this.saveResource(patch.resource, patch.after, patch.expectedHash);
  }
  async acceptProposal(id: string, groups: string[]): Promise<SessionSnapshot> {
    return this.serial(async () => {
      const proposal = this.proposals.get(id);
      ensure(proposal && proposal.status === 'pending', 'Proposal is not pending');
      const batch = proposalBatch(this.project, proposal, groups);
      await this.commandInternal(batch);
      proposal.status = groups.length === proposal.groups.length ? 'accepted' : 'partial';
      return this.snapshot();
    });
  }
}
