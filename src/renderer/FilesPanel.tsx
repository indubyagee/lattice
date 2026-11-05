import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEditor, run } from './store';
import { DiffEditor, TextEditor } from './Editor';
import type { ResourceEntry, TextResource, GitMetadata } from '../shared/contracts';
import type { ArtifactMapping } from '../domain/types';
import { uid } from '../domain/types';

export function FilesPanel() {
  const { snapshot, selected, setPanel } = useEditor();
  const [root, setRoot] = useState(''),
    [relative, setRelative] = useState('');
  const [entries, setEntries] = useState<ResourceEntry[]>([]),
    [file, setFile] = useState<TextResource | null>(null),
    [buffer, setBuffer] = useState(''),
    [disk, setDisk] = useState<TextResource | null>(null),
    [preview, setPreview] = useState(false),
    [git, setGit] = useState<GitMetadata | null>(null);
  const [binding, setBinding] = useState(false),
    [ownership, setOwnership] = useState<'independent' | 'generated' | 'managed'>('independent'),
    [mappings, setMappings] = useState('[]');
  const [fileProjectId, setFileProjectId] = useState('');
  useEffect(() => {
    if (!file || !fileProjectId) return;
    const key = `lattice:buffer:${fileProjectId}:${file.resource.rootId}:${file.resource.path}`;
    try {
      if (buffer === file.content) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ file, buffer }));
    } catch {
      useEditor
        .getState()
        .setError('Local recovery storage is full; save or copy the unsaved text buffer.');
    }
  }, [file, buffer, fileProjectId]);
  const roots = snapshot?.roots.filter((r) => !r.id.startsWith('export-')) ?? [];
  useEffect(() => {
    setRoot(roots[0]?.id ?? '');
    setRelative('');
  }, [snapshot?.project.id]);
  useEffect(() => {
    if (!root && roots[0]) setRoot(roots[0].id);
  }, [root, roots]);
  useEffect(() => {
    if (!root) return;
    void run(async () => {
      setEntries(await window.lattice.listResources(root, relative));
      setGit(await window.lattice.gitMetadata(root));
    });
  }, [root, relative, snapshot?.project.id]);
  async function open(entry: ResourceEntry) {
    if (entry.directory) {
      setRelative(entry.path);
      return;
    }
    if (
      file &&
      buffer !== file.content &&
      !window.confirm(
        'Open another file? The unsaved buffer will remain in local recovery storage.',
      )
    )
      return;
    const result = await run(() => window.lattice.readResource({ rootId: root, path: entry.path }));
    if (result) {
      let recovered: { file: TextResource; buffer: string } | null = null;
      try {
        const raw = localStorage.getItem(
          `lattice:buffer:${snapshot!.project.id}:${result.resource.rootId}:${result.resource.path}`,
        );
        if (raw) recovered = JSON.parse(raw);
      } catch {
        /* Invalid local buffer does not replace the disk content. */
      }
      setFile(
        recovered
          ? { ...result, hash: recovered.file.hash, content: recovered.file.content }
          : result,
      );
      setBuffer(recovered?.buffer ?? result.content ?? '');
      setDisk(recovered && recovered.file.hash !== result.hash ? result : null);
      setFileProjectId(snapshot!.project.id);
      setBinding(false);
    }
  }
  async function save(content = buffer) {
    if (!file || fileProjectId !== snapshot?.project.id) return;
    const result = await run(() => window.lattice.saveResource(file.resource, content, file.hash));
    if (result) {
      setFile(result);
      setBuffer(content);
      setDisk(null);
    } else {
      const current = await run(() => window.lattice.readResource(file.resource));
      if (current && current.hash !== file.hash) setDisk(current);
    }
  }
  if (!snapshot) return null;
  const extension = file?.resource.path.split('.').at(-1)?.toLowerCase();
  const language =
    extension === 'json'
      ? 'json'
      : extension === 'ts'
        ? 'typescript'
        : extension === 'js'
          ? 'javascript'
          : extension === 'css'
            ? 'css'
            : 'markdown';
  return (
    <div className="files-panel">
      <div className="resource-explorer">
        <div className="button-row">
          <label className="sr-only" htmlFor="resource-root">
            Workspace root
          </label>
          <select
            id="resource-root"
            value={root}
            onChange={(e) => {
              setRoot(e.target.value);
              setRelative('');
            }}
          >
            <option value="">Workspace roots</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.resolved ? '' : ' (unresolved)'}
              </option>
            ))}
          </select>
          <button onClick={() => void run(() => window.lattice.attachRoot(''))}>Attach…</button>
          {root && (
            <button
              onClick={() =>
                void run(() =>
                  window.lattice.attachRoot(roots.find((r) => r.id === root)?.label ?? '', root),
                )
              }
            >
              Rebind selected root…
            </button>
          )}
        </div>
        <div className="resource-path">
          <button
            disabled={!relative}
            onClick={() => setRelative(relative.split('/').slice(0, -1).join('/'))}
          >
            ↑
          </button>
          <span>{relative || '/'}</span>
          <button
            aria-label="Refresh resources"
            onClick={() =>
              void run(async () => {
                setEntries(await window.lattice.listResources(root, relative));
                await window.lattice.inspect();
              })
            }
          >
            ↻
          </button>
        </div>
        {entries.map((entry) => (
          <button className="resource-item" key={entry.path} onClick={() => void open(entry)}>
            <span className={entry.directory ? 'folder-icon' : 'file-icon'}>
              {entry.directory ? '▸' : '·'}
            </span>
            {entry.name}
          </button>
        ))}
        {!roots.length && <p className="muted">Attach a folder to inspect and associate files.</p>}
        {git && (
          <details className="git-info">
            <summary>Repository information</summary>
            <p>{git.available ? `${git.branch} · ${git.commit?.slice(0, 9)}` : git.message}</p>
            <pre>{git.status}</pre>
          </details>
        )}
      </div>
      <div className="file-workspace">
        {file ? (
          <>
            <div className="file-toolbar">
              <strong>{file.resource.path}</strong>
              <span className="badge">
                {file.bom ? 'UTF-8 BOM' : 'UTF-8'} · {file.eol}
              </span>
              {buffer !== file.content && <span className="badge pending">Unsaved buffer</span>}
              <div className="spacer" />
              <button onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview'}</button>
              <button
                onClick={() => {
                  setBinding(!binding);
                  setMappings(
                    selected[0]
                      ? JSON.stringify(
                          [
                            {
                              id: uid(),
                              entityId: selected[0],
                              pointer: '/name',
                              format: extension === 'json' ? 'json' : 'markdown',
                              locator: extension === 'json' ? '/name' : 'component-name',
                            },
                          ],
                          null,
                          2,
                        )
                      : '[]',
                  );
                }}
              >
                Associate…
              </button>
              <button onClick={() => void run(() => window.lattice.externalOpen(file.resource))}>
                Show in Explorer
              </button>
              <button
                className="primary"
                disabled={
                  !file.editable ||
                  snapshot.readOnly ||
                  buffer === file.content ||
                  fileProjectId !== snapshot.project.id
                }
                onClick={() => void save()}
              >
                Save file
              </button>
            </div>
            {fileProjectId !== snapshot.project.id && (
              <div className="buffer-notice">
                This preserved buffer belongs to another project. Reopen the resource in its project
                before saving.
              </div>
            )}
            {disk && (
              <div className="warning-box">
                <strong>Disk changed since this buffer was loaded.</strong>
                <p>The save was stopped. Compare the current disk version with your buffer.</p>
                <button
                  onClick={() => {
                    setFile(disk);
                    setBuffer(disk.content ?? '');
                    setDisk(null);
                  }}
                >
                  Load disk version
                </button>
                <button onClick={() => setDisk(null)}>Keep editing buffer</button>
                <DiffEditor
                  before={disk.content ?? '[binary or unsupported]'}
                  after={buffer}
                  language={language}
                />
              </div>
            )}
            {binding && (
              <div className="binding-form">
                <h3>Associate artifact with selected entities</h3>
                <label>
                  Content ownership
                  <select
                    value={ownership}
                    onChange={(e) => setOwnership(e.target.value as typeof ownership)}
                  >
                    <option value="independent">Independent — file owns content</option>
                    <option value="generated">Generated — model owns declared content</option>
                    <option value="managed">Managed sections — file owns surrounding text</option>
                  </select>
                </label>
                <label>
                  Mappings (JSON)
                  <textarea
                    className="json-input"
                    value={mappings}
                    onChange={(e) => setMappings(e.target.value)}
                    rows={5}
                  />
                </label>
                <p className="muted">
                  Markdown mappings need matching{' '}
                  <code>&lt;!-- lattice:begin component-name --&gt;</code> and{' '}
                  <code>&lt;!-- lattice:end component-name --&gt;</code> markers. JSON mappings use
                  JSON Pointers. Initial association requires review.
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    void run(async () => {
                      const parsed: unknown = JSON.parse(mappings);
                      if (!Array.isArray(parsed)) throw new Error('Mappings must be an array');
                      await window.lattice.putBinding({
                        id: uid(),
                        resource: file.resource,
                        entityIds: selected,
                        ownership,
                        mappings: parsed as ArtifactMapping[],
                        state: 'unreviewed',
                      });
                      setBinding(false);
                      setPanel('review');
                    })
                  }
                >
                  Create association
                </button>
              </div>
            )}
            {!file.editable ? (
              <div className="empty-panel">
                <h3>Metadata view</h3>
                <p>{file.reason}</p>
                <p>
                  {file.size.toLocaleString()} bytes · SHA-256 {file.hash}
                </p>
              </div>
            ) : preview ? (
              <article className="markdown-preview">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    img: () => <span>[image omitted from local preview]</span>,
                    a: ({ children }) => <span>{children}</span>,
                  }}
                >
                  {buffer}
                </ReactMarkdown>
              </article>
            ) : (
              <TextEditor
                value={buffer}
                onChange={setBuffer}
                onSave={(content) => void save(content)}
                language={language}
                readOnly={snapshot.readOnly}
                label="Associated file editor"
              />
            )}
          </>
        ) : (
          <div className="empty-panel">
            <h3>Files retain their ownership.</h3>
            <p>
              Open a resource to inspect or edit it. Associated changes are reviewed explicitly
              against an accepted baseline.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
