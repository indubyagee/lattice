import type { Project, ViewKind, Views, Appearance, ViewDefinition } from '../domain/types';
import { uid, VIEW_KINDS } from '../domain/types';
import { kindOf } from '../domain/builtins';
import { ensure, object } from '../domain/integrity';
import { viewItems, worldPosition, type ViewItem } from './containers';

export function assertView(
  value: unknown,
  project: Project,
  others: Partial<Views> = {},
): asserts value is ViewDefinition {
  ensure(
    object(value) &&
      VIEW_KINDS.includes(value.id as ViewKind) &&
      Array.isArray(value.appearances) &&
      Array.isArray(value.collapsedIds) &&
      object(value.viewport),
    'Invalid view envelope',
  );
  const view = value as unknown as ViewDefinition;
  ensure(
    Number.isFinite(view.viewport.x) &&
      Number.isFinite(view.viewport.y) &&
      Number.isFinite(view.viewport.zoom) &&
      view.viewport.zoom > 0,
    'Invalid view camera',
  );
  const occupied = new Set([
    project.id,
    ...Object.keys(project.entities),
    ...Object.keys(project.relationships),
    ...Object.keys(project.bindings),
    ...Object.keys(project.instances),
    ...Object.values(others)
      .filter((v) => v.id !== view.id)
      .flatMap((v) => viewItems(v).map((a) => a.id)),
  ]);
  const byId = new Map<string, ViewItem>();
  ensure(
    view.containers === undefined || Array.isArray(view.containers),
    'Invalid view containers',
  );
  for (const c of view.containers ?? []) {
    ensure(
      object(c) &&
        !('entityId' in c) &&
        typeof c.id === 'string' &&
        c.id.length > 0 &&
        !occupied.has(c.id) &&
        typeof c.name === 'string' &&
        typeof c.description === 'string' &&
        Number.isFinite(c.x) &&
        Number.isFinite(c.y) &&
        Number.isFinite(c.width) &&
        Number.isFinite(c.height) &&
        c.width >= 240 &&
        c.height >= 120,
      'Invalid container or identity collision',
    );
    occupied.add(c.id);
    byId.set(c.id, c);
  }
  for (const a of view.appearances) {
    ensure(
      object(a) &&
        typeof a.id === 'string' &&
        typeof a.entityId === 'string' &&
        a.id.length > 0 &&
        !occupied.has(a.id) &&
        !!project.entities[a.entityId] &&
        Number.isFinite(a.x) &&
        Number.isFinite(a.y),
      'Invalid appearance or identity collision',
    );
    occupied.add(a.id);
    byId.set(a.id, a);
  }
  ensure(
    view.collapsedIds.every((id) => byId.has(id)),
    'Collapsed appearance missing',
  );
  for (const a of viewItems(view)) {
    const seen = new Set([a.id]);
    let parent = a.parentAppearanceId;
    while (parent) {
      ensure(byId.has(parent) && !seen.has(parent), 'View parent is missing or cyclic');
      seen.add(parent);
      parent = byId.get(parent)!.parentAppearanceId;
    }
  }
}

const families: Record<ViewKind, string[]> = {
  architecture: ['structure', 'purpose', 'capability', 'boundary'],
  behavior: ['behavior', 'structure', 'capability'],
  information: ['information', 'structure', 'boundary', 'behavior'],
  validation: ['purpose', 'boundary', 'structure'],
};
export function emptyViews(): Views {
  return Object.fromEntries(
    VIEW_KINDS.map((id) => [
      id,
      { id, appearances: [], collapsedIds: [], viewport: { x: 0, y: 0, zoom: 1 } },
    ]),
  ) as unknown as Views;
}
/** Preserve existing layouts. New appearances do not become semantic containment. */
export function reconcileViews(project: Project, views: Views): Views {
  const next = { ...views };
  let changed = false;
  for (const id of VIEW_KINDS) {
    const view = views[id];
    let appearances = view.appearances.filter((a) => !!project.entities[a.entityId]);
    const ids = new Set([
      ...appearances.map((a) => a.id),
      ...(view.containers ?? []).map((c) => c.id),
    ]);
    const containers = view.containers?.map((c) =>
      c.parentAppearanceId && !ids.has(c.parentAppearanceId)
        ? { ...c, ...worldPosition(view, c.id), parentAppearanceId: undefined }
        : c,
    );
    appearances = appearances.map((a) =>
      a.parentAppearanceId && !ids.has(a.parentAppearanceId)
        ? { ...a, ...worldPosition(view, a.id), parentAppearanceId: undefined }
        : a,
    );
    const present = new Set(appearances.map((a) => a.entityId));
    let index = appearances.length;
    for (const e of Object.values(project.entities)) {
      const family = project.types[e.typeRef]?.family;
      if (!present.has(e.id) && (!family || families[id].includes(family))) {
        appearances.push({
          id: uid(),
          entityId: e.id,
          x: 60 + (index % 4) * 260,
          y: 60 + Math.floor(index / 4) * 150,
        });
        index++;
      }
    }
    if (
      appearances.length !== view.appearances.length ||
      appearances.some((a, index) => a !== view.appearances[index]) ||
      containers?.some((c, index) => c !== view.containers?.[index])
    ) {
      next[id] = {
        ...view,
        appearances,
        ...(containers ? { containers } : {}),
        collapsedIds: view.collapsedIds.filter((id) => ids.has(id)),
      };
      changed = true;
    }
  }
  return changed ? next : views;
}
export function visibleProjection(
  project: Project,
  view: ViewDefinition,
  systemId?: string,
): {
  appearances: Appearance[];
  containers: NonNullable<ViewDefinition['containers']>;
  relationshipIds: string[];
} {
  let entities: Set<string> | undefined;
  if (systemId) {
    entities = new Set([
      systemId,
      ...Object.values(project.entities)
        .filter((e) => e.systemIds.includes(systemId))
        .map((e) => e.id),
    ]);
    for (const r of Object.values(project.relationships))
      if (kindOf(r.typeRef) === 'contains' && r.source === systemId) entities.add(r.target);
  }
  const collapsed = new Set(view.collapsedIds),
    byId = new Map(viewItems(view).map((a) => [a.id, a]));
  const visible = (a: ViewItem, seen = new Set<string>()): boolean => {
    if (('hidden' in a && a.hidden) || seen.has(a.id)) return false;
    seen.add(a.id);
    if (!a.parentAppearanceId) return true;
    const parent = byId.get(a.parentAppearanceId);
    return !!parent && !collapsed.has(parent.id) && visible(parent, seen);
  };
  const appearances = view.appearances.filter(
    (a) => visible(a) && (!entities || entities.has(a.entityId)),
  );
  const included = new Set(appearances.map((a) => a.id)),
    ordered: Appearance[] = [],
    placed = new Set<string>();
  const place = (a: Appearance) => {
    if (placed.has(a.id)) return;
    placed.add(a.id);
    if (a.parentAppearanceId && included.has(a.parentAppearanceId))
      place(byId.get(a.parentAppearanceId)! as Appearance);
    ordered.push(a);
  };
  appearances.forEach(place);
  const ids = new Set(appearances.map((a) => a.entityId));
  return {
    appearances: ordered,
    containers: (view.containers ?? []).filter((c) => visible(c)),
    relationshipIds: Object.values(project.relationships)
      .filter((r) => ids.has(r.source) && ids.has(r.target))
      .map((r) => r.id),
  };
}
