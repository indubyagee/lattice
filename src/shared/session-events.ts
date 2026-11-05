import type { Entity, Finding, Project, Relationship, Views } from '../domain/types';
import type { SessionSnapshot } from './contracts';

type Metadata = Omit<SessionSnapshot, 'project' | 'views' | 'findings'>;
export type SessionEvent =
  | { kind: 'snapshot'; snapshot: SessionSnapshot }
  | {
      kind: 'update';
      projectId: string;
      baseRevision: number;
      project: Partial<Project>;
      entities: Record<string, Entity | null>;
      relationships: Record<string, Relationship | null>;
      views: Partial<Views>;
      metadata: Metadata;
      findings: { revision: number; upsert: Finding[]; remove: string[]; staleIds: string[] };
    };
const comparableFinding = (f: Finding) => JSON.stringify({ ...f, revision: 0, stale: false });
/** Host-to-renderer projections only. These updates do not authorize semantic writes. */
export function sessionEvent(
  previous: SessionSnapshot | null,
  next: SessionSnapshot,
): SessionEvent {
  if (!previous || previous.project.id !== next.project.id)
    return { kind: 'snapshot', snapshot: next };
  const changes = <T>(
    before: Record<string, T>,
    after: Record<string, T>,
  ): Record<string, T | null> => {
    const result: Record<string, T | null> = {};
    for (const [id, value] of Object.entries(after)) if (before[id] !== value) result[id] = value;
    for (const id of Object.keys(before)) if (!after[id]) result[id] = null;
    return result;
  };
  const fields: Partial<Project> = {};
  for (const key of [
    'name',
    'purpose',
    'revision',
    'schemaVersion',
    'types',
    'relationTypes',
    'assemblies',
    'instances',
    'bindings',
    'decisions',
    'reviews',
    'dispositions',
    'extensions',
  ] as const)
    if (previous.project[key] !== next.project[key])
      Object.assign(fields, { [key]: next.project[key] });
  const views: Partial<Views> = {};
  for (const key of ['architecture', 'behavior', 'information', 'validation'] as const)
    if (previous.views[key] !== next.views[key]) views[key] = next.views[key];
  const oldFindings = new Map(previous.findings.map((f) => [f.id, f])),
    ids = new Set(next.findings.map((f) => f.id));
  const upsert = next.findings.filter(
    (f) =>
      !oldFindings.has(f.id) || comparableFinding(oldFindings.get(f.id)!) !== comparableFinding(f),
  );
  const { project: _project, views: _views, findings: _findings, ...metadata } = next;
  return {
    kind: 'update',
    projectId: next.project.id,
    baseRevision: previous.project.revision,
    project: fields,
    entities: changes(previous.project.entities, next.project.entities),
    relationships: changes(previous.project.relationships, next.project.relationships),
    views,
    metadata,
    findings: {
      revision: next.findings[0]?.revision ?? next.project.revision,
      upsert,
      remove: previous.findings.filter((f) => !ids.has(f.id)).map((f) => f.id),
      staleIds: next.findings
        .filter((f) => f.stale && f.revision === next.project.revision)
        .map((f) => f.id),
    },
  };
}
export function applySessionEvent(
  previous: SessionSnapshot | null,
  event: SessionEvent,
): SessionSnapshot | null {
  if (event.kind === 'snapshot') return event.snapshot;
  if (
    !previous ||
    previous.project.id !== event.projectId ||
    previous.project.revision !== event.baseRevision
  )
    return null;
  const patch = <T>(
    old: Record<string, T>,
    changes: Record<string, T | null>,
  ): Record<string, T> => {
    if (!Object.keys(changes).length) return old;
    const result = { ...old };
    for (const [id, value] of Object.entries(changes))
      if (value === null) delete result[id];
      else result[id] = value;
    return result;
  };
  const project = {
    ...previous.project,
    ...event.project,
    entities: patch(previous.project.entities, event.entities),
    relationships: patch(previous.project.relationships, event.relationships),
  };
  const findings = new Map(previous.findings.map((f) => [f.id, f]));
  event.findings.remove.forEach((id) => findings.delete(id));
  event.findings.upsert.forEach((f) => findings.set(f.id, f));
  const stale = new Set(event.findings.staleIds);
  return {
    ...event.metadata,
    project,
    views: Object.keys(event.views).length ? { ...previous.views, ...event.views } : previous.views,
    findings: [...findings.values()].map((f) => ({
      ...f,
      revision: event.findings.revision,
      stale: stale.has(f.id) || event.findings.revision !== project.revision,
    })),
  };
}
