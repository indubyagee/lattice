import type {
  AssemblyDefinition,
  AssemblyInstance,
  DefinitionPackage,
  Entity,
  JsonValue,
  Operation,
  Project,
} from './types';
import { ref, uid } from './types';
import { canonical, digest, pointerGet, pointerSet } from './hash';
import { ensure } from './integrity';

export interface UpgradeChange {
  key: string;
  label: string;
  entityId: string;
  pointer: string;
  before: JsonValue | null;
  local: JsonValue | null;
  incoming: JsonValue | null;
  conflict: boolean;
}
export function assemblyFromSelection(
  project: Project,
  ids: string[],
  name: string,
  version = '1.0.0',
): AssemblyDefinition {
  const selected = new Set(ids);
  ensure(selected.size > 0, 'Select at least one entity');
  return {
    id: `local.${
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'assembly'
    }`,
    version,
    name,
    description: 'Reusable selected subgraph',
    entities: ids.map((id) => {
      ensure(project.entities[id], 'Selected entity missing');
      return structuredClone(project.entities[id]!);
    }),
    relationships: Object.values(project.relationships)
      .filter((r) => selected.has(r.source) && selected.has(r.target))
      .map((r) => structuredClone(r)),
    dependencies: [
      ...new Set([
        ...ids.map((id) => project.entities[id]!.typeRef),
        ...Object.values(project.relationships)
          .filter((r) => selected.has(r.source) && selected.has(r.target))
          .map((r) => r.typeRef),
      ]),
    ],
    parameters: [],
    ports: [],
  };
}
function parameterized(def: AssemblyDefinition, instance: AssemblyInstance): Entity[] {
  const entities = structuredClone(def.entities);
  for (const p of def.parameters) {
    const e = entities.find((e) => e.id === p.entityId);
    if (e) pointerSet(e, p.property, instance.parameters[p.name] ?? p.default);
  }
  return entities;
}
export function insertAssembly(
  project: Project,
  definitionRef: string,
  instanceId: string,
  parameters: AssemblyInstance['parameters'],
): string[] {
  const d = project.assemblies[definitionRef];
  ensure(d, 'Assembly definition not found');
  ensure(!project.instances[instanceId], 'Instance ID collision');
  const instance: AssemblyInstance = {
    id: instanceId,
    definitionRef,
    definitionHash: digest(d),
    mapping: {},
    relationshipMapping: {},
    parameters,
  };
  for (const entity of parameterized(d, instance)) {
    const id = uid();
    instance.mapping[entity.id] = id;
    project.entities[id] = { ...entity, id, systemIds: [] };
  }
  for (const e of d.entities)
    project.entities[instance.mapping[e.id]!]!.systemIds = e.systemIds
      .map((s) => instance.mapping[s])
      .filter((s): s is string => !!s);
  for (const r of d.relationships) {
    const id = uid();
    instance.relationshipMapping[r.id] = id;
    project.relationships[id] = {
      ...structuredClone(r),
      id,
      source: instance.mapping[r.source]!,
      target: instance.mapping[r.target]!,
    };
  }
  project.instances[instance.id] = instance;
  return Object.values(instance.mapping);
}
export function previewUpgrade(
  project: Project,
  instanceId: string,
  nextRef: string,
): UpgradeChange[] {
  const instance = project.instances[instanceId];
  ensure(instance, 'Assembly instance missing');
  const before = project.assemblies[instance.definitionRef];
  const next = project.assemblies[nextRef];
  ensure(before && next, 'Both pinned assembly definitions are required');
  ensure(before.id === next.id, 'Upgrade must retain assembly definition identity');
  const oldEntities = parameterized(before, instance),
    newEntities = parameterized(next, instance);
  const changes: UpgradeChange[] = [];
  for (const incoming of newEntities) {
    const old = oldEntities.find((e) => e.id === incoming.id);
    if (!old) continue;
    const current = project.entities[instance.mapping[incoming.id]!];
    if (!current) {
      changes.push({
        key: `missing:${incoming.id}`,
        label: `Locally deleted ${incoming.name}`,
        entityId: instance.mapping[incoming.id]!,
        pointer: '',
        before: old as unknown as JsonValue,
        local: null,
        incoming: incoming as unknown as JsonValue,
        conflict: true,
      });
      continue;
    }
    const fields = [
      '/name',
      '/typeRef',
      ...new Set(
        [...Object.keys(old.properties), ...Object.keys(incoming.properties)].map(
          (k) => `/properties/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        ),
      ),
    ];
    for (const pointer of fields) {
      const a = pointerGet(old, pointer) ?? null,
        b = pointerGet(current, pointer) ?? null,
        c = pointerGet(incoming, pointer) ?? null;
      if (canonical(a) === canonical(c)) continue;
      changes.push({
        key: `${incoming.id}:${pointer}`,
        label: `${current.name} ${pointer}`,
        entityId: current.id,
        pointer,
        before: a,
        local: b,
        incoming: c,
        conflict: canonical(b) !== canonical(a) && canonical(b) !== canonical(c),
      });
    }
  }
  for (const old of oldEntities) {
    if (newEntities.some((e) => e.id === old.id)) continue;
    const current = project.entities[instance.mapping[old.id]!];
    if (!current) continue;
    const baseline = { ...old, id: current.id, systemIds: current.systemIds };
    changes.push({
      key: `remove:${old.id}`,
      label: `Remove ${current.name}`,
      entityId: current.id,
      pointer: '',
      before: old as unknown as JsonValue,
      local: current as unknown as JsonValue,
      incoming: null,
      conflict: digest(baseline) !== digest(current),
    });
  }
  // Relationship edits also participate in three-way review.
  for (const old of before.relationships) {
    const id = instance.relationshipMapping[old.id];
    const local = id ? project.relationships[id] : undefined;
    const incoming = next.relationships.find((r) => r.id === old.id);
    const expected = {
      ...old,
      id,
      source: instance.mapping[old.source],
      target: instance.mapping[old.target],
    };
    const candidate = incoming
      ? {
          ...incoming,
          id,
          source: instance.mapping[incoming.source],
          target: instance.mapping[incoming.target],
        }
      : null;
    if (
      digest(expected) !== digest(candidate) &&
      digest(local ?? null) !== digest(expected) &&
      digest(local ?? null) !== digest(candidate)
    )
      changes.push({
        key: `relation:${old.id}`,
        label: `Relationship ${old.id}`,
        entityId: id!,
        pointer: 'relationship',
        before: expected as unknown as JsonValue,
        local: (local ?? null) as unknown as JsonValue,
        incoming: candidate as unknown as JsonValue,
        conflict: true,
      });
  }
  return changes;
}
export function upgradeAssembly(
  project: Project,
  instanceId: string,
  nextRef: string,
  resolutions: Record<string, 'local' | 'definition'>,
): string[] {
  const changes = previewUpgrade(project, instanceId, nextRef);
  ensure(
    changes.every((c) => !c.conflict || resolutions[c.key]),
    'Resolve all assembly upgrade conflicts first',
  );
  const instance = project.instances[instanceId]!;
  const old = project.assemblies[instance.definitionRef]!;
  const next = project.assemblies[nextRef]!;
  for (const c of changes) {
    if (resolutions[c.key] === 'local' || c.pointer === 'relationship') continue;
    if (c.pointer) pointerSet(project.entities[c.entityId]!, c.pointer, c.incoming);
    else if (c.incoming === null) {
      delete project.entities[c.entityId];
      for (const [id, r] of Object.entries(project.relationships))
        if (r.source === c.entityId || r.target === c.entityId) delete project.relationships[id];
      for (const b of Object.values(project.bindings)) {
        b.entityIds = b.entityIds.filter((id) => id !== c.entityId);
        b.mappings = b.mappings.filter((m) => m.entityId !== c.entityId);
        b.state = 'pending';
      }
      for (const e of Object.values(project.entities))
        e.systemIds = e.systemIds.filter((id) => id !== c.entityId);
    } else project.entities[c.entityId] = { ...(c.incoming as unknown as Entity), id: c.entityId };
  }
  for (const e of parameterized(next, instance)) {
    if (!instance.mapping[e.id]) {
      const id = uid();
      instance.mapping[e.id] = id;
      project.entities[id] = { ...e, id, systemIds: [] };
    }
  }
  for (const r of old.relationships) {
    if (resolutions[`relation:${r.id}`] === 'local') continue;
    const incoming = next.relationships.find((n) => n.id === r.id);
    if (incoming && digest(incoming) === digest(r)) continue;
    const id = instance.relationshipMapping[r.id];
    if (id) delete project.relationships[id];
  }
  for (const r of next.relationships) {
    if (resolutions[`relation:${r.id}`] === 'local') continue;
    const previous = old.relationships.find((o) => o.id === r.id);
    if (previous && digest(previous) === digest(r)) continue;
    const source = instance.mapping[r.source],
      target = instance.mapping[r.target];
    if (!source || !target || !project.entities[source] || !project.entities[target]) continue;
    const id = instance.relationshipMapping[r.id] ?? uid();
    instance.relationshipMapping[r.id] = id;
    project.relationships[id] = { ...structuredClone(r), id, source, target };
  }
  instance.definitionRef = nextRef;
  instance.definitionHash = digest(next);
  return Object.values(instance.mapping);
}
export function exportDefinitions(project: Project, name = project.name): DefinitionPackage {
  const types = Object.values(project.types),
    relations = Object.values(project.relationTypes),
    assemblies = Object.values(project.assemblies);
  return {
    format: 'lattice-package@1',
    name,
    types: structuredClone(types),
    relations: structuredClone(relations),
    assemblies: structuredClone(assemblies),
    hashes: Object.fromEntries(
      [...types, ...relations, ...assemblies].map((d) => [ref(d), digest(d)]),
    ),
  };
}
export function importDefinitions(pkg: DefinitionPackage): Operation[] {
  ensure(
    pkg?.format === 'lattice-package@1' &&
      Array.isArray(pkg.types) &&
      Array.isArray(pkg.relations) &&
      Array.isArray(pkg.assemblies) &&
      pkg.hashes,
    'Invalid definition package',
  );
  for (const d of [...pkg.types, ...pkg.relations, ...pkg.assemblies])
    ensure(pkg.hashes[ref(d)] === digest(d), `Definition hash mismatch: ${ref(d)}`);
  const bundled = new Set([...pkg.types, ...pkg.relations, ...pkg.assemblies].map(ref));
  for (const a of pkg.assemblies)
    for (const d of a.dependencies) ensure(bundled.has(d), `Unbundled assembly dependency: ${d}`);
  return [
    ...pkg.types.map((definition) => ({ kind: 'register-type' as const, definition })),
    ...pkg.relations.map((definition) => ({ kind: 'register-relation' as const, definition })),
    ...pkg.assemblies.map((definition) => ({ kind: 'register-assembly' as const, definition })),
  ];
}
