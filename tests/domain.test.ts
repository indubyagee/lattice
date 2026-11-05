import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createEntity, createProject, typeRef } from '../src/domain/builtins';
import { execute, copySelection } from '../src/domain/commands';
import { canonical, designHash, digest, sha256 } from '../src/domain/hash';
import { exportDefinitions, importDefinitions, previewUpgrade } from '../src/domain/assemblies';
import { ref, uid, type AssemblyDefinition, type Operation } from '../src/domain/types';
import { emptyViews, reconcileViews } from '../src/projection/views';

describe('portable identity and transactions', () => {
  it('matches SHA-256 on UTF-8, BOM, astral characters and large input', () => {
    for (const text of ['', 'abc', '\uFEFFreview\r\n🙂', 'a'.repeat(10000)])
      expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
    expect(canonical({ z: 1, a: [2, 1] })).toBe('{"a":[2,1],"z":1}');
  });
  it('rejects stale batches and leaves input intact on failed transactions', () => {
    const p = createProject(),
      e = createEntity(typeRef('agent'));
    expect(() =>
      execute(p, {
        baseRevision: 1,
        reason: 'stale',
        operations: [{ kind: 'create-entity', entity: e }],
      }),
    ).toThrow('Stale');
    expect(() =>
      execute(p, {
        baseRevision: 0,
        reason: 'collision',
        operations: [
          { kind: 'create-entity', entity: e },
          { kind: 'create-entity', entity: e },
        ],
      }),
    ).toThrow('collision');
    expect(p.entities).toEqual({});
  });
  it('keeps semantic conflicts editable and rejects malformed record envelopes', () => {
    const p = createProject(),
      e = createEntity(typeRef('role'));
    const next = execute(p, {
      baseRevision: 0,
      reason: 'incomplete role',
      operations: [{ kind: 'create-entity', entity: e }],
    }).project;
    expect(next.entities[e.id]!.properties).toEqual({});
    expect(() =>
      execute(next, {
        baseRevision: 1,
        reason: 'bad pointer',
        operations: [
          { kind: 'set-value', id: e.id, pointer: '/properties/__proto__/polluted', value: true },
        ],
      }),
    ).toThrow('Unsafe');
  });
  it('shares entity identities across views and preserves unrelated positions', () => {
    let p = createProject();
    const e = createEntity(typeRef('agent'));
    p = execute(p, {
      baseRevision: 0,
      reason: 'insert',
      operations: [{ kind: 'create-entity', entity: e }],
    }).project;
    let views = reconcileViews(p, emptyViews());
    views.information.appearances[0]!.x = 987;
    const appearance = views.architecture.appearances[0]!.id;
    p = execute(p, {
      baseRevision: 1,
      reason: 'rename',
      operations: [{ kind: 'update-entity', id: e.id, name: 'Renamed' }],
    }).project;
    views = reconcileViews(p, views);
    expect(views.information.appearances[0]!.x).toBe(987);
    expect(views.architecture.appearances[0]!.id).toBe(appearance);
    expect(
      Object.values(views)
        .flatMap((v) => v.appearances)
        .every((a) => a.entityId === e.id),
    ).toBe(true);
  });
  it('copies a subgraph with fresh identities', () => {
    const p = createProject(),
      a = createEntity(typeRef('agent')),
      b = createEntity(typeRef('role'));
    p.entities[a.id] = a;
    p.entities[b.id] = b;
    const r = {
      id: uid(),
      typeRef: typeRef('fulfills-role'),
      source: a.id,
      target: b.id,
      properties: {},
      provenance: a.provenance,
    };
    p.relationships[r.id] = r;
    const next = execute(p, {
      baseRevision: 0,
      reason: 'copy',
      operations: copySelection(p, [a.id, b.id]),
    }).project;
    expect(Object.keys(next.entities)).toHaveLength(4);
    expect(Object.keys(next.relationships)).toHaveLength(2);
    const copy = Object.values(next.relationships).find((x) => x.id !== r.id)!;
    expect(copy.source).not.toBe(a.id);
    expect(copy.target).not.toBe(b.id);
  });
  it('preserves unknown types, extension data, and review hash independence', () => {
    const p = createProject(),
      e = createEntity('external.missing@2.0.0');
    p.entities[e.id] = e;
    p.extensions['vendor.data'] = { retained: [1, 2] };
    const before = designHash(p);
    p.reviews.push({
      id: uid(),
      topic: 'interfaces',
      actor: 'Test reviewer',
      rationale: 'Fixture review only',
      designHash: before,
      at: '2026-11-01',
    });
    expect(designHash(p)).toBe(before);
    expect(JSON.parse(canonical(p)).extensions['vendor.data']).toEqual({ retained: [1, 2] });
  });
});
describe('definition packages and pinned assemblies', () => {
  it('preserves local relationship overrides when an upgrade changes other elements', () => {
    let p = createProject();
    const a = createEntity(typeRef('agent')),
      b = createEntity(typeRef('tool'));
    const relation = {
      id: uid(),
      typeRef: typeRef('depends-on'),
      source: a.id,
      target: b.id,
      properties: { contract: 'original' },
      provenance: a.provenance,
    };
    const old: AssemblyDefinition = {
      id: 'local.relationships',
      version: '1.0.0',
      name: 'Relations',
      description: '',
      entities: [a, b],
      relationships: [relation],
      dependencies: [a.typeRef, b.typeRef, relation.typeRef],
      parameters: [],
      ports: [],
    };
    const next = structuredClone(old);
    next.version = '1.1.0';
    next.entities[0]!.name = 'Updated definition name';
    const instanceId = uid();
    p = execute(p, {
      baseRevision: 0,
      reason: 'set up',
      operations: [
        { kind: 'register-assembly', definition: old },
        { kind: 'register-assembly', definition: next },
        { kind: 'instantiate', instanceId, definitionRef: ref(old), parameters: {} },
      ],
    }).project;
    const id = p.instances[instanceId]!.relationshipMapping[relation.id]!;
    p.relationships[id]!.properties.contract = 'local override';
    p = execute(p, {
      baseRevision: p.revision,
      reason: 'upgrade',
      operations: [
        { kind: 'upgrade-instance', instanceId, definitionRef: ref(next), resolutions: {} },
      ],
    }).project;
    expect(p.relationships[id]!.properties.contract).toBe('local override');
  });
  it('round trips exact definition hashes and rejects tampered claims', () => {
    const p = createProject();
    const custom = { ...p.types[typeRef('capability')]!, id: 'local.custom', version: '1.0.0' };
    p.types[ref(custom)] = custom;
    const pkg = exportDefinitions(p);
    const next = execute(createProject(), {
      baseRevision: 0,
      reason: 'import',
      operations: importDefinitions(pkg),
    }).project;
    expect(digest(next.types[ref(custom)])).toBe(digest(custom));
    pkg.types.find((d) => d.id === custom.id)!.description = 'tampered';
    expect(() => importDefinitions(pkg)).toThrow('hash mismatch');
  });
  it('rejects unsupported declarative keywords and immutable-version edits', () => {
    const p = createProject();
    const d = {
      ...p.types[typeRef('agent')]!,
      id: 'local.custom',
      schema: { type: 'object', format: 'unsafe' },
    };
    expect(() =>
      execute(p, {
        baseRevision: 0,
        reason: 'bad schema',
        operations: [{ kind: 'register-type', definition: d }],
      }),
    ).toThrow('Unsupported schema keyword');
    expect(() =>
      execute(p, {
        baseRevision: 0,
        reason: 'mutate pin',
        operations: [
          { kind: 'register-type', definition: { ...p.types[typeRef('agent')]!, name: 'changed' } },
        ],
      }),
    ).toThrow('immutable');
  });
  it('selectively upgrades instances while retaining local overrides and exposing conflicts', () => {
    let p = createProject();
    const e = createEntity(typeRef('role'), 'Reviewer');
    e.properties = { responsibilities: 'old', description: 'original' };
    const old: AssemblyDefinition = {
      id: 'local.review',
      version: '1.0.0',
      name: 'Review',
      description: '',
      entities: [e],
      relationships: [],
      dependencies: [e.typeRef],
      parameters: [],
      ports: [],
    };
    const next = { ...structuredClone(old), version: '1.1.0' };
    next.entities[0]!.properties.responsibilities = 'new';
    next.entities[0]!.properties.description = 'new description';
    const a = uid(),
      b = uid();
    const ops: Operation[] = [
      { kind: 'register-assembly', definition: old },
      { kind: 'register-assembly', definition: next },
      { kind: 'instantiate', definitionRef: ref(old), instanceId: a, parameters: {} },
      { kind: 'instantiate', definitionRef: ref(old), instanceId: b, parameters: {} },
    ];
    p = execute(p, { baseRevision: 0, reason: 'instances', operations: ops }).project;
    const id = p.instances[a]!.mapping[e.id]!,
      other = p.instances[b]!.mapping[e.id]!;
    expect(id).not.toBe(other);
    p = execute(p, {
      baseRevision: p.revision,
      reason: 'override',
      operations: [
        {
          kind: 'update-entity',
          id,
          properties: {
            responsibilities: 'my override',
            description: 'original',
            localNote: 'retain',
          },
        },
      ],
    }).project;
    const conflicts = previewUpgrade(p, a, ref(next)).filter((c) => c.conflict);
    expect(conflicts).toHaveLength(1);
    expect(() =>
      execute(p, {
        baseRevision: p.revision,
        reason: 'unresolved',
        operations: [
          { kind: 'upgrade-instance', instanceId: a, definitionRef: ref(next), resolutions: {} },
        ],
      }),
    ).toThrow('Resolve');
    p = execute(p, {
      baseRevision: p.revision,
      reason: 'selective upgrade',
      operations: [
        {
          kind: 'upgrade-instance',
          instanceId: a,
          definitionRef: ref(next),
          resolutions: { [conflicts[0]!.key]: 'local' },
        },
      ],
    }).project;
    expect(p.entities[id]!.properties).toEqual({
      responsibilities: 'my override',
      description: 'new description',
      localNote: 'retain',
    });
    expect(p.instances[b]!.definitionRef).toBe(ref(old));
  });
});
