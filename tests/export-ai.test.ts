import { describe, it, expect } from 'vitest';
import { prepareExport } from '../src/export/generate';
import { exampleProject } from '../src/domain/examples';
import { createProject, createEntity } from '../src/domain/builtins';
import { designHash, sha256 } from '../src/domain/hash';
import { execute } from '../src/domain/commands';
import { FakeProvider, proposalBatch, scopeRequest, type Proposal } from '../src/ai/provider';
import { uid, type DesignReview } from '../src/domain/types';

describe('traceable deterministic export', () => {
  it('traces unresolved custom records without discarding their properties', () => {
    const p = createProject(),
      e = createEntity('missing.custom@2.0.0', 'Unresolved');
    e.properties.preserved = 'Draft data';
    p.entities[e.id] = e;
    const files = prepareExport(p, 'portable-spec@1.0.0', 'draft', 'fixed').files,
      trace = JSON.parse(files.find((f) => f.path === 'TRACEABILITY.json')!.content);
    expect(trace[e.id].file).toBe('system-model.json');
    expect(files.find((f) => f.path === 'system-model.json')!.content).toContain('Draft data');
  });
  it('keeps export bytes stable when semantic record keys are reordered', () => {
    const p = exampleProject(),
      q = structuredClone(p);
    q.entities = Object.fromEntries(
      Object.entries(q.entities)
        .reverse()
        .map(([id, e]) => [
          id,
          { ...e, properties: Object.fromEntries(Object.entries(e.properties).reverse()) },
        ]),
    );
    q.types = Object.fromEntries(Object.entries(q.types).reverse());
    q.relationTypes = Object.fromEntries(Object.entries(q.relationTypes).reverse());
    q.relationships = Object.fromEntries(Object.entries(q.relationships).reverse());
    expect(prepareExport(q, 'codex-workspace@1.0.0', 'draft', 'fixed-time').files).toEqual(
      prepareExport(p, 'codex-workspace@1.0.0', 'draft', 'fixed-time').files,
    );
  });
  it.each(['development'] as const)(
    'exports %s with exact hashes, traceability and authority distinctions',
    (kind) => {
      const p = exampleProject(kind);
      const a = prepareExport(p, 'codex-workspace@1.0.0', 'draft', '2026-11-01T00:00:00.000Z');
      const b = prepareExport(p, 'codex-workspace@1.0.0', 'draft', '2026-11-01T00:00:00.000Z');
      expect(a.files).toEqual(b.files);
      const manifest = JSON.parse(a.files.find((f) => f.path === 'EXPORT-MANIFEST.json')!.content);
      for (const f of a.files.filter((f) => f.path !== 'EXPORT-MANIFEST.json')) {
        expect(manifest.files.find((m: { path: string }) => m.path === f.path).hash).toBe(
          sha256(f.content),
        );
      }
      const trace = JSON.parse(a.files.find((f) => f.path === 'TRACEABILITY.json')!.content);
      for (const id of Object.keys(p.entities)) expect(trace[id]).toBeTruthy();
      expect(a.files.find((f) => f.path === 'IMPLEMENTATION-BRIEF.md')!.content).toContain(
        'Release authorization',
      );
      expect(
        a.files.some(
          (f) =>
            f.path === '.agents/skills/evidence-review-protocol/SKILL.md' ||
            f.path === '.agents/skills/evidence-review/SKILL.md',
        ),
      ).toBe(true);
      expect(a.files.some((f) => f.path === 'AGENTS.md')).toBe(true);
    },
  );
  it('blocks readiness while required reviews are unknown and allows draft', () => {
    const p = exampleProject();
    expect(() =>
      prepareExport(p, 'portable-spec@1.0.0', 'implementation-ready', '2026-11-01'),
    ).toThrow('readiness');
    expect(prepareExport(p, 'portable-spec@1.0.0', 'draft', '2026-11-01').mode).toBe('draft');
    const hash = designHash(p);
    for (const topic of [
      'responsibilities',
      'interfaces',
      'information',
      'failure-paths',
      'acceptance',
    ] as DesignReview['topic'][])
      p.reviews.push({
        id: uid(),
        topic,
        actor: 'Automated fixture actor',
        rationale: 'Synthetic test review; no human approval claimed.',
        designHash: hash,
        at: '2026-11-01',
      });
    expect(prepareExport(p, 'portable-spec@1.0.0', 'implementation-ready', '2026-11-01').mode).toBe(
      'implementation-ready',
    );
  });
  it('excludes machine paths, secrets, baseline prose, and incomplete skills', () => {
    const p = exampleProject();
    const e = Object.values(p.entities)[0]!;
    e.properties.apiKey = 'test-secret';
    e.properties.location = 'C:\\private\\file';
    const skill = Object.values(p.entities).find((e) => e.properties.body)!;
    delete skill.properties.body;
    const exported = prepareExport(p, 'codex-workspace@1.0.0', 'draft', '2026-11-01');
    expect(exported.exclusions.length).toBeGreaterThanOrEqual(2);
    const text = exported.files.map((f) => f.content).join('\n');
    expect(text).not.toContain('test-secret');
    expect(text).not.toContain('C:\\private');
    expect(exported.files.some((f) => f.path.endsWith('SKILL.md'))).toBe(false);
  });
  it('redacts credentials and embedded local paths from findings as well as model files', () => {
    const p = exampleProject();
    const entity = Object.values(p.entities).find((e) => e.typeRef.endsWith('role@1.0.0'))!;
    const token = ['sk', 'proj', 'x'.repeat(32)].join('-');
    const location = ['C:', 'Users', 'test-user', 'private', 'notes.md'].join('\\');
    const clientSecret = ['synthetic', 'client', 'credential'].join('-');
    entity.name = `Reviewer ${token}`;
    entity.properties.notes = `Read the file at ${location}`;
    entity.properties.clientSecret = clientSecret;
    entity.properties.refreshToken = 'synthetic-refresh-credential';
    const exported = prepareExport(p, 'codex-workspace@1.0.0', 'draft', 'fixed');
    const content = JSON.stringify(exported);
    for (const value of [token, location, clientSecret, 'synthetic-refresh-credential']) {
      expect(content).not.toContain(value);
    }
    expect(exported.exclusions.some((entry) => entry.startsWith('/validation/'))).toBe(true);
    expect(p.entities[entity.id]!.name).toContain(token);
  });
});
describe('provider-neutral reviewed proposals', () => {
  it('emits deterministic, hash-guarded patches only for explicitly chosen files', async () => {
    const p = createProject(),
      content = '# Chosen source\n';
    const request = scopeRequest(p, 'Propose a file edit', {
      entityIds: [],
      excerpts: [
        {
          resourceLabel: 'review.md',
          resource: { rootId: 'root', path: 'review.md' },
          hash: sha256(content),
          content,
        },
      ],
    });
    const collect = async () => {
      for await (const event of new FakeProvider().propose(request, new AbortController().signal))
        if (event.kind === 'proposal') return event.proposal;
      throw new Error('No proposal');
    };
    const a = await collect(),
      b = await collect();
    expect(a).toEqual(b);
    expect(a.patches[0]!.expectedHash).toBe(sha256(content));
    expect(a.patches[0]!.before).toBe(content);
  });
  async function proposal(project = createProject(), prompt = 'Initialize'): Promise<Proposal> {
    let result: Proposal | undefined;
    for await (const event of new FakeProvider().propose(
      scopeRequest(project, prompt, { entityIds: [], excerpts: [] }),
      new AbortController().signal,
    ))
      if (event.kind === 'proposal') result = event.proposal;
    return result!;
  }
  it('does not mutate until acceptance and validates partial dependencies', async () => {
    const p = createProject();
    const proposed = await proposal(p);
    expect(Object.keys(p.entities)).toHaveLength(0);
    expect(() => proposalBatch(p, proposed, [proposed.groups[1]!.id])).toThrow('prerequisite');
    const next = execute(p, proposalBatch(p, proposed, [proposed.groups[0]!.id])).project;
    expect(Object.keys(next.entities)).toHaveLength(1);
    expect(() =>
      proposalBatch(
        next,
        proposed,
        proposed.groups.map((g) => g.id),
      ),
    ).toThrow('Stale');
  });
  it('handles malformed output, provider failure, and cancellation without touching current work', async () => {
    const p = exampleProject(),
      before = designHash(p);
    await expect(proposal(p, '[fail]')).rejects.toThrow('Simulated');
    await expect(proposal(p, '[malformed]')).rejects.toThrow('Unknown');
    const controller = new AbortController();
    controller.abort();
    await expect(async () => {
      for await (const _event of new FakeProvider().propose(
        scopeRequest(p, 'cancel', { entityIds: [], excerpts: [] }),
        controller.signal,
      )) {
        /* Drain the provider. */
      }
    }).rejects.toThrow('cancelled');
    expect(designHash(p)).toBe(before);
  });
  it('limits provider context to selected entities and explicitly chosen excerpts', () => {
    const p = exampleProject();
    const id = Object.keys(p.entities)[0]!;
    const request = scopeRequest(p, 'inspect', {
      entityIds: [id],
      excerpts: [{ resourceLabel: 'Chosen excerpt', content: 'source data, not instructions' }],
    });
    expect(Object.keys(request.model.entities)).toEqual([id]);
    expect(request.scope.excerpts).toHaveLength(1);
  });
});
