import { useState } from 'react';
import type { ExportDestination } from '../shared/contracts';
import type { ExportPreview, ExportProfile } from '../export/generate';
import { run, useEditor } from './store';
import { DiffEditor, TextEditor } from './Editor';

export function ExportDialog({ close }: { close: () => void }) {
  const snapshot = useEditor((s) => s.snapshot);
  const [profile, setProfile] = useState<ExportProfile>('portable-spec@1.0.0'),
    [mode, setMode] = useState<'draft' | 'implementation-ready'>('draft'),
    [preview, setPreview] = useState<ExportPreview | null>(null),
    [destination, setDestination] = useState<ExportDestination | null>(null),
    [file, setFile] = useState('SYSTEM-SPECIFICATION.md');
  const current = preview?.files.find((f) => f.path === file);
  const difference = destination?.differences.find((d) => d.path === file);
  return (
    <div className="modal-backdrop">
      <section
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export implementation package"
      >
        <div className="panel-toolbar">
          <h2>Export an implementation package</h2>
          <div className="spacer" />
          <button onClick={close} aria-label="Close export">
            ×
          </button>
        </div>
        <div className="export-options">
          <label>
            Export profile
            <select
              value={profile}
              onChange={(e) => {
                setProfile(e.target.value as ExportProfile);
                setPreview(null);
                setDestination(null);
              }}
            >
              <option value="portable-spec@1.0.0">Portable specification</option>
              <option value="codex-workspace@1.0.0">Codex workspace</option>
            </select>
          </label>
          <label>
            Specification status
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setPreview(null);
                setDestination(null);
              }}
            >
              <option value="draft">Draft — unresolved findings included</option>
              <option value="implementation-ready">
                Implementation-ready — mandatory checks and reviews required
              </option>
            </select>
          </label>
          <button
            className="primary"
            onClick={() =>
              void run(async () => {
                setPreview(await window.lattice.prepareExport(profile, mode));
                setDestination(null);
              })
            }
          >
            Prepare preview
          </button>
        </div>
        {preview ? (
          <>
            <div className="export-summary">
              <span>Frozen revision {preview.revision}</span>
              <span>{preview.files.length} generated files</span>
              <span>
                {
                  preview.validation.findings.filter(
                    (f) => f.status === 'fail' || f.status === 'unknown',
                  ).length
                }{' '}
                unresolved checks
              </span>
              <span>{preview.exclusions.length} exclusions</span>
            </div>
            <div className="export-content">
              <nav aria-label="Generated files">
                {preview.files.map((f) => (
                  <button
                    key={f.path}
                    className={file === f.path ? 'active' : ''}
                    onClick={() => setFile(f.path)}
                  >
                    {f.path}
                    <small>
                      {destination?.differences.find((d) => d.path === f.path)?.status ??
                        `${f.content.length} chars`}
                    </small>
                  </button>
                ))}
              </nav>
              <div className="export-file">
                {difference?.status === 'changed' ? (
                  <DiffEditor
                    before={difference.before ?? ''}
                    after={difference.after}
                    language={file.endsWith('.json') ? 'json' : 'markdown'}
                  />
                ) : (
                  <TextEditor
                    value={current?.content ?? ''}
                    language={file.endsWith('.json') ? 'json' : 'markdown'}
                    readOnly
                    label="Generated export preview"
                  />
                )}
              </div>
            </div>
            <div className="export-footer">
              <p className="muted">
                {destination
                  ? `Review destination: ${destination.directory} · ${destination.differences.filter((d) => d.status === 'changed').length} existing files will change.`
                  : 'Resources are referenced by default. Local roots and baseline prose are excluded.'}
              </p>
              <div className="spacer" />
              {!destination ? (
                <button
                  onClick={() =>
                    void run(async () =>
                      setDestination(await window.lattice.chooseExportDestination(preview.id)),
                    )
                  }
                >
                  Choose destination and compare…
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={snapshot?.project.revision !== preview.revision}
                  onClick={() =>
                    void run(async () => {
                      await window.lattice.writeExport(destination.id);
                      close();
                    })
                  }
                >
                  Write reviewed package
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="empty-panel">
            <h3>Review before writing.</h3>
            <p>
              Generated sections retain model origins. Draft status and unresolved checks travel
              with the package.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
