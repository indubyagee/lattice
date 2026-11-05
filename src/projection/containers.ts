import type { Appearance, ViewContainer, ViewDefinition } from '../domain/types';
import { uid } from '../domain/types';
import { ensure } from '../domain/integrity';
export type ViewItem = Appearance | ViewContainer;
export const viewItems = (view: ViewDefinition): ViewItem[] => [
  ...(view.containers ?? []),
  ...view.appearances,
];
export function worldPosition(view: ViewDefinition, id: string): { x: number; y: number } {
  const byId = new Map(viewItems(view).map((item) => [item.id, item]));
  let item = byId.get(id);
  ensure(item, 'View item missing');
  let x = item.x,
    y = item.y;
  const seen = new Set([id]);
  while (item.parentAppearanceId) {
    ensure(!seen.has(item.parentAppearanceId), 'Cyclic view grouping');
    seen.add(item.parentAppearanceId);
    item = byId.get(item.parentAppearanceId);
    ensure(item, 'Parent view item missing');
    x += item.x;
    y += item.y;
  }
  return { x, y };
}
export function descendants(view: ViewDefinition, id: string): Set<string> {
  const found = new Set<string>();
  const items = viewItems(view),
    queue = [id];
  while (queue.length) {
    const next = queue.shift()!;
    for (const item of items)
      if (item.parentAppearanceId === next && !found.has(item.id)) {
        found.add(item.id);
        queue.push(item.id);
      }
  }
  return found;
}
function replaceItems(view: ViewDefinition, replacements: Map<string, ViewItem>): ViewDefinition {
  return {
    ...view,
    appearances: view.appearances.map((a) => (replacements.get(a.id) ?? a) as Appearance),
    containers: (view.containers ?? []).map((c) => (replacements.get(c.id) ?? c) as ViewContainer),
  };
}
/** Apply simultaneous world-space moves, including selected parents and their children. */
export function moveItemsToWorld(
  view: ViewDefinition,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): ViewDefinition {
  const items = viewItems(view),
    byId = new Map(items.map((i) => [i.id, i])),
    replacements = new Map<string, ViewItem>();
  const projectedWorld = (id: string): { x: number; y: number } => {
    const p = positions.get(id);
    if (p) return p;
    const item = byId.get(id);
    ensure(item, 'View item missing');
    const parent = item.parentAppearanceId
      ? projectedWorld(item.parentAppearanceId)
      : { x: 0, y: 0 };
    return { x: parent.x + item.x, y: parent.y + item.y };
  };
  for (const item of items) {
    const p = positions.get(item.id);
    if (!p) continue;
    const parent = item.parentAppearanceId
      ? projectedWorld(item.parentAppearanceId)
      : { x: 0, y: 0 };
    replacements.set(item.id, { ...item, x: p.x - parent.x, y: p.y - parent.y });
  }
  return replaceItems(view, replacements);
}
/** Reparent without moving the items on screen or adding model relationships. */
export function reparentItems(
  view: ViewDefinition,
  ids: string[],
  parentId?: string,
): ViewDefinition {
  const byId = new Map(viewItems(view).map((item) => [item.id, item]));
  if (parentId) ensure(byId.has(parentId), 'Parent view item missing');
  const chosen = new Set(ids);
  const top = ids.filter((id) => {
    let item = byId.get(id);
    ensure(item, 'View item missing');
    const seen = new Set<string>();
    while (item.parentAppearanceId) {
      if (chosen.has(item.parentAppearanceId)) return false;
      ensure(!seen.has(item.parentAppearanceId), 'Cyclic view grouping');
      seen.add(item.parentAppearanceId);
      item = byId.get(item.parentAppearanceId);
      ensure(item, 'Parent view item missing');
    }
    return true;
  });
  const parent = parentId ? worldPosition(view, parentId) : { x: 0, y: 0 },
    replacements = new Map<string, ViewItem>();
  for (const id of top) {
    ensure(
      id !== parentId && (!parentId || !descendants(view, id).has(parentId)),
      'A container cannot be nested inside itself or its descendants',
    );
    const item = byId.get(id)!,
      position = worldPosition(view, id);
    replacements.set(id, {
      ...item,
      parentAppearanceId: parentId,
      x: position.x - parent.x,
      y: position.y - parent.y,
    });
  }
  return replaceItems(view, replacements);
}
export function addContainer(
  view: ViewDefinition,
  ids: string[] = [],
  name = 'New container',
): { view: ViewDefinition; id: string } {
  const byId = new Map(viewItems(view).map((i) => [i.id, i])),
    positions = ids.map((id) => ({ item: byId.get(id)!, position: worldPosition(view, id) }));
  const x = positions.length ? Math.min(...positions.map((p) => p.position.x)) - 32 : 40,
    y = positions.length ? Math.min(...positions.map((p) => p.position.y)) - 64 : 40;
  const width = positions.length
      ? Math.max(
          360,
          ...positions.map((p) => p.position.x + ('width' in p.item ? p.item.width : 230) - x + 32),
        )
      : 520,
    height = positions.length
      ? Math.max(
          220,
          ...positions.map(
            (p) => p.position.y + ('height' in p.item ? p.item.height : 110) - y + 32,
          ),
        )
      : 320;
  const id = uid(),
    container: ViewContainer = {
      id,
      name,
      description: 'Presentation-only group. No semantic containment is implied.',
      x,
      y,
      width,
      height,
    };
  const next = { ...view, containers: [...(view.containers ?? []), container] };
  return { view: reparentItems(next, ids, id), id };
}
/** Removing a frame retains every member, its world position, and all semantic data. */
export function removeContainer(view: ViewDefinition, id: string): ViewDefinition {
  const container = view.containers?.find((c) => c.id === id);
  ensure(container, 'Container missing');
  const children = viewItems(view)
      .filter((i) => i.parentAppearanceId === id)
      .map((i) => i.id),
    next = reparentItems(view, children, container.parentAppearanceId);
  return {
    ...next,
    containers: next.containers!.filter((c) => c.id !== id),
    collapsedIds: next.collapsedIds.filter((key) => key !== id),
  };
}
export function orderViewItems(items: ViewItem[]): ViewItem[] {
  const byId = new Map(items.map((i) => [i.id, i])),
    ordered: ViewItem[] = [],
    seen = new Set<string>();
  const place = (item: ViewItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    const parent = byId.get(item.parentAppearanceId ?? '');
    if (parent) place(parent);
    ordered.push(item);
  };
  items.forEach(place);
  return ordered;
}
