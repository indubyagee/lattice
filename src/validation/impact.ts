import type { Project } from '../domain/types';
export interface Impact {
  id: string;
  path: string[];
  certainty: 'known dependency' | 'possible consequence requiring review';
  artifacts: string[];
}
/** Walk declared dependency directions, retaining one shortest explanation per entity. */
export function analyzeImpact(project: Project, start: string[], maxDepth = 3): Impact[] {
  const adjacent = new Map<string, { id: string; relation: string; possible: boolean }[]>();
  function add(from: string, to: string, relation: string, possible = false) {
    const list = adjacent.get(from) ?? [];
    list.push({ id: to, relation, possible });
    adjacent.set(from, list);
  }
  for (const r of Object.values(project.relationships)) {
    const mode = project.relationTypes[r.typeRef]?.impact;
    if (mode === 'source-depends-on-target') add(r.target, r.source, r.id);
    if (mode === 'target-depends-on-source') add(r.source, r.target, r.id);
    if (mode === 'possible') {
      add(r.source, r.target, r.id, true);
      add(r.target, r.source, r.id, true);
    }
  }
  const queue = start.map((id) => ({ id, path: [id], depth: 0, possible: false }));
  const seen = new Set(start);
  const result: Impact[] = [];
  while (queue.length) {
    const item = queue.shift()!;
    result.push({
      id: item.id,
      path: item.path,
      certainty: item.possible ? 'possible consequence requiring review' : 'known dependency',
      artifacts: Object.values(project.bindings)
        .filter(
          (b) => b.entityIds.includes(item.id) || b.mappings.some((m) => m.entityId === item.id),
        )
        .map((b) => b.id),
    });
    if (item.depth >= maxDepth) continue;
    for (const next of (adjacent.get(item.id) ?? []).sort((a, b) => a.id.localeCompare(b.id))) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      queue.push({
        id: next.id,
        path: [...item.path, next.relation, next.id],
        depth: item.depth + 1,
        possible: item.possible || next.possible,
      });
    }
  }
  return result;
}
