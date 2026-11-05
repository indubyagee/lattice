export interface SnapNode {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}
export interface SnapOptions {
  snapToGrid: boolean;
  snapToObjects: boolean;
  gridSize: number;
  snapDistance: number;
}
export interface SnapGuide {
  axis: 'x' | 'y';
  value: number;
  from: number;
  to: number;
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Snap a rigid selection in world coordinates; return relative positions for its root items. */
export function alignNodes(
  nodes: SnapNode[],
  movingIds: string[],
  options: SnapOptions,
  zoom = 1,
): { positions: Map<string, { x: number; y: number }>; guides: SnapGuide[] } {
  const positions = new Map<string, { x: number; y: number }>(),
    guides: SnapGuide[] = [];
  if (!movingIds.length || (!options.snapToGrid && !options.snapToObjects))
    return { positions, guides };
  const byId = new Map(nodes.map((n) => [n.id, n])),
    moving = new Set(movingIds),
    cache = new Map<string, { x: number; y: number }>();
  const ancestors = (id: string) => {
    const found = new Set<string>();
    let parent = byId.get(id)?.parentId;
    while (parent && !found.has(parent)) {
      found.add(parent);
      parent = byId.get(parent)?.parentId;
    }
    return found;
  };
  const world = (id: string): { x: number; y: number } => {
    const known = cache.get(id);
    if (known) return known;
    const n = byId.get(id)!;
    const p = n.parentId && byId.has(n.parentId) ? world(n.parentId) : { x: 0, y: 0 };
    const value = { x: n.position.x + p.x, y: n.position.y + p.y };
    cache.set(id, value);
    return value;
  };
  const roots = movingIds.filter(
    (id) => byId.has(id) && ![...ancestors(id)].some((a) => moving.has(a)),
  );
  if (!roots.length) return { positions, guides };
  const rect = (id: string): Rect => ({
      ...world(id),
      width: byId.get(id)!.width,
      height: byId.get(id)!.height,
    }),
    rects = roots.map(rect),
    x = Math.min(...rects.map((r) => r.x)),
    y = Math.min(...rects.map((r) => r.y));
  const bounds = {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
  const rootSet = new Set(roots),
    parents = new Set(roots.flatMap((id) => [...ancestors(id)]));
  const targets = options.snapToObjects
    ? nodes
        .filter(
          (n) =>
            !rootSet.has(n.id) &&
            !parents.has(n.id) &&
            ![...ancestors(n.id)].some((a) => rootSet.has(a)),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((n) => rect(n.id))
    : [];
  const anchors = (r: Rect, axis: 'x' | 'y') => {
    const start = r[axis],
      size = axis === 'x' ? r.width : r.height;
    return [start, start + size / 2, start + size];
  };
  const threshold = options.snapDistance / Math.max(zoom, 0.15);
  const matches: {
    x?: { delta: number; value: number; target: Rect };
    y?: { delta: number; value: number; target: Rect };
  } = {};
  for (const axis of ['x', 'y'] as const)
    for (const target of targets)
      for (const to of anchors(target, axis))
        for (const from of anchors(bounds, axis)) {
          const delta = to - from;
          if (
            Math.abs(delta) <= threshold &&
            (!matches[axis] || Math.abs(delta) < Math.abs(matches[axis]!.delta))
          )
            matches[axis] = { delta, value: to, target };
        }
  const dx =
      matches.x?.delta ??
      (options.snapToGrid ? Math.round(x / options.gridSize) * options.gridSize - x : 0),
    dy =
      matches.y?.delta ??
      (options.snapToGrid ? Math.round(y / options.gridSize) * options.gridSize - y : 0);
  for (const id of roots) {
    const n = byId.get(id)!;
    positions.set(id, { x: n.position.x + dx, y: n.position.y + dy });
  }
  if (matches.x)
    guides.push({
      axis: 'x',
      value: matches.x.value,
      from: Math.min(y + dy, matches.x.target.y) - 24,
      to: Math.max(y + dy + bounds.height, matches.x.target.y + matches.x.target.height) + 24,
    });
  if (matches.y)
    guides.push({
      axis: 'y',
      value: matches.y.value,
      from: Math.min(x + dx, matches.y.target.x) - 24,
      to: Math.max(x + dx + bounds.width, matches.y.target.x + matches.y.target.width) + 24,
    });
  return { positions, guides };
}
