import { MarkerType, type Edge } from '@xyflow/react';
import type { Project, ViewDefinition } from '../domain/types';
import { kindOf } from '../domain/builtins';
import {
  viewItems,
  orderViewItems,
  worldPosition,
  descendants,
  type ViewItem,
} from '../projection/containers';
import { visibleProjection } from '../projection/views';
import { edgePresentation, immediateConnections } from '../projection/graph-presentation';
import { COMPONENT_HELP } from './help-content';
import type { DiagramNode } from './GraphNodes';
export interface SceneCache {
  projectId?: string;
  nodes: Map<string, DiagramNode>;
  edges: Map<string, { key: unknown[]; edge: Edge }>;
  nodeList?: DiagramNode[];
  edgeList?: Edge[];
}
function sameItems<T>(previous: T[] | undefined, next: T[]): T[] {
  return previous?.length === next.length && next.every((item, index) => item === previous[index])
    ? previous
    : next;
}
export function buildScene(
  project: Project,
  layout: ViewDefinition,
  projection: ReturnType<typeof visibleProjection>,
  selected: string[],
  selectedContainer: string | null,
  findings: { counts: Map<string, number>; failed: Set<string> },
  theme: 'light' | 'dark',
  cache: SceneCache,
  showSystemConnections = false,
) {
  if (cache.projectId !== project.id) {
    cache.nodes.clear();
    cache.edges.clear();
    cache.nodeList = undefined;
    cache.edgeList = undefined;
    cache.projectId = project.id;
  }
  const counts = new Map<string, number>(),
    byAppearance = new Map<string, string>(),
    byRender = new Map<string, ViewItem>();
  for (const item of viewItems(layout)) {
    let renderId: string;
    if ('entityId' in item) {
      const count = counts.get(item.entityId) ?? 0;
      counts.set(item.entityId, count + 1);
      renderId = `${item.entityId}::${count}`;
    } else renderId = `frame:${item.id}`;
    byAppearance.set(item.id, renderId);
    byRender.set(renderId, item);
  }
  const entityId = (renderId: string) => {
    const item = byRender.get(renderId);
    return item && 'entityId' in item ? item.entityId : undefined;
  };
  const relationships = projection.relationshipIds
    .map((id) => project.relationships[id]!)
    .filter(
      (r) =>
        showSystemConnections ||
        [r.source, r.target].every((id) => kindOf(project.entities[id]!.typeRef) !== 'system'),
    );
  const adjacent = immediateConnections(
      { relationships: Object.fromEntries(relationships.map((r) => [r.id, r])) },
      selected,
    ),
    first = new Map<string, string>(),
    visibleItems = orderViewItems([...projection.containers, ...projection.appearances]),
    visibleIds = new Set(visibleItems.map((i) => i.id));
  for (const item of projection.appearances)
    if (!first.has(item.entityId)) first.set(item.entityId, item.id);
  const childCounts = new Map<string, number>();
  for (const item of visibleItems)
    if (item.parentAppearanceId)
      childCounts.set(item.parentAppearanceId, (childCounts.get(item.parentAppearanceId) ?? 0) + 1);
  const nodes = visibleItems.map((item) => {
    const id = byAppearance.get(item.id)!,
      cached = cache.nodes.get(id),
      parent =
        item.parentAppearanceId && visibleIds.has(item.parentAppearanceId)
          ? byAppearance.get(item.parentAppearanceId)
          : undefined,
      position =
        item.parentAppearanceId && !parent
          ? worldPosition(layout, item.id)
          : { x: item.x, y: item.y };
    let node: DiagramNode;
    if ('entityId' in item) {
      const e = project.entities[item.entityId]!,
        d = project.types[e.typeRef],
        description = String(
          e.properties.description ??
            d?.description ??
            COMPONENT_HELP[kindOf(e.typeRef)] ??
            'Definition unavailable; original properties are preserved.',
        ).slice(0, 420),
        children = childCounts.get(item.id) ?? 0;
      node = {
        id,
        type: 'component',
        zIndex: children ? 0 : 2,
        position,
        selected: selected.includes(e.id),
        data: {
          entityId: e.id,
          label: e.name,
          typeName: d?.name ?? 'Unknown type',
          family: d?.family ?? 'unknown',
          reference: e.typeRef,
          issues: findings.counts.get(e.id) ?? 0,
          implementation: e.implementationStatus,
          renderer: d?.renderer ?? 'node',
          neighbor: adjacent.nodes.has(e.id),
          tooltip: `${e.name} · ${d?.name ?? e.typeRef}\n${description}\n${e.implementationStatus} · ${findings.counts.get(e.id) ?? 0} findings${adjacent.nodes.has(e.id) ? ' · directly connected to selection' : ''}\nSelect to inspect; Shift-click to extend selection.`,
        },
        className: children ? 'visual-group' : undefined,
        style: children ? { width: 600, height: 120 + Math.ceil(children / 2) * 150 } : undefined,
        ariaLabel: `${e.name}, ${d?.name ?? 'unknown type'}`,
      };
    } else {
      const collapsed = layout.collapsedIds.includes(item.id),
        members = descendants(layout, item.id).size;
      node = {
        id,
        type: 'frame',
        position,
        selected: selectedContainer === item.id,
        style: { width: item.width, height: collapsed ? 54 : item.height },
        width: item.width,
        height: collapsed ? 54 : item.height,
        dragHandle: '.container-title',
        connectable: false,
        zIndex: 0,
        data: {
          label: item.name,
          typeName: 'Visual container',
          family: 'container',
          reference: '',
          issues: 0,
          implementation: '',
          renderer: 'container',
          neighbor: false,
          containerId: item.id,
          collapsed,
          description: item.description,
          members,
          tooltip: `${item.name} · presentation-only container\n${item.description}\n${members} nested items. Drag its header or edit Parent container in Inspector. Grouping does not add relationships.`,
        },
        ariaLabel: `${item.name}, presentation-only container`,
      };
    }
    if (parent) node.parentId = parent;
    if (cached?.measured) node.measured = cached.measured;
    if (
      cached &&
      JSON.stringify(cached.data) === JSON.stringify(node.data) &&
      cached.position.x === node.position.x &&
      cached.position.y === node.position.y &&
      cached.selected === node.selected &&
      cached.parentId === node.parentId &&
      JSON.stringify(cached.style) === JSON.stringify(node.style) &&
      cached.ariaLabel === node.ariaLabel
    )
      return cached;
    cache.nodes.set(id, node);
    return node;
  });
  const edges = relationships.map((r) => {
    const id = r.id,
      definition = project.relationTypes[r.typeRef],
      source = byAppearance.get(first.get(r.source)!)!,
      target = byAppearance.get(first.get(r.target)!)!,
      failed = findings.failed.has(id),
      connected = adjacent.edges.has(id),
      key = [
        source,
        target,
        project.entities[r.source]!.name,
        project.entities[r.target]!.name,
        r.typeRef,
        String(r.properties.importance),
        definition?.name,
        definition?.direction,
        theme,
        failed,
        connected,
      ];
    const cached = cache.edges.get(id);
    if (cached && sameItems(cached.key, key) === cached.key) return cached.edge;
    const cue = edgePresentation(r.typeRef, r.properties, theme, failed, connected),
      label = `${definition?.name ?? kindOf(r.typeRef)}${cue.importance !== 'normal' ? ` · ${cue.importance.toUpperCase()}` : ''}${failed ? ' · !' : ''}`,
      ariaLabel = `${project.entities[r.source]!.name} ${kindOf(r.typeRef)} ${project.entities[r.target]!.name}. ${cue.description} Importance: ${cue.importance}.`;
    const edge: Edge = {
      id,
      source,
      target,
      zIndex: 1,
      label,
      ariaLabel,
      className: `edge-${cue.category}${connected ? ' is-adjacent' : ''}`,
      style: {
        stroke: cue.color,
        strokeWidth: cue.width,
        strokeDasharray: cue.dash,
        strokeOpacity: connected ? 1 : 0.85,
      },
      labelStyle: { fontSize: 10, fill: 'var(--text-strong)' },
      labelBgStyle: { fill: 'var(--canvas)' },
      markerStart: cue.contains ? `lattice-contains-${theme}` : undefined,
      markerEnd:
        definition?.direction === 'directed'
          ? cue.denial
            ? `lattice-denies-${theme}`
            : { type: MarkerType.ArrowClosed, color: cue.color, width: 16, height: 16 }
          : undefined,
    };
    cache.edges.set(id, { key, edge });
    return edge;
  });
  // React Flow rebuilds its lookups when array identity changes, even if every item is cached.
  cache.nodeList = sameItems(cache.nodeList, nodes);
  cache.edgeList = sameItems(cache.edgeList, edges);
  return { nodes: cache.nodeList, edges: cache.edgeList, byAppearance, byRender, entityId };
}
