import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validate } from '../src/validation/engine';
import { execute } from '../src/domain/commands';
import { performanceProject } from './fixtures/performance';

it('measures deterministic validation on the seeded 500/1,000 fixture', async () => {
  let project = performanceProject();
  for (let i = 0; i < 5; i++) validate(project);
  const samples: number[] = [];
  for (let i = 0; i < 25; i++) {
    project = execute(project, {
      baseRevision: project.revision,
      reason: 'Performance sample',
      operations: [{ kind: 'update-entity', id: 'entity-1', name: `Measured ${i}` }],
    }).project;
    const start = performance.now();
    validate(project);
    samples.push(performance.now() - start);
  }
  const ordered = [...samples].sort((a, b) => a - b),
    p95 = ordered[Math.ceil(ordered.length * 0.95) - 1]!;
  const result = {
    kind: 'deterministic validation after property edit',
    entities: 500,
    relationships: 1000,
    warmups: 5,
    samples: samples.length,
    p95Ms: p95,
    maxMs: Math.max(...samples),
    targetMs: 1000,
    platform: process.platform,
    os: os.release(),
    cpu: os.cpus()[0]?.model,
    node: process.version,
    measuredAt: new Date().toISOString(),
  };
  const destination =
    process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-evidence');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(
    path.join(destination, 'validation-performance.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  expect(p95).toBeLessThan(1000);
});
