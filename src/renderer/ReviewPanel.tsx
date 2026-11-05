import { useState } from 'react';
import { useEditor, run } from './store';
import { DiffEditor } from './Editor';
import { analyzeImpact } from '../validation/impact';
import type { MappingResolution, ReconciliationPreview } from '../artifacts/reconciliation';
import type { ResourceRef } from '../domain/types';

export function ReviewPanel() {
  const { snapshot, selected, select } = useEditor();
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null),
    [resolutions, setResolutions] = useState<Record<string, MappingResolution>>({}),
    [full, setFull] = useState(false),
    [candidates, setCandidates] = useState<Record<string, ResourceRef[]>>({});
  if (!snapshot) return null;
  const project = snapshot.project,
    impact = analyzeImpact(project, selected, full ? Number.POSITIVE_INFINITY : 3);
  return (
    <div className="review-panel">
      <div className="review-associations">
        <div className="panel-toolbar">
          <strong>Associations & recovery</strong>
          <div className="spacer" />
          <button onClick={() => void run(() => window.lattice.inspect())}>Refresh</button>
        </div>
        {snapshot.notices.length > 0 && (
          <details className="warning-box" open={snapshot.readOnly}>
            <summary>Workspace notices ({snapshot.notices.length})</summary>
            <ul>
              {snapshot.notices.map((notice, index) => (
                <li key={index}>{notice}</li>
              ))}
            </ul>
          </details>
        )}
        {snapshot.recovery && (
          <div className="warning-box">
            <strong>Interrupted project edits</strong>
            <p>
              {snapshot.recovery.message} Revision {snapshot.recovery.revision}.
            </p>
            <button
              disabled={!snapshot.recovery.compatible}
              onClick={() => void run(() => window.lattice.recover())}
            >
              Recover interrupted edits
            </button>
          </div>
        )}
        {snapshot.external && (
          <div className="warning-box">
            <strong>{snapshot.external.message}</strong>
            <DiffEditor
              before={JSON.stringify(project, null, 2)}
              after={snapshot.external.content}
              language="json"
            />
            <div className="button-row">
              <button
                disabled={!snapshot.external.valid}
                onClick={() => void run(() => window.lattice.resolveExternal('import'))}
              >
                Import external snapshot
              </button>
              <button onClick={() => void run(() => window.lattice.resolveExternal('keep'))}>
                Keep current model and preserve external copy
              </button>
              <button onClick={() => void run(() => window.lattice.resolveExternal('defer'))}>
                Defer
              </button>
            </div>
          </div>
        )}
        {snapshot.pendingBatches.map((id) => (
          <div className="warning-box" key={id}>
            <strong>Interrupted file batch</strong>
            <p className="identity">{id}</p>
            <button onClick={() => void run(() => window.lattice.resumeBatch(id, false))}>
              Resume against current hashes
            </button>
            <button onClick={() => void run(() => window.lattice.resumeBatch(id, true))}>
              Reverse if hashes still match
            </button>
          </div>
        ))}
        {Object.values(project.bindings).map((b) => (
          <div className="association-card" key={b.id}>
            <div className="section-heading">
              <strong>{b.resource.path}</strong>
              <span className="badge">{b.ownership}</span>
            </div>
            <p className="muted">
              {snapshot.inspections.find((i) => i.bindingId === b.id)?.message ?? b.state}
            </p>
            <div className="button-row">
              <button
                onClick={() =>
                  void run(async () => {
                    setPreview(await window.lattice.reconcilePreview(b.id));
                    setResolutions({});
                  })
                }
              >
                Compare / reconcile
              </button>
              <button
                onClick={() =>
                  void run(async () =>
                    setCandidates({
                      ...candidates,
                      [b.id]: await window.lattice.renameCandidates(b.id),
                    }),
                  )
                }
              >
                Find rename
              </button>
              <button onClick={() => void run(() => window.lattice.detachBinding(b.id))}>
                Detach
              </button>
            </div>
            {candidates[b.id]?.map((r) => (
              <button
                key={r.path}
                onClick={() => void run(() => window.lattice.confirmRename(b.id, r))}
              >
                Confirm unchanged resource at {r.path}
              </button>
            ))}
          </div>
        ))}
        {!Object.keys(project.bindings).length && !snapshot.recovery && !snapshot.external && (
          <div className="empty-panel">
            <h3>Changes deserve a clear review.</h3>
            <p>
              Associate a file from the Files panel to establish ownership, mappings, and an
              accepted baseline.
            </p>
          </div>
        )}
      </div>
      <div className="review-detail">
        {preview ? (
          <>
            <div className="panel-toolbar">
              <strong>
                {preview.initial ? 'Initial association review' : 'Three-way reconciliation'}
              </strong>
              <div className="spacer" />
              <button onClick={() => setPreview(null)}>Close comparison</button>
            </div>
            <p className="muted">
              Baseline → current model / current file. Unselected changes remain pending.
            </p>
            {preview.changes.map((c) => (
              <div className="mapping-change" key={c.mapping.id}>
                <strong>
                  {project.entities[c.mapping.entityId]?.name} {c.mapping.pointer}
                </strong>
                <span
                  className={`status-tag ${c.classification === 'conflict' ? 'fail' : 'unknown'}`}
                >
                  {c.classification}
                </span>
                <div className="comparison-values">
                  <div>
                    <small>Accepted baseline</small>
                    <pre>{JSON.stringify(c.baseline, null, 2)}</pre>
                  </div>
                  <div>
                    <small>Model</small>
                    <pre>{JSON.stringify(c.model, null, 2)}</pre>
                  </div>
                  <div>
                    <small>File</small>
                    <pre>{JSON.stringify(c.file, null, 2)}</pre>
                  </div>
                </div>
                {c.classification !== 'unchanged' && (
                  <details>
                    <summary>Text difference: accepted value → file value</summary>
                    <DiffEditor
                      before={
                        typeof c.baseline === 'string'
                          ? c.baseline
                          : JSON.stringify(c.baseline, null, 2)
                      }
                      after={typeof c.file === 'string' ? c.file : JSON.stringify(c.file, null, 2)}
                      language={c.mapping.format === 'json' ? 'json' : 'markdown'}
                    />
                  </details>
                )}
                <label>
                  Disposition
                  <select
                    aria-label="Mapping disposition"
                    value={resolutions[c.mapping.id]?.choice ?? 'defer'}
                    onChange={(e) =>
                      setResolutions({
                        ...resolutions,
                        [c.mapping.id]: { choice: e.target.value as MappingResolution['choice'] },
                      })
                    }
                  >
                    <option value="defer">Defer</option>
                    <option value="model">Retain model value</option>
                    <option value="file">Import supported file value</option>
                    <option value="revised">Accept revised JSON value</option>
                  </select>
                </label>
                {resolutions[c.mapping.id]?.choice === 'revised' && (
                  <label>
                    Revised value (JSON)
                    <textarea
                      defaultValue={JSON.stringify(c.model)}
                      onBlur={(e) =>
                        void run(async () =>
                          setResolutions({
                            ...resolutions,
                            [c.mapping.id]: {
                              choice: 'revised',
                              value: JSON.parse(e.target.value),
                            },
                          }),
                        )
                      }
                    />
                  </label>
                )}
              </div>
            ))}
            {!preview.changes.length && (
              <p>
                This association has no formal mappings. Accepting records the current resource
                hash.
              </p>
            )}
            <button
              className="primary"
              onClick={() =>
                void run(async () => {
                  await window.lattice.reconcileAccept(preview, resolutions);
                  setPreview(null);
                })
              }
            >
              Accept reviewed dispositions
            </button>
          </>
        ) : (
          <>
            <div className="panel-toolbar">
              <strong>Change consequences</strong>
              <div className="spacer" />
              <label className="inline-label">
                <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />{' '}
                Full affected set
              </label>
            </div>
            <p className="muted">
              Follows declared dependency meanings. Select a component to inspect its affected
              contracts and files.
            </p>
            {impact.map((item) => (
              <button className="impact-row" key={item.id} onClick={() => select([item.id])}>
                <strong>{project.entities[item.id]?.name ?? item.id}</strong>
                <span>{item.certainty}</span>
                <small>
                  {item.path
                    .map(
                      (id) =>
                        project.entities[id]?.name ?? project.relationships[id]?.typeRef ?? id,
                    )
                    .join(' → ')}
                </small>
                {item.artifacts.length > 0 && (
                  <small>
                    Associated files:{' '}
                    {item.artifacts.map((id) => project.bindings[id]?.resource.path).join(', ')}
                  </small>
                )}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
