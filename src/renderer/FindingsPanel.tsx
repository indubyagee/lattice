import { useState } from 'react';
import { useEditor, edit, run } from './store';
import { designHash } from '../domain/hash';
import { uid, type DesignReview, type Finding } from '../domain/types';

export function FindingsPanel() {
  const { snapshot, select } = useEditor();
  const [all, setAll] = useState(false),
    [active, setActive] = useState<Finding | null>(null),
    [rationale, setRationale] = useState(''),
    [disposition, setDisposition] = useState('acknowledged');
  const [reviewTopic, setReviewTopic] = useState<DesignReview['topic']>('responsibilities'),
    [actor, setActor] = useState(''),
    [reviewRationale, setReviewRationale] = useState('');
  if (!snapshot) return null;
  const findings = snapshot.findings.filter(
    (f) => all || (f.status !== 'pass' && f.status !== 'not-applicable'),
  );
  return (
    <div className="findings-panel">
      <div className="findings-list">
        <div className="panel-toolbar">
          <strong>Specification checks</strong>
          <span className="muted">
            {snapshot.validationPending
              ? 'Checking current revision…'
              : `${snapshot.validationDurationMs.toFixed(0)} ms`}
          </span>
          <div className="spacer" />
          <label className="inline-label">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{' '}
            Include passes
          </label>
          <button onClick={() => void run(() => window.lattice.validateNow())}>Recheck</button>
        </div>
        <div className="findings-table">
          <div className="finding-header">
            <span>Status</span>
            <span>Finding</span>
            <span>Disposition</span>
          </div>
          {findings.map((f) => (
            <button
              key={f.id}
              className={`finding-row${active?.id === f.id ? ' active' : ''}`}
              onClick={() => {
                setActive(f);
                select(f.targets.filter((id) => !!snapshot.project.entities[id]));
                setRationale('');
              }}
            >
              <span className={`status-tag ${f.status}`}>
                {f.status === 'fail' ? '!' : f.status === 'unknown' ? '?' : '✓'} {f.status}
                {f.stale ? ' · stale' : ''}
              </span>
              <span>
                {f.message}
                <small>
                  {f.rule} · {f.mandatory ? 'mandatory' : 'advisory'}
                </small>
              </span>
              <span>{f.disposition}</span>
            </button>
          ))}
          {!findings.length && (
            <div className="empty-panel">
              <h3>No outstanding checks in this view.</h3>
              <p>
                Specification checks describe the design. Runtime behavior still requires
                implementation evidence.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="finding-detail">
        {active ? (
          <>
            <span className="eyebrow">Finding detail</span>
            <h3>{active.message}</h3>
            <p>
              Status: <strong>{active.status}</strong>. Disposition cannot change the computed
              result.
            </p>
            {active.evidence.length > 0 && (
              <p className="path-text">
                {active.evidence
                  .map(
                    (id) =>
                      snapshot.project.entities[id]?.name ??
                      snapshot.project.relationships[id]?.typeRef ??
                      id,
                  )
                  .join(' → ')}
              </p>
            )}
            <label>
              Disposition
              <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
                <option>open</option>
                <option>acknowledged</option>
                <option>deferred</option>
                <option>resolved</option>
              </select>
            </label>
            <label>
              Rationale
              <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} />
            </label>
            <button
              disabled={!rationale.trim()}
              onClick={() =>
                void edit(
                  [
                    {
                      kind: 'disposition',
                      findingId: active.id,
                      disposition: disposition as Finding['disposition'],
                      rationale,
                      inputHash: active.inputHash,
                    },
                  ],
                  'Record finding disposition',
                )
              }
            >
              Record disposition
            </button>
          </>
        ) : (
          <>
            <span className="eyebrow">Review coverage</span>
            <h3>Record an actual design review</h3>
            <p className="muted">
              Record your review of the current design. A recorded review is separate from an
              executed runtime check.
            </p>
            <label>
              Topic
              <select
                value={reviewTopic}
                onChange={(e) => setReviewTopic(e.target.value as DesignReview['topic'])}
              >
                {[
                  'responsibilities',
                  'interfaces',
                  'information',
                  'failure-paths',
                  'acceptance',
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Reviewer
              <input value={actor} onChange={(e) => setActor(e.target.value)} />
            </label>
            <label>
              Review rationale
              <textarea
                value={reviewRationale}
                onChange={(e) => setReviewRationale(e.target.value)}
                rows={3}
              />
            </label>
            <button
              disabled={!actor.trim() || !reviewRationale.trim()}
              onClick={() =>
                void edit(
                  [
                    {
                      kind: 'review',
                      review: {
                        id: uid(),
                        topic: reviewTopic,
                        actor,
                        rationale: reviewRationale,
                        designHash: designHash(snapshot.project),
                        at: new Date().toISOString(),
                      },
                    },
                  ],
                  'Record attributed human design review',
                )
              }
            >
              Record review for this design
            </button>
          </>
        )}
        {active && (
          <button className="text-link" onClick={() => setActive(null)}>
            Return to review coverage
          </button>
        )}
      </div>
    </div>
  );
}
