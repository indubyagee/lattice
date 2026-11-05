import { useState } from 'react';
import { useEditor, edit, run } from './store';
import { assemblyFromSelection, previewUpgrade } from '../domain/assemblies';
import { builtinTypes, typeRef } from '../domain/builtins';
import {
  ref,
  uid,
  type AssemblyDefinition,
  type JsonObject,
  type RelationDefinition,
  type Rule,
  type TypeDefinition,
} from '../domain/types';
import { TextEditor } from './Editor';
const ruleTemplates: Record<string, Rule> = {
  required: { kind: 'required', property: 'description' },
  allowed: { kind: 'allowed', property: 'state', values: ['draft', 'reviewed'] },
  'endpoint-port': { kind: 'endpoint-port' },
  'relation-count': {
    kind: 'relation-count',
    relation: typeRef('depends-on'),
    direction: 'out',
    min: 1,
  },
  dependency: { kind: 'dependency', relation: typeRef('depends-on') },
  access: { kind: 'access' },
  reachability: {
    kind: 'reachability',
    relations: [typeRef('precedes')],
    targetType: typeRef('gate'),
    maxDepth: 50,
  },
};

export function LibraryPanel() {
  const { snapshot, selected } = useEditor();
  const [kind, setKind] = useState<'type' | 'relation' | 'assembly'>('type');
  const [json, setJson] = useState(() =>
    JSON.stringify(
      {
        ...builtinTypes()[typeRef('capability')],
        id: 'local.custom-capability',
        name: 'Custom capability',
      },
      null,
      2,
    ),
  );
  const [template, setTemplate] = useState('required'),
    [assemblyName, setAssemblyName] = useState('Review assembly'),
    [assemblyRef, setAssemblyRef] = useState(''),
    [parameters, setParameters] = useState('{}'),
    [instance, setInstance] = useState(''),
    [upgradeRef, setUpgradeRef] = useState(''),
    [resolutions, setResolutions] = useState<Record<string, 'local' | 'definition'>>({});
  if (!snapshot) return null;
  const p = snapshot.project;
  let changes: ReturnType<typeof previewUpgrade> = [];
  let upgradeError = '';
  if (instance && upgradeRef)
    try {
      changes = previewUpgrade(p, instance, upgradeRef);
    } catch (error) {
      upgradeError = String(error);
    }
  function newDefinition(next: typeof kind) {
    setKind(next);
    if (next === 'type')
      setJson(
        JSON.stringify(
          {
            ...builtinTypes()[typeRef('capability')],
            id: 'local.custom-capability',
            name: 'Custom capability',
          },
          null,
          2,
        ),
      );
    if (next === 'relation')
      setJson(
        JSON.stringify(
          {
            id: 'local.custom-relation',
            version: '1.0.0',
            name: 'Custom relation',
            sourceFamilies: ['structure', 'capability', 'behavior'],
            targetFamilies: ['structure', 'capability', 'information'],
            direction: 'directed',
            impact: 'source-depends-on-target',
            schema: { type: 'object' },
            rules: [{ kind: 'endpoint-port' }],
          },
          null,
          2,
        ),
      );
    if (next === 'assembly')
      setJson(
        JSON.stringify(
          {
            id: 'local.new-assembly',
            version: '1.0.0',
            name: 'New assembly',
            description: '',
            entities: [],
            relationships: [],
            dependencies: [],
            parameters: [],
            ports: [],
          },
          null,
          2,
        ),
      );
  }
  return (
    <div className="library-panel">
      <div className="library-browser">
        <div className="panel-toolbar">
          <strong>Project library</strong>
        </div>
        <div className="button-row">
          <button onClick={() => void run(() => window.lattice.importDefinitions())}>
            Import package…
          </button>
          <button onClick={() => void run(() => window.lattice.exportDefinitions())}>
            Export package…
          </button>
        </div>
        <label>
          Definition family
          <select value={kind} onChange={(e) => newDefinition(e.target.value as typeof kind)}>
            <option value="type">Component types</option>
            <option value="relation">Relationship types</option>
            <option value="assembly">Assemblies</option>
          </select>
        </label>
        <button onClick={() => newDefinition(kind)}>New {kind}</button>
        <div className="definition-list">
          {Object.entries(
            kind === 'type' ? p.types : kind === 'relation' ? p.relationTypes : p.assemblies,
          ).map(([reference, d]) => (
            <button key={reference} onClick={() => setJson(JSON.stringify(d, null, 2))}>
              <strong>{d.name}</strong>
              <small>{reference}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="definition-editor">
        <div className="panel-toolbar">
          <strong>Declarative {kind} editor</strong>
          <div className="spacer" />
          <button
            className="primary"
            onClick={() =>
              void run(async () => {
                const definition = JSON.parse(json);
                await edit(
                  kind === 'type'
                    ? [{ kind: 'register-type', definition: definition as TypeDefinition }]
                    : kind === 'relation'
                      ? [
                          {
                            kind: 'register-relation',
                            definition: definition as RelationDefinition,
                          },
                        ]
                      : [
                          {
                            kind: 'register-assembly',
                            definition: definition as AssemblyDefinition,
                          },
                        ],
                  'Register pinned project definition',
                );
              })
            }
          >
            Register version
          </button>
        </div>
        <p className="muted">
          Edit names, descriptions, schema, defaults, ports, renderers, and rules. Existing versions
          are immutable: change the version to propose an upgrade.
        </p>
        {kind !== 'assembly' && (
          <div className="button-row">
            <label className="sr-only" htmlFor="rule-template">
              Rule template
            </label>
            <select
              id="rule-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              {Object.keys(ruleTemplates)
                .filter((key) =>
                  kind === 'relation'
                    ? ['required', 'allowed', 'endpoint-port', 'access'].includes(key)
                    : !['access', 'endpoint-port'].includes(key),
                )
                .map((key) => (
                  <option key={key}>{key}</option>
                ))}
            </select>
            <button
              onClick={() =>
                void run(async () => {
                  const definition = JSON.parse(json) as TypeDefinition;
                  definition.rules = [...(definition.rules ?? []), ruleTemplates[template]!];
                  setJson(JSON.stringify(definition, null, 2));
                })
              }
            >
              Add rule template
            </button>
          </div>
        )}
        <TextEditor
          value={json}
          onChange={setJson}
          language="json"
          label="Definition JSON editor"
        />
      </div>
      <div className="assembly-tools">
        <h3>Reusable assemblies</h3>
        <label>
          Assembly name
          <input value={assemblyName} onChange={(e) => setAssemblyName(e.target.value)} />
        </label>
        <button
          disabled={!selected.length}
          onClick={() =>
            void edit(
              [
                {
                  kind: 'register-assembly',
                  definition: assemblyFromSelection(p, selected, assemblyName),
                },
              ],
              'Save selected subgraph as assembly',
            )
          }
        >
          Save selection as assembly
        </button>
        <label>
          Pinned definition
          <select value={assemblyRef} onChange={(e) => setAssemblyRef(e.target.value)}>
            <option value="">Select assembly</option>
            {Object.values(p.assemblies).map((a) => (
              <option key={ref(a)} value={ref(a)}>
                {a.name} · {a.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Parameters (JSON)
          <textarea value={parameters} onChange={(e) => setParameters(e.target.value)} rows={2} />
        </label>
        <button
          disabled={!assemblyRef}
          onClick={() =>
            void run(async () => {
              await edit(
                [
                  {
                    kind: 'instantiate',
                    definitionRef: assemblyRef,
                    instanceId: uid(),
                    parameters: JSON.parse(parameters) as JsonObject,
                  },
                ],
                'Insert assembly with distinct identities',
              );
            })
          }
        >
          Insert new instance
        </button>
        <h3>Selective upgrade</h3>
        <label>
          Instance
          <select
            value={instance}
            onChange={(e) => {
              setInstance(e.target.value);
              setResolutions({});
            }}
          >
            <option value="">Choose one instance</option>
            {Object.values(p.instances).map((i) => (
              <option key={i.id} value={i.id}>
                {i.definitionRef} · {i.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          New definition
          <select
            value={upgradeRef}
            onChange={(e) => {
              setUpgradeRef(e.target.value);
              setResolutions({});
            }}
          >
            <option value="">Choose version</option>
            {Object.values(p.assemblies).map((a) => (
              <option key={ref(a)} value={ref(a)}>
                {a.name} · {a.version}
              </option>
            ))}
          </select>
        </label>
        {upgradeError && <p className="error-text">{upgradeError}</p>}
        {changes.map((c) => (
          <div key={c.key} className="upgrade-change">
            <strong>{c.label}</strong>
            <small>
              {c.conflict
                ? 'Conflict — choose a value'
                : 'Definition-only change; local overrides retained'}
            </small>
            {c.conflict && (
              <label>
                Resolution
                <select
                  value={resolutions[c.key] ?? ''}
                  onChange={(e) =>
                    setResolutions({
                      ...resolutions,
                      [c.key]: e.target.value as 'local' | 'definition',
                    })
                  }
                >
                  <option value="">Choose</option>
                  <option value="local">Keep local</option>
                  <option value="definition">Use new definition</option>
                </select>
              </label>
            )}
          </div>
        ))}
        <button
          disabled={
            !instance ||
            !upgradeRef ||
            !!upgradeError ||
            changes.some((c) => c.conflict && !resolutions[c.key])
          }
          onClick={() =>
            void edit(
              [
                {
                  kind: 'upgrade-instance',
                  instanceId: instance,
                  definitionRef: upgradeRef,
                  resolutions,
                },
              ],
              'Accept reviewed selective assembly upgrade',
            )
          }
        >
          Apply to this instance
        </button>
      </div>
    </div>
  );
}
