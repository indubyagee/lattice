import { useEffect, useState } from 'react';
import { useEditor, run } from './store';
import type { Proposal } from '../ai/provider';
import type { SelectedScope } from '../ai/provider';
import { DiffEditor } from './Editor';

export function AiPanel() {
  const { snapshot, selected } = useEditor();
  const [prompt, setPrompt] = useState('Help describe the selected components.'),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [groups, setGroups] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [include, setInclude] = useState(false),
    [excerpt, setExcerpt] = useState('');
  const [preview, setPreview] = useState('');
  const [fileBinding, setFileBinding] = useState(''),
    [appliedPatches, setAppliedPatches] = useState<number[]>([]);
  useEffect(() => {
    let current = true;
    if (!proposal || !snapshot) return;
    if (proposal.status !== 'pending') {
      setPreview('Accepted command groups are recorded in the current model.');
      return;
    }
    setPreview('Checking proposed commands…');
    void window.lattice
      .previewCommands({
        baseRevision: proposal.baseRevision,
        reason: 'Preview proposal',
        operations: proposal.groups
          .filter((g) => groups.includes(g.id))
          .flatMap((g) => g.operations),
      })
      .then((result) => {
        if (current)
          setPreview(
            `${result.entityCount} entities after acceptance · ${result.findings.filter((f) => f.status === 'fail').length} failed checks · ${result.findings.filter((f) => f.status === 'unknown').length} unknown checks`,
          );
      })
      .catch((error) => {
        if (current) setPreview(String(error));
      });
    return () => {
      current = false;
    };
  }, [proposal, groups, snapshot?.project.revision]);
  if (!snapshot) return null;
  return (
    <div className="ai-panel">
      <div className="ai-compose">
        <div className="section-heading">
          <strong>Author with proposals</strong>
          <span className="badge pending">Simulated provider</span>
        </div>
        <p className="muted">
          Live AI is deferred. This deterministic demonstration makes no network requests. Your
          model changes only after acceptance.
        </p>
        <div className="scope-box">
          <strong>Selected context</strong>
          <p>
            {selected.length
              ? selected.map((id) => snapshot.project.entities[id]?.name).join(', ')
              : 'No entities selected — propose an example initial design.'}
          </p>
          <label className="inline-label">
            <input
              type="checkbox"
              checked={include}
              onChange={(e) => setInclude(e.target.checked)}
            />{' '}
            Include this explicitly chosen excerpt
          </label>
          {include && (
            <label>
              Source excerpt
              <textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={3} />
            </label>
          )}
        </div>
        <label>
          Include an associated Markdown file
          <select
            aria-label="Proposal file scope"
            value={fileBinding}
            onChange={(e) => setFileBinding(e.target.value)}
          >
            <option value="">No file selected</option>
            {Object.values(snapshot.project.bindings)
              .filter((b) => /\.md$/i.test(b.resource.path))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.resource.path}
                </option>
              ))}
          </select>
        </label>
        <label>
          Authoring request
          <textarea
            aria-label="Authoring request"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
        </label>
        <div className="button-row">
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void run(async () => {
                const excerpts: SelectedScope['excerpts'] = include
                  ? [{ resourceLabel: 'User-selected excerpt', content: excerpt }]
                  : [];
                if (fileBinding) {
                  const binding = snapshot.project.bindings[fileBinding];
                  if (!binding) throw new Error('Select a current association');
                  const file = await window.lattice.readResource(binding.resource);
                  if (file.content === null)
                    throw new Error('The chosen scope is not editable text');
                  excerpts.push({
                    resourceLabel: binding.resource.path,
                    resource: binding.resource,
                    content: file.content,
                    hash: file.hash,
                  });
                }
                const next = await window.lattice.propose(prompt, {
                  entityIds: selected,
                  excerpts,
                });
                setProposal(next);
                setAppliedPatches([]);
                setGroups(next.groups.map((g) => g.id));
              }).finally(() => setBusy(false));
            }}
          >
            {busy ? 'Preparing example…' : 'Preview simulated proposal'}
          </button>
          {busy && (
            <button onClick={() => void run(() => window.lattice.cancelProposal())}>
              Cancel request
            </button>
          )}
        </div>
      </div>
      <div className="proposal-review">
        {proposal ? (
          <>
            <div className="section-heading">
              <h3>Review proposed changes</h3>
              <span className="badge">Base revision {proposal.baseRevision}</span>
            </div>
            {proposal.reasons.map((reason, i) => (
              <p key={i}>{reason}</p>
            ))}
            {proposal.assumptions.map((a, i) => (
              <p className="warning-text" key={i}>
                Assumption: {a}
              </p>
            ))}
            {proposal.groups.map((g) => (
              <div className="proposal-group" key={g.id}>
                <label className="inline-label">
                  <input
                    type="checkbox"
                    checked={groups.includes(g.id)}
                    onChange={(e) =>
                      setGroups(
                        e.target.checked ? [...groups, g.id] : groups.filter((id) => id !== g.id),
                      )
                    }
                  />
                  <strong>{g.title}</strong>
                </label>
                {g.requires.length > 0 && <small>Requires: {g.requires.join(', ')}</small>}
                <details>
                  <summary>
                    {g.operations.length} command{g.operations.length === 1 ? '' : 's'}
                  </summary>
                  <pre>{JSON.stringify(g.operations, null, 2)}</pre>
                </details>
              </div>
            ))}
            <div className="validation-preview">{preview}</div>
            {proposal.patches.map((patch, index) => (
              <section key={index} className="proposal-group">
                <h3>File patch: {patch.resource.path}</h3>
                <p>{patch.reason}</p>
                <DiffEditor before={patch.before} after={patch.after} />
                <button
                  disabled={appliedPatches.includes(index) || snapshot.readOnly}
                  onClick={() =>
                    void run(async () => {
                      await window.lattice.acceptFilePatch(proposal.id, index);
                      setAppliedPatches([...appliedPatches, index]);
                    })
                  }
                >
                  {appliedPatches.includes(index) ? 'File patch saved' : 'Save reviewed file patch'}
                </button>
              </section>
            ))}
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || !groups.length || proposal.status !== 'pending'}
                onClick={() =>
                  void run(async () => {
                    await window.lattice.acceptProposal(proposal.id, groups);
                    setProposal({
                      ...proposal,
                      status: groups.length === proposal.groups.length ? 'accepted' : 'partial',
                    });
                  })
                }
              >
                Accept selected commands
              </button>
              <button onClick={() => setProposal(null)}>Reject / close</button>
            </div>
          </>
        ) : (
          <div className="empty-panel">
            <h3>A proposal is a reviewable change.</h3>
            <p>
              Inspect reasons, assumptions, command groups, and validation consequences before
              accepting any change.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
