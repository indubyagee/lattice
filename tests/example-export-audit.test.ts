import { it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exampleProject } from '../src/domain/examples';
import { prepareExport } from '../src/export/generate';
import { sha256 } from '../src/domain/hash';
import { kindOf } from '../src/domain/builtins';

it.each(['development'] as const)(
  'writes the actual %s draft export for implementation-planning review',
  async (kind) => {
    const p = exampleProject(kind),
      preview = prepareExport(p, 'codex-workspace@1.0.0', 'draft', '2026-11-01T00:00:00.000Z');
    const root = path.join(
      process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-evidence'),
      'examples',
      kind,
    );
    for (const file of preview.files) {
      const target = path.join(root, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, 'utf8');
      expect(sha256(await fs.readFile(target, 'utf8'))).toBe(file.hash);
    }
    const spec = preview.files.find((f) => f.path === 'SYSTEM-SPECIFICATION.md')!.content;
    for (const section of [
      'Architecture and responsibilities',
      'Behavior and failure paths',
      'Information and contracts',
      'Authority and validation',
    ])
      expect(spec).toContain(section);
    const tasks = Object.values(p.entities).filter((e) => kindOf(e.typeRef) === 'task');
    expect(
      tasks.every((e) => e.properties.inputs && e.properties.outputs && e.properties.failurePath),
    ).toBe(true);
    const trace = JSON.parse(preview.files.find((f) => f.path === 'TRACEABILITY.json')!.content);
    for (const id of Object.keys(p.entities)) expect(trace[id]).toBeTruthy();
    expect(p.reviews).toEqual([]);
    expect(
      preview.validation.findings.filter(
        (f) => f.rule.startsWith('review-') && f.status === 'unknown',
      ),
    ).toHaveLength(5);
  },
);
