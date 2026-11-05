import { it, expect } from 'vitest';
import { ProjectSession } from '../src/main/session';
import { sessionEvent, applySessionEvent } from '../src/shared/session-events';
import type { SessionSnapshot } from '../src/shared/contracts';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEntity, typeRef } from '../src/domain/builtins';

it('projects accepted changes and check results without resending the model', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-events-'));
  let previous: SessionSnapshot | null = null,
    mirror: SessionSnapshot | null = null;
  const sizes: number[] = [];
  const host = new ProjectSession(directory, (next) => {
    const event = sessionEvent(previous, next);
    previous = next;
    mirror = applySessionEvent(mirror, event);
    expect(mirror).not.toBeNull();
    expect(mirror!.project).toEqual(next.project);
    expect(mirror!.views).toEqual(next.views);
    const sorted = (s: SessionSnapshot) => [...s.findings].sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted(mirror!)).toEqual(sorted(next));
    sizes.push(JSON.stringify(event).length);
  });
  try {
    const e = createEntity(typeRef('agent'));
    await host.commandWithAck({
      baseRevision: 0,
      reason: 'create',
      operations: [{ kind: 'create-entity', entity: e }],
    });
    await host.commandWithAck({
      baseRevision: 1,
      reason: 'rename',
      operations: [{ kind: 'update-entity', id: e.id, name: 'Changed' }],
    });
    await host.validateNow();
    expect(sizes.at(-1)!).toBeLessThan(JSON.stringify(host.snapshot()).length);
    expect(applySessionEvent(null, sessionEvent(previous, host.snapshot()))).toBeNull();
  } finally {
    await host.dispose();
  }
});
