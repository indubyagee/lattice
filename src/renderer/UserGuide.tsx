import { useState } from 'react';
import { GUIDE_SECTIONS } from './guide-content';
import { useEditor } from './store';
import { EDGE_LEGEND, EDGE_COLORS } from '../projection/graph-presentation';
import { usePreferences } from './preferences';
export function UserGuide() {
  const { guideTopic, openGuide, closeGuide } = useEditor(),
    [query, setQuery] = useState(''),
    theme = usePreferences((s) => s.preferences.theme);
  const matches = GUIDE_SECTIONS.filter((s) =>
    `${s.title} ${s.intro} ${s.steps.join(' ')} ${s.notes?.join(' ') ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const section = matches.find((s) => s.id === guideTopic) ?? matches[0];
  return (
    <div className="modal-backdrop">
      <section
        className="guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Lattice user guide"
      >
        <div className="panel-toolbar">
          <div>
            <span className="eyebrow">Built-in help</span>
            <h2>Lattice user guide</h2>
          </div>
          <div className="spacer" />
          <button aria-label="Close user guide" onClick={closeGuide}>
            ×
          </button>
        </div>
        <div className="guide-layout">
          <nav aria-label="Guide topics">
            <label>
              Search the guide
              <input
                type="search"
                placeholder="Try: nested, baseline, shortcuts…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="guide-topic-list">
              {matches.map((s) => (
                <button
                  key={s.id}
                  aria-current={section?.id === s.id ? 'page' : undefined}
                  className={section?.id === s.id ? 'active' : ''}
                  onClick={() => openGuide(s.id)}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </nav>
          <article className="guide-content" aria-live="polite">
            {section ? (
              <>
                <span className="eyebrow">
                  {section.id === 'start' ? 'Getting started' : 'Reference & workflow'}
                </span>
                <h2>{section.title}</h2>
                <p className="guide-intro">{section.intro}</p>
                <ol>
                  {section.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                {section.notes?.map((note, i) => (
                  <p className="guide-note" key={i}>
                    {note}
                  </p>
                ))}
                {section.id === 'diagram' && (
                  <div className="edge-legend">
                    {EDGE_LEGEND.map((item) => (
                      <div key={item.category}>
                        <span
                          className={`legend-line legend-${item.category}`}
                          style={{ borderColor: EDGE_COLORS[theme][item.category] }}
                        />
                        <strong>{item.name}</strong>
                        <p>{item.description}</p>
                        <small>{item.pattern}</small>
                      </div>
                    ))}
                  </div>
                )}
                <p className="guide-footnote">
                  All actions stay local. Design claims and recorded reviews are distinct from
                  runtime results.
                </p>
              </>
            ) : (
              <>
                <h2>No matching topics</h2>
                <p>Try a broader term such as file, view, group, review or export.</p>
              </>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
