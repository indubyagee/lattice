import React, { Activity, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useEditor, edit, run, type Panel } from './store';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { FilesPanel } from './FilesPanel';
import { FindingsPanel } from './FindingsPanel';
import { ReviewPanel } from './ReviewPanel';
import { LibraryPanel } from './LibraryPanel';
import { AiPanel } from './AiPanel';
import { ExportDialog } from './ExportDialog';
import { createEntity } from '../domain/builtins';
import { VIEW_KINDS } from '../domain/types';
import './style.css';
import './refinements.css';
import { applySessionEvent } from '../shared/session-events';
import { SettingsDialog } from './SettingsDialog';
import { UserGuide } from './UserGuide';
import { TooltipLayer } from './TooltipLayer';
import { SemanticIcon } from './SemanticIcon';
import { COMPONENT_HELP, VIEW_HELP, PANEL_HELP } from './help-content';
import { kindOf } from '../domain/builtins';
import { usePreferences, loadPreferences, savePreferences } from './preferences';
import './theme.css';
import { BrandIcon } from './BrandIcon';

function App() {
  const {
    snapshot,
    setSnapshot,
    selected,
    select,
    view,
    setView,
    panel,
    setPanel,
    error,
    setError,
    setSystem,
    guideTopic,
    openGuide,
    closeGuide,
  } = useEditor();
  const [settings, setSettings] = useState(false);
  const preferences = usePreferences((s) => s.preferences),
    guideOpen = guideTopic !== null;
  const [visited, setVisited] = useState<Panel[]>(['findings']);
  useEffect(() => {
    setVisited((old) => (old.includes(panel) ? old : [...old, panel]));
  }, [panel]);
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [exporting, setExporting] = useState(false),
    [details, setDetails] = useState(false),
    [projectName, setProjectName] = useState(''),
    [purpose, setPurpose] = useState(''),
    [newDialog, setNewDialog] = useState(false),
    [leftWidth, setLeftWidth] = useState(238),
    [rightWidth, setRightWidth] = useState(300),
    [panelHeight, setPanelHeight] = useState(285);
  useEffect(() => {
    const unsubscribe = window.lattice.onSessionEvent((event) => {
      const next = applySessionEvent(useEditor.getState().snapshot, event);
      if (next) setSnapshot(next);
      else void run(async () => setSnapshot(await window.lattice.snapshot()));
    });
    void run(async () => setSnapshot(await window.lattice.snapshot()));
    return unsubscribe;
  }, [setSnapshot]);
  useEffect(() => {
    if (snapshot?.recovery) setPanel('review');
  }, [snapshot?.recovery?.revision, setPanel]);
  useEffect(() => {
    if (!exporting && !details && !settings && !guideOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
    const elements = () =>
      [
        ...(modal?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        ) ?? []),
      ].filter((e) => e.offsetParent !== null);
    elements()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExporting(false);
        setDetails(false);
        setSettings(false);
        closeGuide();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = elements(),
        first = list[0],
        last = list.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [exporting, details, settings, guideOpen]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        setSettings(false);
        setExporting(false);
        setDetails(false);
        openGuide(settings ? 'appearance' : 'start');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        closeGuide();
        setExporting(false);
        setDetails(false);
        setSettings(true);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const element = event.target as HTMLElement;
      if (event.key.toLowerCase() === 's' && !element.closest('.monaco-editor')) {
        event.preventDefault();
        void run(() => window.lattice.save());
      }
      if (element.closest('input,textarea,select,.monaco-editor')) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        void run(() => (event.shiftKey ? window.lattice.redo() : window.lattice.undo()));
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#toolbox-search')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settings, openGuide, closeGuide]);
  if (!snapshot)
    return (
      <div className="boot-screen">
        <BrandIcon />
        <h1>Lattice</h1>
        <p>Opening your local workspace…</p>
      </div>
    );
  const project = snapshot.project,
    failed = snapshot.findings.filter((f) => f.status === 'fail').length,
    unknown = snapshot.findings.filter((f) => f.status === 'unknown').length;
  const types = Object.entries(project.types).filter(([, d]) =>
    `${d.name} ${d.family}`.toLowerCase().includes(query.toLowerCase()),
  );
  const results = search.trim()
    ? Object.values(project.entities)
        .filter((e) => `${e.name} ${e.typeRef}`.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 20)
    : [];
  async function insert(reference: string) {
    const definition = project.types[reference]!,
      entity = createEntity(reference, definition.name);
    const defaults = definition.schema.properties;
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults))
      for (const [key, schema] of Object.entries(defaults)) {
        if (
          schema &&
          typeof schema === 'object' &&
          !Array.isArray(schema) &&
          schema.default !== undefined
        )
          entity.properties[key] = schema.default;
      }
    await edit([{ kind: 'create-entity', entity }], 'Insert component from toolbox');
    select([entity.id]);
  }
  const panels: Record<Panel, React.ReactNode> = {
    findings: <FindingsPanel />,
    files: <FilesPanel />,
    ai: <AiPanel />,
    review: <ReviewPanel />,
    library: <LibraryPanel />,
  };
  return (
    <main
      className="application"
      style={
        {
          '--left-width': `${leftWidth}px`,
          '--right-width': `${rightWidth}px`,
          '--panel-height': `${panelHeight}px`,
        } as React.CSSProperties
      }
    >
      <header className="app-header">
        <div className="brand">
          <BrandIcon />
          <div>
            <h1>Lattice</h1>
            <small>SYSTEM SPECIFICATION STUDIO</small>
          </div>
        </div>
        <div className="header-divider" />
        <button
          className="project-title"
          onClick={() => {
            setDetails(true);
            setNewDialog(false);
            setProjectName(project.name);
            setPurpose(project.purpose);
          }}
        >
          <strong>{project.name}</strong>
          <span>Local project ▾</span>
        </button>
        <span className="revision">
          r{project.revision}
          {snapshot.dirty ? ' · unsaved' : ''}
          {snapshot.readOnly ? ' · read-only' : ''}
        </span>
        <div className="spacer" />
        <button
          aria-label={`Switch to ${preferences.theme === 'light' ? 'dark' : 'light'} mode`}
          data-help={`Current theme: ${preferences.theme}. Switch to ${preferences.theme === 'light' ? 'dark' : 'light'} mode. This preference stays on this computer.`}
          onClick={() =>
            void run(() =>
              savePreferences({
                ...preferences,
                theme: preferences.theme === 'light' ? 'dark' : 'light',
              }),
            )
          }
        >
          {preferences.theme === 'light' ? '◐ Dark' : '◑ Light'}
        </button>
        <button onClick={() => setSettings(true)}>Settings</button>
        <button onClick={() => openGuide('start')}>User guide</button>
        <button
          onClick={() => {
            setDetails(true);
            setNewDialog(true);
            setProjectName('New system');
            setPurpose('');
          }}
        >
          New
        </button>
        <button onClick={() => void run(() => window.lattice.openProject())}>Open…</button>
        <button onClick={() => void run(() => window.lattice.save())} disabled={snapshot.readOnly}>
          Save <kbd>Ctrl S</kbd>
        </button>
        <button className="primary" onClick={() => setExporting(true)}>
          Export package ↗
        </button>
      </header>
      <div className="workspace-toolbar">
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <label className="sr-only" htmlFor="entity-search">
            Search all components
          </label>
          <input
            id="entity-search"
            placeholder="Find a component, including hidden…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {results.length > 0 && (
            <div className="search-results">
              {results.map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    select([e.id]);
                    setSystem(null);
                    const visible = VIEW_KINDS.find((v) =>
                      snapshot.views[v].appearances.some((a) => a.entityId === e.id),
                    );
                    if (visible) setView(visible);
                    setSearch('');
                  }}
                >
                  {e.name}
                  <small>{e.typeRef}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <nav className="view-tabs" aria-label="Specification views">
          {VIEW_KINDS.map((v, index) => (
            <button
              key={v}
              aria-pressed={view === v}
              data-help={VIEW_HELP[v]}
              className={view === v ? 'active' : ''}
              onClick={() => setView(v)}
            >
              <span className="tab-number">0{index + 1}</span> {v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="local-indicator">
          <i /> Local experiment
        </span>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <strong>Action needs attention:</strong> {error}
          <button aria-label="Dismiss error" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      <div className="workspace">
        <aside className="toolbox" aria-label="Component toolbox">
          <div className="section-heading">
            <h2 className="eyebrow">Components</h2>
            <button className="text-link" onClick={() => setPanel('library')}>
              Library ↗
            </button>
          </div>
          <p className="toolbox-intro">
            Build from responsibilities,
            <br />
            contracts, and connections.
          </p>
          <div className="search-field toolbox-filter">
            <label className="sr-only" htmlFor="toolbox-search">
              Insert a component
            </label>
            <input
              id="toolbox-search"
              placeholder="Find a component…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>Ctrl K</kbd>
          </div>
          <div className="toolbox-list">
            {['structure', 'purpose', 'capability', 'behavior', 'information', 'boundary'].map(
              (family) => (
                <section key={family} className={`component-group family-${family}`}>
                  <h3>
                    {family === 'boundary'
                      ? 'Boundaries & evaluation'
                      : family === 'capability'
                        ? 'Capabilities & resources'
                        : family}
                  </h3>
                  {types
                    .filter(([, d]) => d.family === family)
                    .map(([reference, d]) => (
                      <button
                        key={reference}
                        draggable={!snapshot.readOnly}
                        onDragStart={(e) =>
                          e.dataTransfer.setData('application/lattice-type', reference)
                        }
                        className="toolbox-item"
                        aria-label={`Insert ${d.name}`}
                        data-help={
                          COMPONENT_HELP[kindOf(reference)] ??
                          `${d.name}: ${d.description} Insert a typed component and edit its contract in Inspector.`
                        }
                        disabled={snapshot.readOnly}
                        onClick={() => void insert(reference)}
                      >
                        <span className={`palette-icon family-${family}`}>
                          <SemanticIcon reference={reference} family={family} />
                        </span>
                        <span>{d.name}</span>
                        <span className="insert-plus">+</span>
                      </button>
                    ))}
                </section>
              ),
            )}
          </div>
          <div className="toolbox-footer">
            <span>
              {Object.keys(project.entities).length} entities ·{' '}
              {Object.keys(project.relationships).length} relations
            </span>
            <button
              className="text-link"
              onClick={() => void run(() => window.lattice.loadExample('development'))}
            >
              Open development example
            </button>
          </div>
        </aside>
        <div className="central-workspace">
          <Canvas />
          <section className="bottom-panel">
            <nav className="panel-tabs" aria-label="Workspace panels">
              {(['findings', 'files', 'ai', 'review', 'library'] as Panel[]).map((name) => (
                <button
                  key={name}
                  className={panel === name ? 'active' : ''}
                  aria-pressed={panel === name}
                  data-help={PANEL_HELP[name]}
                  onClick={() => setPanel(name)}
                >
                  {name === 'ai' ? 'AI proposals' : name[0]!.toUpperCase() + name.slice(1)}
                  {name === 'findings' && failed + unknown > 0 && <span>{failed + unknown}</span>}
                  {name === 'review' && snapshot.pendingBatches.length > 0 && (
                    <span>{snapshot.pendingBatches.length}</span>
                  )}
                </button>
              ))}
              <div className="spacer" />
              <button
                className="history-button"
                disabled={!snapshot.canUndo || snapshot.readOnly}
                onClick={() => void run(() => window.lattice.undo())}
              >
                ↶ Undo
              </button>
              <button
                className="history-button"
                disabled={!snapshot.canRedo || snapshot.readOnly}
                onClick={() => void run(() => window.lattice.redo())}
              >
                ↷ Redo
              </button>
            </nav>
            <div className="panel-body">
              {visited.map((name) =>
                name === 'files' || name === 'library' ? (
                  <div key={name} className="panel-container" hidden={panel !== name}>
                    {panels[name]}
                  </div>
                ) : (
                  <Activity key={name} mode={panel === name ? 'visible' : 'hidden'}>
                    <div className="panel-container">{panels[name]}</div>
                  </Activity>
                ),
              )}
            </div>
          </section>
        </div>
        <Inspector />
      </div>
      <footer className="statusbar">
        <span className={`status-dot ${failed ? 'warning' : ''}`} />
        <span>
          {snapshot.validationPending
            ? 'Checking current specification…'
            : `${failed} failed · ${unknown} unknown specification checks`}
        </span>
        <span className="status-divider" />
        <span>{selected.length} selected</span>
        <div className="spacer" />
        <label>
          Toolbox width
          <input
            aria-label="Toolbox width"
            type="range"
            min="190"
            max="360"
            value={leftWidth}
            onChange={(e) => setLeftWidth(Number(e.target.value))}
          />
        </label>
        <label>
          Panel height
          <input
            aria-label="Panel height"
            type="range"
            min="200"
            max="500"
            value={panelHeight}
            onChange={(e) => setPanelHeight(Number(e.target.value))}
          />
        </label>
        <label>
          Inspector width
          <input
            aria-label="Inspector width"
            type="range"
            min="260"
            max="440"
            value={rightWidth}
            onChange={(e) => setRightWidth(Number(e.target.value))}
          />
        </label>
        <span className="status-divider" />
        <span>Specification ≠ runtime verification</span>
      </footer>
      {exporting && <ExportDialog close={() => setExporting(false)} />}
      {settings && <SettingsDialog close={() => setSettings(false)} />}
      {guideOpen && <UserGuide />}
      <TooltipLayer />
      {details && (
        <div className="modal-backdrop">
          <section
            className="small-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={newDialog ? 'New project' : 'Project details'}
          >
            <span className="eyebrow">{newDialog ? 'New local project' : 'Project details'}</span>
            <h2>Define the purpose.</h2>
            <label>
              Project name
              <input
                aria-label="Project name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                autoFocus
              />
            </label>
            <label>
              Purpose
              <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={5} />
            </label>
            <div className="button-row">
              <button
                className="primary"
                onClick={() =>
                  void run(async () => {
                    if (newDialog) await window.lattice.newProject(projectName, purpose);
                    else
                      await edit(
                        [
                          {
                            kind: 'replace-snapshot',
                            snapshot: { ...project, name: projectName, purpose },
                          },
                        ],
                        'Edit project purpose',
                      );
                    setDetails(false);
                  })
                }
              >
                {newDialog ? 'Choose project folder…' : 'Save project details'}
              </button>
              <button onClick={() => setDetails(false)}>Cancel</button>
            </div>
            <p className="muted">
              Formal structure lives in a portable model. Associated files retain their declared
              ownership.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
void loadPreferences().finally(() => createRoot(document.getElementById('root')!).render(<App />));
