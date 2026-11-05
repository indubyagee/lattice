import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createEntity, createProject, typeRef, kindOf } from '../src/domain/builtins';
import { provenance } from '../src/domain/types';
import {
  addContainer,
  reparentItems,
  removeContainer,
  worldPosition,
  moveItemsToWorld,
} from '../src/projection/containers';
import { assertView, reconcileViews, emptyViews, visibleProjection } from '../src/projection/views';
import { edgePresentation, immediateConnections } from '../src/projection/graph-presentation';
import { DEFAULT_PREFERENCES, parsePreferences } from '../src/shared/preferences';
import { PreferencesService } from '../src/main/preferences';
import { ProjectSession } from '../src/main/session';
import { COMPONENT_HELP } from '../src/renderer/help-content';
import { buildScene, type SceneCache } from '../src/renderer/graph-scene';

function fixture() {
  const project = createProject();
  for (const name of ['A', 'B', 'C']) {
    const e = createEntity(typeRef('system'), name);
    project.entities[e.id] = e;
  }
  const views = reconcileViews(project, emptyViews());
  return { project, views, view: views.architecture };
}
describe('presentation containers', () => {
  it('moves a frame and a selected child simultaneously without adding the parent delta twice', () => {
    const { view } = fixture(),
      a = view.appearances[0]!,
      frame = addContainer(view, [a.id]),
      moves = new Map([
        [frame.id, { x: 400, y: 300 }],
        [a.id, { x: 460, y: 380 }],
      ]),
      next = moveItemsToWorld(frame.view, moves);
    expect(worldPosition(next, frame.id)).toEqual(moves.get(frame.id));
    expect(worldPosition(next, a.id)).toEqual(moves.get(a.id));
  });
  it('groups and nests without changing semantic data and retains world positions on removal', () => {
    const { project, view } = fixture(),
      before = structuredClone(project),
      ids = view.appearances.map((a) => a.id),
      original = ids.map((id) => worldPosition(view, id));
    const inner = addContainer(view, ids.slice(0, 2), 'Inner');
    const outer = addContainer(inner.view, [inner.id], 'Outer');
    expect(ids.map((id) => worldPosition(outer.view, id))).toEqual(original);
    expect(outer.view.containers!.find((c) => c.id === inner.id)!.parentAppearanceId).toBe(
      outer.id,
    );
    const removed = removeContainer(outer.view, inner.id);
    expect(ids.map((id) => worldPosition(removed, id))).toEqual(original);
    expect(removed.appearances[0]!.parentAppearanceId).toBe(outer.id);
    expect(project).toEqual(before);
    assertView(removed, project);
  });
  it('rejects cyclic nesting and colliding identities; collapsing hides descendants and links', () => {
    const { project, view } = fixture(),
      [a, b] = view.appearances;
    project.relationships.r = {
      id: 'r',
      typeRef: typeRef('depends-on'),
      source: a!.entityId,
      target: b!.entityId,
      properties: {},
      provenance: provenance(),
    };
    const inner = addContainer(view, [a!.id, b!.id]);
    const outer = addContainer(inner.view, [inner.id]);
    expect(() => reparentItems(outer.view, [outer.id], inner.id)).toThrow('descendants');
    const malformed = structuredClone(outer.view);
    malformed.containers![0]!.id = a!.entityId;
    expect(() => assertView(malformed, project)).toThrow('collision');
    const cycle = structuredClone(outer.view);
    cycle.containers![1]!.parentAppearanceId = inner.id;
    expect(() => assertView(cycle, project)).toThrow('cyclic');
    const visible = visibleProjection(project, { ...outer.view, collapsedIds: [outer.id] });
    expect(visible.appearances.map((a) => a.entityId)).toEqual([view.appearances[2]!.entityId]);
    expect(visible.containers.map((c) => c.id)).toEqual([outer.id]);
    expect(visible.relationshipIds).toEqual([]);
  });
  it('preserves coordinates when a semantic edit removes a legacy appearance parent', () => {
    const { project, views, view } = fixture();
    const [parent, child] = view.appearances;
    const frame = addContainer(view, []);
    frame.view.appearances[1] = { ...child!, parentAppearanceId: parent!.id, x: 10, y: 20 };
    frame.view.containers![0]!.parentAppearanceId = parent!.id;
    const expected = worldPosition(frame.view, child!.id),
      expectedFrame = worldPosition(frame.view, frame.id);
    delete project.entities[parent!.entityId];
    views.architecture = frame.view;
    const result = reconcileViews(project, views).architecture;
    expect(worldPosition(result, child!.id)).toEqual(expected);
    expect(worldPosition(result, frame.id)).toEqual(expectedFrame);
    assertView(result, project);
  });
  it('saves, reopens and undoes grouping independently of semantic history and other views', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-frames-')),
      session = new ProjectSession(path.join(dir, 'settings'));
    try {
      await session.create(path.join(dir, 'project'), 'Frames', '');
      const e = createEntity(typeRef('system'), 'Shared');
      await session.command({
        baseRevision: 0,
        reason: 'Entity',
        operations: [{ kind: 'create-entity', entity: e }],
      });
      const initial = session.snapshot(),
        grouped = addContainer(initial.views.architecture, [
          initial.views.architecture.appearances[0]!.id,
        ]);
      await session.saveView(grouped.view);
      expect(session.project.revision).toBe(1);
      expect(session.snapshot().views.information).toEqual(initial.views.information);
      await session.viewHistory('architecture', false);
      expect(session.snapshot().views.architecture.containers).toBeUndefined();
      expect(session.project.entities[e.id]).toBeDefined();
      await session.saveView(grouped.view);
      await session.save();
      await session.close();
      await session.open(path.join(dir, 'project'));
      const reopened = session.snapshot().views.architecture;
      expect(reopened.containers).toEqual(grouped.view.containers);
      expect(reopened.appearances[0]!.parentAppearanceId).toBe(grouped.id);
      expect(session.project.revision).toBe(1);
    } finally {
      await session.dispose();
    }
  });
});
describe('diagram semantics and help', () => {
  it('uses independent patterns, directed-endpoint cues and declared importance', () => {
    const reads = edgePresentation(typeRef('reads'), {}, 'light'),
      denial = edgePresentation(typeRef('denies'), {}, 'dark'),
      contains = edgePresentation(typeRef('contains'), {}, 'light');
    expect(reads.dash).toBe('6 4');
    expect(reads.description).toContain('reader to its source');
    expect(denial.denial).toBe(true);
    expect(contains.contains).toBe(true);
    expect(edgePresentation(typeRef('checked-by'), {}, 'light').dash).toBe('2 5');
    expect(
      edgePresentation(typeRef('reads'), { importance: 'critical' }, 'light', false, true).width,
    ).toBeGreaterThan(reads.width);
    expect(edgePresentation(typeRef('reads'), {}, 'dark').color).not.toBe(reads.color);
  });
  it('highlights one-hop adjacency through cycles without including the next hop', () => {
    const { project } = fixture(),
      [a, b, c] = Object.keys(project.entities);
    for (const [id, source, target] of [
      ['ab', a!, b!],
      ['bc', b!, c!],
      ['ba', b!, a!],
    ])
      project.relationships[id!] = {
        id: id!,
        source: source!,
        target: target!,
        typeRef: typeRef('depends-on'),
        properties: {},
        provenance: provenance(),
      };
    const adjacent = immediateConnections(project, [a!]);
    expect([...adjacent.nodes]).toEqual([b]);
    expect([...adjacent.edges]).toEqual(['ab', 'ba']);
  });
  it('provides component-specific usage help for every built-in toolbox item', () => {
    for (const reference of Object.keys(createProject().types))
      expect(COMPONENT_HELP[kindOf(reference)]?.length, reference).toBeGreaterThan(60);
  });
});
describe('graph connection visibility', () => {
  it('toggles edges at either system endpoint, retaining nodes, peer edges and model data', () => {
    const project = createProject(),
      system = createEntity(typeRef('system'), 'System'),
      agent = createEntity(typeRef('agent'), 'Agent'),
      subsystem = createEntity(typeRef('subsystem'), 'Subsystem');
    for (const entity of [system, agent, subsystem]) project.entities[entity.id] = entity;
    for (const [id, source, target] of [
      ['system-out', system.id, agent.id],
      ['system-in', subsystem.id, system.id],
      ['system-self', system.id, system.id],
      ['peers', agent.id, subsystem.id],
    ])
      project.relationships[id!] = {
        id: id!,
        source: source!,
        target: target!,
        typeRef: typeRef('depends-on'),
        properties: {},
        provenance: provenance(),
      };
    const layout = reconcileViews(project, emptyViews()).architecture,
      projection = visibleProjection(project, layout),
      cache: SceneCache = { nodes: new Map(), edges: new Map() },
      before = JSON.stringify({ project, layout }),
      scene = (show?: boolean) =>
        buildScene(
          project,
          layout,
          projection,
          [agent.id],
          null,
          { counts: new Map(), failed: new Set() },
          'light',
          cache,
          show,
        );
    const hidden = scene();
    expect(hidden.edges.map((e) => e.id)).toEqual(['peers']);
    expect(hidden.nodes).toHaveLength(3);
    expect(hidden.nodes.find((n) => n.data.label === 'System')!.data.neighbor).toBe(false);
    expect(hidden.nodes.find((n) => n.data.label === 'Subsystem')!.data.neighbor).toBe(true);
    const shown = scene(true);
    expect(shown.edges.map((e) => e.id)).toEqual([
      'system-out',
      'system-in',
      'system-self',
      'peers',
    ]);
    expect(shown.nodes.find((n) => n.data.label === 'System')!.data.neighbor).toBe(true);
    expect(scene(false).edges).toEqual(hidden.edges);
    expect(scene(true).edges[0]).toBe(shown.edges[0]);
    expect(JSON.stringify({ project, layout })).toBe(before);
  });
});

describe('local appearance preferences', () => {
  it('defaults new graph controls off when loading older preferences', () => {
    const legacy: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
    delete legacy.showSystemConnections;
    delete legacy.graphTooltips;
    expect(parsePreferences(legacy)).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES).toMatchObject({
      showSystemConnections: false,
      graphTooltips: false,
    });
  });
  it.each(['showSystemConnections', 'graphTooltips'])('rejects invalid %s values', (key) => {
    for (const value of ['false', 0, null])
      expect(() => parsePreferences({ ...DEFAULT_PREFERENCES, [key]: value })).toThrow();
  });
  it('rejects malformed settings and ignores unrelated data', () => {
    expect(() => parsePreferences({ ...DEFAULT_PREFERENCES, uiFontSize: 99 })).toThrow();
    expect(() => parsePreferences({ ...DEFAULT_PREFERENCES, editorFont: 'bad\nfont' })).toThrow();
    expect(parsePreferences({ ...DEFAULT_PREFERENCES, extra: 'unused' })).toEqual(
      DEFAULT_PREFERENCES,
    );
  });
  it('persists themes and font sizes locally and recovers from invalid settings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-fonts-')),
      service = new PreferencesService(dir);
    expect(await service.read()).toEqual(DEFAULT_PREFERENCES);
    await service.write({
      ...DEFAULT_PREFERENCES,
      theme: 'dark',
      uiFontSize: 14,
      editorFontSize: 16,
      showSystemConnections: true,
      graphTooltips: true,
    });
    expect(await new PreferencesService(dir).read()).toMatchObject({
      theme: 'dark',
      uiFontSize: 14,
      editorFontSize: 16,
      showSystemConnections: true,
      graphTooltips: true,
    });
    await fs.writeFile(path.join(dir, 'appearance.json'), '{ invalid');
    expect(await service.read()).toEqual(DEFAULT_PREFERENCES);
  });
});
