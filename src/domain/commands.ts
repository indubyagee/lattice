import type { CommandBatch, CommandResult, Operation, Project } from './types';
import { ref, uid } from './types';
import {
  assertBatch,
  assertDefinition,
  assertProject,
  ensure,
  StaleRevisionError,
} from './integrity';
import { designHash, digest, pointerSet } from './hash';
import { insertAssembly, upgradeAssembly } from './assemblies';

function putDefinition<T extends Parameters<typeof assertDefinition>[0]>(
  records: Record<string, T>,
  definition: T,
): void {
  assertDefinition(definition);
  const key = ref(definition);
  ensure(
    !records[key] || digest(records[key]) === digest(definition),
    'An exact definition version is immutable; register a new version',
  );
  records[key] = structuredClone(definition);
}
/** Pure transaction: failures leave the input snapshot untouched. */
export function execute(project: Project, batch: CommandBatch): CommandResult {
  assertBatch(batch);
  if (batch.baseRevision !== project.revision)
    throw new StaleRevisionError(
      `Stale revision ${batch.baseRevision}; current revision is ${project.revision}`,
    );
  if (batch.expectedDesignHash && batch.expectedDesignHash !== designHash(project))
    throw new StaleRevisionError('Design hash precondition failed');
  let next = structuredClone(project);
  const changed = new Set<string>();
  for (const op of batch.operations) {
    switch (op.kind) {
      case 'create-entity':
        ensure(op.entity && !next.entities[op.entity.id], 'Entity ID collision');
        next.entities[op.entity.id] = structuredClone(op.entity);
        changed.add(op.entity.id);
        break;
      case 'update-entity': {
        const entity = next.entities[op.id];
        ensure(entity, 'Entity missing');
        const { kind: _kind, id: _id, ...patch } = op;
        Object.assign(entity, structuredClone(patch));
        changed.add(op.id);
        break;
      }
      case 'set-value': {
        const entity = next.entities[op.id];
        ensure(entity, 'Mapped entity missing');
        ensure(
          op.pointer === '/name' || op.pointer.startsWith('/properties/'),
          'Only a name or property can be mapped',
        );
        pointerSet(entity, op.pointer, op.value);
        entity.propertyStatus[op.pointer] = 'declared';
        changed.add(op.id);
        break;
      }
      case 'remove-entity':
        ensure(next.entities[op.id], 'Entity missing');
        delete next.entities[op.id];
        for (const [id, r] of Object.entries(next.relationships))
          if (r.source === op.id || r.target === op.id) {
            delete next.relationships[id];
            changed.add(id);
          }
        for (const b of Object.values(next.bindings)) {
          b.entityIds = b.entityIds.filter((id) => id !== op.id);
          b.mappings = b.mappings.filter((m) => m.entityId !== op.id);
          b.state = 'pending';
        }
        for (const e of Object.values(next.entities))
          e.systemIds = e.systemIds.filter((id) => id !== op.id);
        changed.add(op.id);
        break;
      case 'put-relationship':
        ensure(op.relationship, 'Relationship missing');
        next.relationships[op.relationship.id] = structuredClone(op.relationship);
        changed.add(op.relationship.id);
        changed.add(op.relationship.source);
        changed.add(op.relationship.target);
        break;
      case 'remove-relationship':
        ensure(next.relationships[op.id], 'Relationship missing');
        delete next.relationships[op.id];
        changed.add(op.id);
        break;
      case 'register-type':
        putDefinition(next.types, op.definition);
        changed.add(ref(op.definition));
        break;
      case 'register-relation':
        putDefinition(next.relationTypes, op.definition);
        changed.add(ref(op.definition));
        break;
      case 'register-assembly':
        putDefinition(next.assemblies, op.definition);
        changed.add(ref(op.definition));
        break;
      case 'instantiate':
        insertAssembly(next, op.definitionRef, op.instanceId, op.parameters).forEach((id) =>
          changed.add(id),
        );
        break;
      case 'upgrade-instance':
        upgradeAssembly(next, op.instanceId, op.definitionRef, op.resolutions).forEach((id) =>
          changed.add(id),
        );
        break;
      case 'put-binding':
        ensure(op.binding, 'Binding missing');
        next.bindings[op.binding.id] = structuredClone(op.binding);
        changed.add(op.binding.id);
        break;
      case 'remove-binding':
        delete next.bindings[op.id];
        changed.add(op.id);
        break;
      case 'disposition':
        ensure(op.rationale.trim(), 'Disposition needs a rationale');
        ensure(
          ['open', 'acknowledged', 'deferred', 'resolved'].includes(op.disposition),
          'Invalid disposition',
        );
        next.dispositions[op.findingId] = {
          disposition: op.disposition,
          rationale: op.rationale,
          inputHash: op.inputHash,
        };
        break;
      case 'decision':
        next.decisions.push({ ...structuredClone(op.decision), revision: project.revision + 1 });
        break;
      case 'review':
        ensure(op.review.designHash === designHash(project), 'Review covers a different design');
        ensure(
          op.review.actor.trim() && op.review.rationale.trim(),
          'Review needs an actor and rationale',
        );
        next.reviews = next.reviews.filter((r) => r.topic !== op.review.topic);
        next.reviews.push(structuredClone(op.review));
        break;
      case 'replace-snapshot':
        assertProject(op.snapshot);
        ensure(op.snapshot.id === project.id, 'Import must retain project identity');
        next = structuredClone(op.snapshot);
        Object.keys(next.entities).forEach((id) => changed.add(id));
        break;
      default:
        throw new Error(`Unsupported operation ${(op as Operation).kind}`);
    }
  }
  next.revision = project.revision + 1;
  assertProject(next);
  // Preserve immutable record identities so host notifications can send only accepted changes.
  const share = <T>(before: Record<string, T>, after: Record<string, T>): Record<string, T> => {
    let same = Object.keys(before).length === Object.keys(after).length;
    for (const [id, value] of Object.entries(after)) {
      if (before[id] !== undefined && JSON.stringify(before[id]) === JSON.stringify(value))
        after[id] = before[id]!;
      else same = false;
    }
    return same ? before : after;
  };
  next.entities = share(project.entities, next.entities);
  next.relationships = share(project.relationships, next.relationships);
  next.types = share(project.types, next.types);
  next.relationTypes = share(project.relationTypes, next.relationTypes);
  next.assemblies = share(project.assemblies, next.assemblies);
  next.instances = share(project.instances, next.instances);
  next.bindings = share(project.bindings, next.bindings);
  for (const key of ['decisions', 'reviews', 'dispositions', 'extensions'] as const)
    if (JSON.stringify(project[key]) === JSON.stringify(next[key]))
      Object.assign(next, { [key]: project[key] });
  return { project: next, changedIds: [...changed] };
}
export function deletionPreview(
  project: Project,
  ids: string[],
): { entities: string[]; relationships: string[]; bindings: string[]; instances: string[] } {
  const selected = new Set(ids);
  return {
    entities: ids,
    relationships: Object.values(project.relationships)
      .filter((r) => selected.has(r.source) || selected.has(r.target))
      .map((r) => r.id),
    bindings: Object.values(project.bindings)
      .filter((b) => b.entityIds.some((id) => selected.has(id)))
      .map((b) => b.id),
    instances: Object.values(project.instances)
      .filter((i) => Object.values(i.mapping).some((id) => selected.has(id)))
      .map((i) => i.id),
  };
}
export function copySelection(project: Project, ids: string[]): Operation[] {
  const mapping = Object.fromEntries(ids.map((id) => [id, uid()]));
  const ops: Operation[] = ids.map((id) => {
    const e = project.entities[id];
    ensure(e, 'Entity missing');
    return {
      kind: 'create-entity',
      entity: {
        ...structuredClone(e),
        id: mapping[id]!,
        name: `${e.name} copy`,
        systemIds: e.systemIds.map((s) => mapping[s] ?? s),
      },
    };
  });
  for (const r of Object.values(project.relationships))
    if (mapping[r.source] && mapping[r.target])
      ops.push({
        kind: 'put-relationship',
        relationship: {
          ...structuredClone(r),
          id: uid(),
          source: mapping[r.source]!,
          target: mapping[r.target]!,
        },
      });
  return ops;
}
