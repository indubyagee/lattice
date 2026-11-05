import { describe, it, expect } from 'vitest';
import { exampleProject } from '../src/domain/examples';
import { createEntity, createProject, typeRef } from '../src/domain/builtins';
import { validate, readiness } from '../src/validation/engine';
import { analyzeImpact } from '../src/validation/impact';
import { uid, ref } from '../src/domain/types';
import { digest } from '../src/domain/hash';

describe('bounded specification analysis', () => {
  it('checks custom relationship property rules against the relationship itself', () => {
    const p = createProject(),
      a = createEntity(typeRef('agent')),
      b = createEntity(typeRef('agent'));
    p.entities[a.id] = a;
    p.entities[b.id] = b;
    const d = {
      ...p.relationTypes[typeRef('depends-on')]!,
      id: 'local.reviewed-link',
      rules: [
        { kind: 'required' as const, property: 'rationale' },
        { kind: 'allowed' as const, property: 'state', values: ['reviewed'] },
      ],
    };
    p.relationTypes[ref(d)] = d;
    const id = uid();
    p.relationships[id] = {
      id,
      typeRef: ref(d),
      source: a.id,
      target: b.id,
      properties: { state: 'draft' },
      provenance: a.provenance,
    };
    const findings = validate(p).findings.filter(
      (f) => f.targets.includes(id) && ['required-0', 'allowed-1'].includes(f.rule),
    );
    expect(findings.map((f) => f.status)).toEqual(['fail', 'fail']);
    p.relationships[id]!.properties = { rationale: 'Explicit contract', state: 'reviewed' };
    expect(
      validate(p)
        .findings.filter(
          (f) => f.targets.includes(id) && ['required-0', 'allowed-1'].includes(f.rule),
        )
        .every((f) => f.status === 'pass'),
    ).toBe(true);
  });
  it('invalidates mapped artifacts when model values change while files are unchanged', () => {
    const p = createProject(),
      e = createEntity(typeRef('role'), 'Old name');
    p.entities[e.id] = e;
    const id = uid(),
      mappingId = uid();
    p.bindings[id] = {
      id,
      resource: { rootId: 'project', path: 'roles.md' },
      entityIds: [e.id],
      ownership: 'managed',
      mappings: [
        { id: mappingId, entityId: e.id, pointer: '/name', format: 'markdown', locator: 'role' },
      ],
      state: 'accepted',
      baseline: {
        modelRevision: 0,
        resourceHash: 'hash',
        mappingVersion: '1.0.0',
        content: 'Old name',
        values: { [mappingId]: 'Old name' },
      },
    };
    const inspections = [{ bindingId: id, state: 'current' as const, hash: 'hash' }];
    expect(
      validate(p, inspections).findings.find((f) => f.rule === 'artifact-freshness')!.status,
    ).toBe('pass');
    e.name = 'New name';
    expect(
      validate(p, inspections).findings.find((f) => f.rule === 'artifact-freshness')!.status,
    ).toBe('fail');
  });
  it('keeps grant, denial and unspecified use distinct with an explanatory path', () => {
    const p = createProject(),
      agent = createEntity(typeRef('agent')),
      tool = createEntity(typeRef('tool'));
    p.entities[agent.id] = agent;
    p.entities[tool.id] = tool;
    const use = {
      id: uid(),
      typeRef: typeRef('uses-tool'),
      source: agent.id,
      target: tool.id,
      properties: {},
      provenance: agent.provenance,
    };
    p.relationships[use.id] = use;
    expect(validate(p).findings.find((f) => f.rule === 'tool-access')?.status).toBe('unknown');
    const grant = { ...use, id: uid(), typeRef: typeRef('grants') };
    p.relationships[grant.id] = grant;
    expect(validate(p).findings.find((f) => f.rule === 'tool-access')?.status).toBe('pass');
    const deny = { ...use, id: uid(), typeRef: typeRef('denies') };
    p.relationships[deny.id] = deny;
    const finding = validate(p).findings.find((f) => f.rule === 'tool-access')!;
    expect(finding.status).toBe('fail');
    expect(finding.evidence).toContain(deny.id);
    expect(finding.evidence).toContain(use.id);
  });
  it('flags a removed required completion handoff', () => {
    const p = createProject();
    const completionType = { ...p.types[typeRef('task')]!, id: 'test.completion', rules: [] };
    const dispatchType = {
      ...p.types[typeRef('task')]!,
      id: 'test.dispatch',
      rules: [
        {
          kind: 'reachability' as const,
          relations: [typeRef('hands-off-to')],
          targetType: ref(completionType),
          maxDepth: 2,
        },
      ],
    };
    p.types[ref(completionType)] = completionType;
    p.types[ref(dispatchType)] = dispatchType;
    const draft = createEntity(ref(dispatchType), 'Dispatch');
    const completion = createEntity(ref(completionType), 'Completion');
    for (const entity of [draft, completion]) {
      entity.properties = {
        description: entity.name,
        inputs: 'Input',
        outputs: 'Result',
        failurePath: 'Retry',
      };
      p.entities[entity.id] = entity;
    }
    const handoff = {
      id: uid(),
      typeRef: typeRef('hands-off-to'),
      source: draft.id,
      target: completion.id,
      properties: {},
      provenance: draft.provenance,
    };
    p.relationships[handoff.id] = handoff;
    expect(
      validate(p).findings.filter((f) => f.targets.includes(draft.id) && f.status === 'fail'),
    ).toHaveLength(0);
    delete p.relationships[handoff.id];
    expect(
      validate(p).findings.some(
        (f) => f.targets.includes(draft.id) && f.message.includes('missing completion path'),
      ),
    ).toBe(true);
  });
  it('flags a missing evaluation baseline and permits non-agentic capability selection', () => {
    const p = exampleProject();
    const plan = Object.values(p.entities).find((e) => e.typeRef === typeRef('evaluation-plan'))!;
    delete plan.properties.baseline;
    expect(
      validate(p).findings.some((f) => f.targets.includes(plan.id) && f.status === 'fail'),
    ).toBe(true);
    const capability = Object.values(p.entities).find(
      (e) => e.properties.implementationKind === 'script',
    )!;
    expect(capability).toBeTruthy();
    expect(capability.typeRef).toBe(typeRef('capability'));
  });
  it('implements required, allowed, count, dependency, port, and bounded loop checks', () => {
    const p = createProject();
    const base = p.types[typeRef('capability')]!;
    const custom = {
      ...base,
      id: 'local.bounded',
      rules: [
        { kind: 'required' as const, property: 'required' },
        { kind: 'allowed' as const, property: 'state', values: ['ready'] },
        {
          kind: 'relation-count' as const,
          relation: typeRef('depends-on'),
          direction: 'out' as const,
          min: 1,
        },
        { kind: 'dependency' as const, relation: typeRef('depends-on') },
      ],
    };
    p.types[ref(custom)] = custom;
    const e = createEntity(ref(custom));
    p.entities[e.id] = e;
    expect(
      validate(p).findings.filter((f) => f.targets.includes(e.id) && f.status === 'fail'),
    ).toHaveLength(4);
    const loop = createEntity(typeRef('loop'));
    p.entities[loop.id] = loop;
    expect(
      validate(p).findings.some((f) => f.targets.includes(loop.id) && f.status === 'fail'),
    ).toBe(true);
    loop.properties.maxIterations = 4;
    expect(
      validate(p).findings.filter((f) => f.targets.includes(loop.id) && f.status === 'fail'),
    ).toHaveLength(0);
  });
  it('does not convert acknowledgement into a pass and makes old dispositions stale', () => {
    const p = exampleProject();
    const finding = validate(p).findings.find((f) => f.status === 'unknown')!;
    p.dispositions[finding.id] = {
      disposition: 'acknowledged',
      rationale: 'Test acknowledgement',
      inputHash: finding.inputHash,
    };
    expect(readiness(validate(p)).ready).toBe(false);
    p.purpose = 'changed';
    const next = validate(p).findings.find((f) => f.id === finding.id)!;
    expect(next.stale).toBe(true);
    expect(next.status).toBe('unknown');
  });
  it('terminates dependency traversal on cycles and excludes non-dependency edges', () => {
    const p = createProject();
    const a = createEntity(typeRef('task')),
      b = createEntity(typeRef('task')),
      c = createEntity(typeRef('task'));
    for (const e of [a, b, c]) p.entities[e.id] = e;
    for (const [source, target, type] of [
      [a.id, b.id, 'depends-on'],
      [b.id, a.id, 'depends-on'],
      [c.id, a.id, 'contains'],
    ]) {
      const id = uid();
      p.relationships[id] = {
        id,
        typeRef: typeRef(type!),
        source: source!,
        target: target!,
        properties: {},
        provenance: a.provenance,
      };
    }
    const impact = analyzeImpact(p, [a.id], Infinity);
    expect(impact.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
    expect(impact.find((i) => i.id === b.id)!.path).toHaveLength(3);
    expect(digest(p)).toBeTruthy();
  });
});
