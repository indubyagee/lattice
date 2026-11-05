import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicText, fileHash, hashOnDisk, WorkspaceFiles } from '../src/main/files';
import { ProjectSession } from '../src/main/session';
import { createEntity, typeRef } from '../src/domain/builtins';
import { uid } from '../src/domain/types';

let directory: string;
const sessions: ProjectSession[] = [];
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-host-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(sessions.splice(0).map((s) => s.dispose()));
});
function files() {
  return new WorkspaceFiles(new Map([['root', directory]]), path.join(directory, 'journals'));
}
describe('scoped files and durable batches', () => {
  it('retains a flushed staging file when replacement fails', async () => {
    const file = path.join(directory, 'durable.txt');
    await fs.writeFile(file, 'original');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Injected replacement failure'));
    await expect(atomicText(file, 'recoverable')).rejects.toThrow('Injected');
    expect(await fs.readFile(file, 'utf8')).toBe('original');
    const stages = (await fs.readdir(directory)).filter((name) => name.includes('.tmp'));
    expect(stages.length).toBe(1);
    expect(await fs.readFile(path.join(directory, stages[0]!), 'utf8')).toBe('recoverable');
  });
  it('rejects relative traversal, absolute paths and symlink/junction escape', async () => {
    const service = files();
    await expect(service.resolve({ rootId: 'root', path: '../outside' }, true)).rejects.toThrow(
      'outside',
    );
    await expect(
      service.resolve({ rootId: 'root', path: path.resolve(directory, '..', 'outside') }, true),
    ).rejects.toThrow('relative');
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-outside-'));
    await fs.symlink(
      outside,
      path.join(directory, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(service.resolve({ rootId: 'root', path: 'escape/new.md' }, true)).rejects.toThrow(
      'escapes',
    );
  });
  it('preserves newer external edits and the original file on CAS failure', async () => {
    const file = path.join(directory, 'note.md');
    await atomicText(file, 'loaded');
    const hash = (await hashOnDisk(file))!;
    await fs.writeFile(file, 'external');
    await expect(atomicText(file, 'overwrite', hash)).rejects.toThrow('changed');
    expect(await fs.readFile(file, 'utf8')).toBe('external');
    expect((await fs.readdir(directory)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
  it('retains UTF-8 BOM and CRLF; marks binary, mixed EOL and invalid UTF-8 read-only', async () => {
    await fs.writeFile(path.join(directory, 'utf.md'), '\uFEFFalpha\r\nbeta\r\n');
    const good = await files().read({ rootId: 'root', path: 'utf.md' });
    expect(good.editable).toBe(true);
    expect(good.bom).toBe(true);
    expect(good.eol).toBe('CRLF');
    expect(fileHash(good.content!)).toBe(good.hash);
    await fs.writeFile(path.join(directory, 'bad.bin'), Buffer.from([0, 255, 1]));
    expect((await files().read({ rootId: 'root', path: 'bad.bin' })).editable).toBe(false);
    await fs.writeFile(path.join(directory, 'mixed.md'), 'a\r\nb\nc');
    expect((await files().read({ rootId: 'root', path: 'mixed.md' })).editable).toBe(false);
  });
  it('resumes an interrupted multi-file batch and reverses only unchanged results', async () => {
    const service = files();
    await fs.writeFile(path.join(directory, 'a.md'), 'old a');
    await fs.writeFile(path.join(directory, 'b.md'), 'old b');
    const status = await service.prepare(
      [
        {
          resource: { rootId: 'root', path: 'a.md' },
          expectedHash: fileHash('old a'),
          content: 'new a',
        },
        {
          resource: { rootId: 'root', path: 'b.md' },
          expectedHash: fileHash('old b'),
          content: 'new b',
        },
      ],
      'fixture batch',
    );
    await expect(
      service.run(status, false, (index) => {
        if (index === 0) throw new Error('injected interruption');
      }),
    ).rejects.toThrow('injected');
    const interrupted = (await service.statuses())[0]!;
    expect(interrupted.state).toBe('interrupted');
    expect(interrupted.files[0]!.state).toBe('written');
    const complete = await service.run(interrupted);
    expect(complete.state).toBe('complete');
    await fs.writeFile(path.join(directory, 'a.md'), 'later user work');
    await expect(service.run(complete, true)).rejects.toThrow('Newer');
    expect(await fs.readFile(path.join(directory, 'a.md'), 'utf8')).toBe('later user work');
    await fs.writeFile(path.join(directory, 'a.md'), 'new a');
    const reversed = await service.run(complete, true);
    expect(reversed.state).toBe('reversed');
    expect(await fs.readFile(path.join(directory, 'a.md'), 'utf8')).toBe('old a');
  });
  it('offers rename candidates only from unchanged hashes', async () => {
    const service = files();
    await fs.writeFile(path.join(directory, 'renamed.md'), 'same');
    expect(
      await service.renameCandidates({ rootId: 'root', path: 'missing.md' }, fileHash('same')),
    ).toEqual([{ rootId: 'root', path: 'renamed.md' }]);
  });
});
describe('project sessions', () => {
  it('refuses to create project storage over unrelated existing files', async () => {
    const s = new ProjectSession(path.join(directory, 'settings'));
    sessions.push(s);
    const root = path.join(directory, 'nonempty');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'notes.md'), 'Preserve this');
    await expect(s.create(root, 'Unsafe location', '')).rejects.toThrow('empty folder');
    expect(await fs.readFile(path.join(root, 'notes.md'), 'utf8')).toBe('Preserve this');
  });
  it('recovers an unsaved workspace from application-local storage', async () => {
    const settings = path.join(directory, 'draft-settings');
    const first = new ProjectSession(settings);
    sessions.push(first);
    const e = createEntity(typeRef('agent'), 'Unsaved but recoverable');
    await first.command({
      baseRevision: 0,
      reason: 'Draft edit',
      operations: [{ kind: 'create-entity', entity: e }],
    });
    await first.close();
    const second = new ProjectSession(settings);
    sessions.push(second);
    await second.offerLocalDraft();
    expect(second.snapshot().recovery?.compatible).toBe(true);
    await second.recover();
    expect(second.project.entities[e.id]!.name).toBe('Unsaved but recoverable');
    expect(second.snapshot().directory).toBeNull();
  });
  it('rebinds a named workspace without changing entity, project, or root identities', async () => {
    const settings = path.join(directory, 'root-settings'),
      s = new ProjectSession(settings);
    sessions.push(s);
    const root = path.join(directory, 'project'),
      first = path.join(directory, 'files'),
      moved = path.join(directory, 'moved-files');
    await fs.mkdir(first);
    await fs.mkdir(moved);
    await s.create(root, 'Portable roots', 'Keep identities');
    const e = createEntity(typeRef('agent'));
    await s.command({
      baseRevision: 0,
      reason: 'entity',
      operations: [{ kind: 'create-entity', entity: e }],
    });
    await s.attachRoot(first, 'Evidence');
    const id = [...s.roots.keys()].find((id) => id !== 'project')!;
    const revision = s.project.revision,
      projectId = s.project.id;
    await s.attachRoot(moved, 'Evidence', id);
    expect(s.project.id).toBe(projectId);
    expect(s.project.entities[e.id]).toBeDefined();
    expect(s.project.revision).toBe(revision);
    expect(s.project.extensions.workspaceRoots).toEqual({ [id]: 'Evidence' });
    expect(s.roots.get(id)).toBe(moved);
  });
  async function session() {
    const s = new ProjectSession(path.join(directory, 'settings'));
    sessions.push(s);
    return s;
  }
  it('stops project writes after the real lease heartbeat detects lock loss', async () => {
    const s = await session(),
      root = path.join(directory, 'lost-lease');
    await s.create(root, 'Lease', 'Test compromise');
    const lock = path.join(root, 'project.json.lock');
    expect(path.dirname(lock)).toBe(root);
    await fs.rmdir(lock);
    await vi.waitFor(() => expect(s.snapshot().readOnly).toBe(true), {
      timeout: 7000,
      interval: 50,
    });
    await expect(
      s.command({
        baseRevision: s.project.revision,
        reason: 'Must be blocked',
        operations: [{ kind: 'create-entity', entity: createEntity(typeRef('agent')) }],
      }),
    ).rejects.toThrow('read-only');
    expect(JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8')).revision).toBe(0);
  }, 10000);
  it('requires confirmation for an unchanged-file rename and retains files after detachment', async () => {
    const s = await session(),
      root = path.join(directory, 'renamed-binding');
    await s.create(root, 'Rename', 'Keep resource identity');
    const old = { rootId: 'project', path: 'old.md' };
    await fs.writeFile(path.join(root, old.path), 'Independent');
    const id = uid();
    await s.putBinding({
      id,
      resource: old,
      entityIds: [],
      ownership: 'independent',
      mappings: [],
      state: 'unreviewed',
    });
    await s.acceptReconciliation(await s.reconciliation(id), {});
    await fs.rename(path.join(root, 'old.md'), path.join(root, 'renamed.md'));
    await s.inspect();
    expect(s.snapshot().inspections.find((i) => i.bindingId === id)?.state).toBe('missing');
    const candidates = await s.renameCandidates(id);
    expect(candidates).toEqual([{ rootId: 'project', path: 'renamed.md' }]);
    expect(s.project.bindings[id]!.resource.path).toBe('old.md');
    await s.confirmRename(id, candidates[0]!);
    expect(s.project.bindings[id]!.resource.path).toBe('renamed.md');
    await s.detachBinding(id);
    expect(await fs.readFile(path.join(root, 'renamed.md'), 'utf8')).toBe('Independent');
  });
  it('applies reviewed file patches with fresh hashes and rejects changes made since review', async () => {
    const s = await session();
    await s.create(path.join(directory, 'patch-project'), 'Patches', 'Review file diffs');
    const resource = { rootId: 'project', path: 'notes.md' },
      content = '# Notes\n';
    await fs.writeFile(await s.files().resolve(resource, true), content);
    const file = await s.files().read(resource);
    const scope = {
      entityIds: [],
      excerpts: [{ resourceLabel: 'notes.md', resource, hash: file.hash, content }],
    };
    const proposal = await s.propose('Propose a patch', scope);
    await s.acceptFilePatch(proposal.id, 0);
    expect((await s.files().read(resource)).content).toContain('Simulated suggestion');
    await expect(s.acceptFilePatch(proposal.id, 0)).rejects.toThrow('changed');
  });
  it('rejects cyclic groups and collisions between semantic and appearance identities', async () => {
    const s = await session();
    await s.example('development');
    const v = s.snapshot().views.architecture;
    v.appearances[0]!.parentAppearanceId = v.appearances[1]!.id;
    v.appearances[1]!.parentAppearanceId = v.appearances[0]!.id;
    await expect(s.saveView(v)).rejects.toThrow('cyclic');
    delete v.appearances[0]!.parentAppearanceId;
    delete v.appearances[1]!.parentAppearanceId;
    v.appearances[0]!.id = v.appearances[0]!.entityId;
    await expect(s.saveView(v)).rejects.toThrow('collision');
  });
  it('saves/reopens stable identities and excludes machine root mappings from canonical data', async () => {
    const s = await session(),
      root = path.join(directory, 'project');
    await s.create(root, 'Fixture', 'Test persistence');
    const e = createEntity(typeRef('agent'), 'Coordinator');
    await s.command({
      baseRevision: 0,
      reason: 'create',
      operations: [{ kind: 'create-entity', entity: e }],
    });
    const v = s.snapshot().views.information;
    v.appearances[0]!.x = 654;
    await s.saveView(v);
    await s.save();
    const saved = await fs.readFile(path.join(root, 'project.json'), 'utf8');
    expect(saved).not.toContain(directory.replace(/\\/g, '\\\\'));
    await s.close();
    const reopened = await session();
    await reopened.open(root);
    expect(reopened.project.entities[e.id]!.name).toBe('Coordinator');
    expect(reopened.views.information.appearances[0]!.x).toBe(654);
    expect(reopened.project.revision).toBe(1);
  });
  it('opens a second writable instance read-only and supports moved project root rebinding', async () => {
    const a = await session(),
      b = await session();
    const root = path.join(directory, 'project');
    await a.create(root, 'Fixture', 'Read-only lease');
    await b.open(root);
    expect(b.snapshot().readOnly).toBe(true);
    await expect(
      b.command({
        baseRevision: 0,
        reason: 'blocked',
        operations: [{ kind: 'create-entity', entity: createEntity(typeRef('agent')) }],
      }),
    ).rejects.toThrow('read-only');
    await b.close();
    await a.close();
    const moved = path.join(directory, 'moved');
    await fs.cp(root, moved, { recursive: true });
    await b.open(moved);
    expect(b.project.id).toBe(a.project.id);
    expect(b.roots.get('project')).toBe(moved);
  });
  it('retains invalid canonical external edits without destroying the in-memory model', async () => {
    const s = await session(),
      root = path.join(directory, 'project');
    await s.create(root, 'Valid model', 'Keep current');
    await fs.writeFile(path.join(root, 'project.json'), '{invalid');
    await s.inspect();
    expect(s.snapshot().external?.valid).toBe(false);
    expect(s.project.name).toBe('Valid model');
    await expect(s.save()).rejects.toThrow('external');
    await s.resolveExternal('keep');
    expect(JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8')).name).toBe(
      'Valid model',
    );
  });
  it('requires explicit review after canonical deletion and preserves malformed layouts', async () => {
    const s = await session(),
      root = path.join(directory, 'deleted-model');
    await s.create(root, 'Recoverable', 'Explicit restore');
    await fs.unlink(path.join(root, 'project.json'));
    await s.inspect();
    expect(s.snapshot().external?.message).toContain('missing');
    await expect(s.save()).rejects.toThrow('external');
    await s.resolveExternal('keep');
    expect(JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8')).name).toBe(
      'Recoverable',
    );
    await s.close();
    await fs.writeFile(path.join(root, 'views', 'architecture.json'), '{invalid layout');
    const reopened = await session();
    await reopened.open(root);
    const copies = (await fs.readdir(path.join(root, '.lattice', 'recovery'))).filter((name) =>
      name.startsWith('invalid-architecture-'),
    );
    expect(copies.length).toBe(1);
    expect(await fs.readFile(path.join(root, '.lattice', 'recovery', copies[0]!), 'utf8')).toBe(
      '{invalid layout',
    );
  });
  it('recovers the acknowledged semantic snapshot after a fault during canonical replacement', async () => {
    const s = await session(),
      root = path.join(directory, 'project');
    await s.create(root, 'Recovery', 'Test interrupted save');
    const e = createEntity(typeRef('agent'), 'Recover me');
    await s.command({
      baseRevision: 0,
      reason: 'journal this',
      operations: [{ kind: 'create-entity', entity: e }],
    });
    const rename = fs.rename.bind(fs);
    const failure = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === path.join(root, 'project.json'))
        throw new Error('Injected Windows sharing violation');
      return rename(from, to);
    });
    await expect(s.save()).rejects.toThrow('Injected');
    await s.close();
    failure.mockRestore();
    const recovered = await session();
    await recovered.open(root);
    expect(recovered.snapshot().recovery?.compatible).toBe(true);
    await recovered.recover();
    expect(recovered.project.entities[e.id]!.name).toBe('Recover me');
    expect(recovered.project.revision).toBe(1);
  });
  it('keeps raw associated saves pending until association review', async () => {
    const s = await session(),
      root = path.join(directory, 'project');
    await s.create(root, 'Bindings', 'Test freshness');
    await fs.writeFile(path.join(root, 'notes.md'), 'independent');
    const id = uid();
    await s.putBinding({
      id,
      resource: { rootId: 'project', path: 'notes.md' },
      entityIds: [],
      ownership: 'independent',
      mappings: [],
      state: 'unreviewed',
    });
    const preview = await s.reconciliation(id);
    await s.acceptReconciliation(preview, {});
    expect(s.project.bindings[id]!.state).toBe('accepted');
    const read = await s.files().read({ rootId: 'project', path: 'notes.md' });
    await s.saveResource(read.resource, 'edited raw text', read.hash);
    expect(s.project.bindings[id]!.state).toBe('pending');
    await s.undo();
    expect((await s.files().read(read.resource)).content).toBe('edited raw text');
  });
});
