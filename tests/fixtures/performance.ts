import { createEntity, createProject, typeRef } from '../../src/domain/builtins';
import type { Project } from '../../src/domain/types';
/** Fixed identities and LCG seed make topology and serialized data reproducible. */
export function performanceProject(): Project {
  const p = createProject(
    '500-entity performance fixture',
    'Measure authoring and deterministic specification checks; no runtime execution is claimed.',
  );
  p.id = 'performance-project';
  for (let i = 0; i < 500; i++) {
    const e = createEntity(
      typeRef(i === 0 ? 'system' : 'agent'),
      `Component ${i.toString().padStart(3, '0')}`,
    );
    e.id = `entity-${i}`;
    e.provenance = { actor: 'fixture', at: '2026-11-01T00:00:00.000Z' };
    e.properties.description = `Stable fixture component ${i}`;
    p.entities[e.id] = e;
  }
  let seed = 1729;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % 500;
  };
  for (let i = 0; i < 1000; i++) {
    const source = `entity-${random()}`,
      target = `entity-${random()}`;
    p.relationships[`relationship-${i}`] = {
      id: `relationship-${i}`,
      typeRef: typeRef('depends-on'),
      source,
      target,
      properties: {},
      provenance: { actor: 'fixture', at: '2026-11-01T00:00:00.000Z' },
    };
  }
  return p;
}
