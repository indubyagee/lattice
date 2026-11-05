import { useEffect, useState } from 'react';
import { useEditor, edit, renameEntity, run } from './store';
import { copySelection, deletionPreview } from '../domain/commands';
import {
  uid,
  type JsonObject,
  type JsonValue,
  type Relationship,
  type CommandBatch,
} from '../domain/types';
import { kindOf } from '../domain/builtins';
import { ContainerInspector, ParentContainerField } from './ContainerInspector';

function RelationshipInspector({ relationship: r }: { relationship: Relationship }) {
  const { snapshot, select } = useEditor();
  const [json, setJson] = useState(JSON.stringify(r.properties, null, 2));
  const serialized = JSON.stringify(r.properties, null, 2);
  useEffect(() => setJson(serialized), [r.id, serialized]);
  if (!snapshot) return null;
  const p = snapshot.project;
  const change = (patch: Partial<Relationship>) =>
    edit([{ kind: 'put-relationship', relationship: { ...r, ...patch } }], 'Edit relationship');
  const ports = (id: string) => p.types[p.entities[id]?.typeRef ?? '']?.ports ?? [];
  return (
    <aside className="inspector" aria-label="Relationship inspector">
      <div className="section-heading">
        <h2 className="eyebrow">Relationship</h2>
        <span className="badge">Shared model</span>
      </div>
      <div className="inspector-scroll">
        <p className="identity">{r.id}</p>
        <fieldset disabled={snapshot.readOnly}>
          <label>
            Relationship type
            <select value={r.typeRef} onChange={(e) => void change({ typeRef: e.target.value })}>
              {!p.relationTypes[r.typeRef] && <option>{r.typeRef}</option>}
              {Object.entries(p.relationTypes).map(([key, d]) => (
                <option key={key} value={key}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {(['source', 'target'] as const).map((endpoint) => (
            <section key={endpoint}>
              <label>
                {endpoint === 'source' ? 'Source entity' : 'Target entity'}
                <select
                  value={r[endpoint]}
                  onChange={(e) => void change({ [endpoint]: e.target.value })}
                >
                  {Object.values(p.entities).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {endpoint === 'source' ? 'Source port' : 'Target port'}
                <select
                  value={r[`${endpoint}Port`] ?? ''}
                  onChange={(e) =>
                    void change({ [`${endpoint}Port`]: e.target.value || undefined })
                  }
                >
                  <option value="">Unspecified</option>
                  {ports(r[endpoint]).map((port) => (
                    <option key={port.id}>{port.id}</option>
                  ))}
                </select>
              </label>
              <button onClick={() => select([r[endpoint]])}>Inspect {endpoint}</button>
            </section>
          ))}
          <label>
            Relationship properties
            <textarea
              aria-label="Relationship properties"
              rows={8}
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          </label>
          <label data-help="Importance is a declared relationship property. High and critical links are wider and labelled; it does not change computed check severity.">
            Relationship importance
            <select
              aria-label="Relationship importance"
              value={String(r.properties.importance ?? 'normal')}
              onChange={(e) =>
                void change({ properties: { ...r.properties, importance: e.target.value } })
              }
            >
              {!['low', 'normal', 'high', 'critical'].includes(
                String(r.properties.importance ?? 'normal'),
              ) && (
                <option value={String(r.properties.importance)}>
                  {String(r.properties.importance)}
                </option>
              )}
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <button
            onClick={() =>
              void run(async () => {
                const properties: unknown = JSON.parse(json);
                if (!properties || typeof properties !== 'object' || Array.isArray(properties))
                  throw new Error('Relationship properties must be a JSON object');
                await change({ properties: properties as JsonObject });
              })
            }
          >
            Apply relationship properties
          </button>
          <p className="muted">
            Incompatible endpoints and contracts remain editable and appear in Findings.
          </p>
          <button
            onClick={() =>
              void edit([{ kind: 'remove-relationship', id: r.id }], 'Remove selected relationship')
            }
          >
            Remove this relationship
          </button>
        </fieldset>
      </div>
    </aside>
  );
}

export function Inspector() {
  const {
    snapshot,
    pendingRename,
    selected,
    selectedRelation,
    selectedContainer,
    selectRelationship,
    view,
    select,
    setView,
    setSystem,
  } = useEditor();
  const p = snapshot?.project;
  const entity = p?.entities[selected[0] ?? ''];
  const [json, setJson] = useState('{}'),
    [deleting, setDeleting] = useState(false);
  const [migration, setMigration] = useState('');
  const [migrationPreview, setMigrationPreview] = useState<{
    batch: CommandBatch;
    summary: string;
  } | null>(null);
  const propertiesJson = JSON.stringify(entity?.properties ?? {}, null, 2);
  useEffect(() => setJson(propertiesJson), [entity?.id, propertiesJson]);
  useEffect(() => setDeleting(false), [entity?.id]);
  if (!snapshot || !p) return null;
  if (selectedContainer && snapshot.views[view].containers?.some((c) => c.id === selectedContainer))
    return <ContainerInspector />;
  if (selectedRelation && p.relationships[selectedRelation])
    return <RelationshipInspector relationship={p.relationships[selectedRelation]} />;
  if (!entity)
    return (
      <aside className="inspector" aria-label="Entity inspector">
        <div className="section-heading">
          <h2 className="eyebrow">Inspector</h2>
          <span className="badge">Model</span>
        </div>
        <div className="inspector-empty">
          <div className="empty-outline">↗</div>
          <h3>Inspect a component</h3>
          <p>
            Select an appearance to edit its shared entity, inspect contracts, and follow its
            relationships.
          </p>
        </div>
        <div className="inspector-note">
          <strong>One specification. Four perspectives.</strong>
          <p>Architecture, behavior, information, and validation share stable identities.</p>
        </div>
      </aside>
    );
  const definition = p.types[entity.typeRef],
    properties = definition?.schema.properties as JsonObject | undefined;
  const pendingName = pendingRename?.entityId === entity.id ? pendingRename.name : undefined;
  const displayName = pendingName ?? entity.name;
  async function setProperty(key: string, value: JsonValue) {
    if (!entity) return;
    await edit(
      [
        {
          kind: 'update-entity',
          id: entity.id,
          properties: { ...entity.properties, [key]: value },
          propertyStatus: { ...entity.propertyStatus, [key]: 'declared' },
        },
      ],
      `Edit ${key}`,
    );
  }
  const appearances = Object.values(snapshot.views).flatMap((v) =>
    v.appearances
      .filter((a) => a.entityId === entity.id)
      .map((a) => ({ view: v.id, id: a.id, hidden: a.hidden })),
  );
  const relations = Object.values(p.relationships).filter(
    (r) => r.source === entity.id || r.target === entity.id,
  );
  return (
    <aside className="inspector" aria-label="Entity inspector">
      <div className="section-heading">
        <h2 className="eyebrow">Inspector</h2>
        <span className="badge">
          {selected.length > 1
            ? `${selected.length} selected`
            : (definition?.name ?? 'Unknown type')}
        </span>
      </div>
      <div className="inspector-scroll">
        <label className="field-label">
          Component name
          <input
            aria-label="Component name"
            key={JSON.stringify([p.id, entity.id, displayName])}
            defaultValue={displayName}
            readOnly={snapshot.readOnly || pendingRename !== null}
            onBlur={async ({ currentTarget: input }) => {
              const name = input.value;
              if (input.readOnly || name === entity.name) return;
              if (
                !(await renameEntity(entity.id, name)) &&
                input.isConnected &&
                input.value === name
              )
                input.value = entity.name;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        {pendingName !== undefined && (
          <small className="muted" role="status">
            Saving name…
          </small>
        )}
        <p className="identity">{entity.id}</p>
        <div className="type-reference">{entity.typeRef}</div>
        <section>
          <h3>Properties & contracts</h3>
          {Object.entries(properties ?? { description: { type: 'string' } }).map(
            ([key, schema]) => {
              const s =
                schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
              const value = entity.properties[key];
              return (
                <div
                  className="property"
                  key={key}
                  data-help={`${String(s.title ?? key)}: ${String(s.description ?? 'Edit this shared design property; incomplete or invalid values remain editable and produce Findings.')} Value state: ${entity.propertyStatus[key] ?? (value === undefined ? 'unknown' : 'declared')}.`}
                >
                  <div className="property-heading">
                    <label htmlFor={`prop-${key}`}>{String(s.title ?? key)}</label>
                    <span
                      className={`value-status ${entity.propertyStatus[key] ?? (value === undefined ? 'unknown' : 'declared')}`}
                    >
                      {entity.propertyStatus[key] ?? (value === undefined ? 'unknown' : 'declared')}
                    </span>
                  </div>
                  {Array.isArray(s.enum) ? (
                    <select
                      id={`prop-${key}`}
                      value={String(value ?? '')}
                      onChange={(e) => void setProperty(key, e.target.value)}
                    >
                      <option value="">Unspecified</option>
                      {s.enum.map((v) => (
                        <option key={String(v)} value={String(v)}>
                          {String(v)}
                        </option>
                      ))}
                    </select>
                  ) : s.type === 'boolean' ? (
                    <select
                      id={`prop-${key}`}
                      value={value === undefined ? '' : String(value)}
                      onChange={(e) => void setProperty(key, e.target.value === 'true')}
                    >
                      <option value="">Unspecified</option>
                      <option>true</option>
                      <option>false</option>
                    </select>
                  ) : (
                    <textarea
                      id={`prop-${key}`}
                      key={`${entity.id}:${key}:${String(value)}`}
                      defaultValue={
                        typeof value === 'string'
                          ? value
                          : value === undefined
                            ? ''
                            : JSON.stringify(value)
                      }
                      rows={key === 'description' ? 3 : 2}
                      placeholder="Unspecified — draft edits are allowed"
                      onBlur={(e) => {
                        const next =
                          s.type === 'number' || s.type === 'integer'
                            ? Number(e.target.value)
                            : e.target.value;
                        if (next !== value) void setProperty(key, next);
                      }}
                    />
                  )}
                </div>
              );
            },
          )}
          <details>
            <summary>Advanced property JSON</summary>
            <label className="sr-only" htmlFor="property-json">
              Property JSON
            </label>
            <textarea
              id="property-json"
              className="json-input"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              rows={9}
            />
            <button
              onClick={() =>
                void run(async () => {
                  const properties: unknown = JSON.parse(json);
                  if (!properties || typeof properties !== 'object' || Array.isArray(properties))
                    throw new Error('Properties must be a JSON object');
                  await edit(
                    [
                      {
                        kind: 'update-entity',
                        id: entity.id,
                        properties: properties as JsonObject,
                      },
                    ],
                    'Edit advanced properties',
                  );
                })
              }
            >
              Apply properties
            </button>
          </details>
        </section>
        <section>
          <h3>Implementation claim</h3>
          <label>
            Status
            <select
              aria-label="Implementation claim"
              value={entity.implementationStatus}
              onChange={(e) =>
                void edit(
                  [
                    {
                      kind: 'update-entity',
                      id: entity.id,
                      implementationStatus: e.target.value as typeof entity.implementationStatus,
                    },
                  ],
                  'Change implementation claim',
                )
              }
            >
              <option value="planned">Planned</option>
              <option value="implemented">Implemented</option>
              <option value="verified">Verified — evidence required</option>
            </select>
          </label>
          <label>
            Evidence references
            <textarea
              key={entity.id + 'evidence'}
              defaultValue={entity.evidence.join('\n')}
              rows={2}
              onBlur={(e) => {
                const evidence = e.target.value.split('\n').filter(Boolean);
                if (JSON.stringify(evidence) !== JSON.stringify(entity.evidence))
                  void edit(
                    [{ kind: 'update-entity', id: entity.id, evidence }],
                    'Edit evidence references',
                  );
              }}
            />
          </label>
        </section>
        <section>
          <h3>View grouping</h3>
          <p className="muted">These controls change presentation only.</p>
          {snapshot.views[view].appearances
            .filter((a) => a.entityId === entity.id)
            .slice(0, 1)
            .map((a) => (
              <ParentContainerField key={a.id} view={snapshot.views[view]} itemId={a.id} />
            ))}
          <div className="button-row">
            <button
              disabled={selected.length < 2}
              onClick={() => {
                const v = snapshot.views[view],
                  parent = v.appearances.find((a) => a.entityId === entity.id);
                if (!parent) return;
                let index = 0;
                void run(() =>
                  window.lattice.saveView({
                    ...v,
                    appearances: v.appearances.map((a) =>
                      selected.includes(a.entityId) && a.id !== parent.id
                        ? {
                            ...a,
                            parentAppearanceId: parent.id,
                            x: 25 + (index++ % 2) * 260,
                            y: 85 + Math.floor((index - 1) / 2) * 145,
                          }
                        : a,
                    ),
                  }),
                );
              }}
            >
              Group selection here
            </button>
            <button
              onClick={() => {
                const v = snapshot.views[view],
                  a = v.appearances.find((a) => a.entityId === entity.id);
                if (!a) return;
                void run(() =>
                  window.lattice.saveView({
                    ...v,
                    collapsedIds: v.collapsedIds.includes(a.id)
                      ? v.collapsedIds.filter((id) => id !== a.id)
                      : [...v.collapsedIds, a.id],
                  }),
                );
              }}
            >
              Collapse / expand group
            </button>
            <button
              onClick={() => {
                const v = snapshot.views[view];
                void run(() =>
                  window.lattice.saveView({
                    ...v,
                    appearances: v.appearances.map((a) =>
                      selected.includes(a.entityId) ? { ...a, parentAppearanceId: undefined } : a,
                    ),
                  }),
                );
              }}
            >
              Ungroup selection
            </button>
          </div>
        </section>
        <section>
          <h3>Appearances</h3>
          <div className="appearance-links">
            {appearances.map((a) => (
              <button
                key={a.id}
                className={a.view === view ? 'active' : ''}
                onClick={() => {
                  setView(a.view);
                  select([entity.id]);
                }}
              >
                {a.view}
                {a.hidden ? ' · hidden' : ''}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button
              onClick={() => {
                const v = snapshot.views[view],
                  a = v.appearances.find((a) => a.entityId === entity.id);
                void run(() =>
                  window.lattice.saveView({
                    ...v,
                    appearances: [
                      ...v.appearances,
                      { id: uid(), entityId: entity.id, x: (a?.x ?? 0) + 70, y: (a?.y ?? 0) + 120 },
                    ],
                  }),
                );
              }}
            >
              Add appearance
            </button>
            <button
              onClick={() => {
                const v = snapshot.views[view];
                void run(() =>
                  window.lattice.saveView({
                    ...v,
                    appearances: v.appearances.map((a) =>
                      a.entityId === entity.id ? { ...a, hidden: !a.hidden } : a,
                    ),
                  }),
                );
              }}
            >
              Hide / show here
            </button>
          </div>
          {['system', 'subsystem'].includes(kindOf(entity.typeRef)) && (
            <button onClick={() => setSystem(entity.id)}>Enter nested system</button>
          )}
        </section>
        <section>
          <h3>
            Relationships <span className="muted">{relations.length}</span>
          </h3>
          {relations.map((r) => (
            <div className="relation-row" key={r.id}>
              <button
                className="text-link"
                onClick={() => select([r.source === entity.id ? r.target : r.source])}
              >
                {p.relationTypes[r.typeRef]?.name ?? r.typeRef} →{' '}
                {p.entities[r.source === entity.id ? r.target : r.source]?.name}
              </button>
              <button
                aria-label={`Inspect relationship ${r.id}`}
                onClick={() => selectRelationship(r.id)}
              >
                Edit
              </button>
              <button
                aria-label={`Remove relationship ${r.id}`}
                onClick={() =>
                  void edit([{ kind: 'remove-relationship', id: r.id }], 'Remove relationship')
                }
              >
                ×
              </button>
            </div>
          ))}
          {!relations.length && <p className="muted">No declared relationships.</p>}
        </section>
        <section>
          <h3>Type migration</h3>
          <label>
            New pinned type
            <select
              value={migration}
              onChange={(e) => {
                setMigration(e.target.value);
                setMigrationPreview(null);
              }}
            >
              <option value="">Choose a definition</option>
              {Object.entries(p.types).map(([reference, d]) => (
                <option key={reference} value={reference}>
                  {d.name} · {d.version}
                </option>
              ))}
            </select>
          </label>
          {migration && (
            <>
              <p className="muted">
                Changes this entity’s type reference; all properties are preserved. Findings will be
                recomputed.
              </p>
              <button
                onClick={() =>
                  void run(async () => {
                    const batch: CommandBatch = {
                      baseRevision: p.revision,
                      reason: 'Accept explicit type migration',
                      operations: [{ kind: 'update-entity', id: entity.id, typeRef: migration }],
                    };
                    const result = await window.lattice.previewCommands(batch);
                    setMigrationPreview({
                      batch,
                      summary: `${result.entityCount} entities; ${result.findings.filter((f) => f.status === 'fail').length} failed and ${result.findings.filter((f) => f.status === 'unknown').length} unknown checks after migration. Properties remain intact.`,
                    });
                  })
                }
              >
                Preview migration
              </button>
              {migrationPreview && (
                <>
                  <p>{migrationPreview.summary}</p>
                  <button
                    disabled={migrationPreview.batch.baseRevision !== p.revision}
                    onClick={() =>
                      void run(async () => {
                        await window.lattice.execute(migrationPreview.batch);
                        setMigrationPreview(null);
                        setMigration('');
                      })
                    }
                  >
                    Accept reviewed migration
                  </button>
                </>
              )}
            </>
          )}
        </section>
        <section>
          <h3>Selection actions</h3>
          <div className="button-row">
            <button
              onClick={() =>
                void edit(
                  copySelection(p, selected),
                  'Copy selected subgraph with fresh identities',
                )
              }
            >
              Duplicate selection
            </button>
            <button className="danger" onClick={() => setDeleting(true)}>
              Delete…
            </button>
          </div>
          {deleting && (
            <div className="warning-box">
              <strong>Review deletion</strong>
              <p>
                {selected.length} entities, {deletionPreview(p, selected).relationships.length}{' '}
                relationships, {deletionPreview(p, selected).bindings.length} artifact associations
                affected. Associated files remain on disk.
              </p>
              <button
                className="danger"
                onClick={() =>
                  void edit(
                    selected.map((id) => ({ kind: 'remove-entity', id })),
                    'Delete reviewed selection',
                  )
                }
              >
                Confirm deletion
              </button>
              <button onClick={() => setDeleting(false)}>Cancel</button>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
