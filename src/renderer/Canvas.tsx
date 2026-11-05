import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type NodeChange,
  applyNodeChanges,
  ViewportPortal,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEditor, edit, run } from './store';
import { createEntity, kindOf, typeRef } from '../domain/builtins';
import { provenance, uid } from '../domain/types';
import { visibleProjection } from '../projection/views';
import LayoutWorker from './layout.worker?worker';
import { nodeTypes, type DiagramNode } from './GraphNodes';
import { buildScene, type SceneCache } from './graph-scene';
import { usePreferences, savePreferences } from './preferences';
import { addContainer, worldPosition, viewItems, moveItemsToWorld } from '../projection/containers';
import { EDGE_COLORS } from '../projection/graph-presentation';
import { VIEW_HELP } from './help-content';
import { mutateView } from './view-actions';
import { BrandIcon } from './BrandIcon';
import { alignNodes, type SnapGuide } from '../projection/snapping';

const graphLabels = {
  'controls.zoomIn.ariaLabel': 'Zoom in',
  'controls.zoomOut.ariaLabel': 'Zoom out',
  'controls.fitView.ariaLabel': 'Fit diagram',
};
function Diagram() {
  const {
    snapshot,
    selected,
    selectedContainer,
    view,
    select,
    selectContainer,
    selectRelationship,
    systemId,
    setSystem,
    openGuide,
  } = useEditor();
  const flow = useReactFlow<DiagramNode>();
  const [diagram, setDiagram] = useState<{ nodes: DiagramNode[]; guides: SnapGuide[] }>({
      nodes: [],
      guides: [],
    }),
    liveDiagram = useRef(diagram),
    localNodes = diagram.nodes;
  const updateDiagram = useCallback((next: typeof diagram) => {
    liveDiagram.current = next;
    setDiagram(next);
  }, []);
  const keyboardMove = useRef<{ key: string; factor: number } | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [relation, setRelation] = useState(typeRef('depends-on'));
  const [source, setSource] = useState(''),
    [target, setTarget] = useState('');
  const [sourcePort, setSourcePort] = useState(''),
    [targetPort, setTargetPort] = useState('');
  const nodeCache = useRef(new Map<string, DiagramNode>());
  const cache = useRef<SceneCache>({ nodes: nodeCache.current, edges: new Map() });
  const preferences = usePreferences((s) => s.preferences),
    prefRef = useRef(preferences);
  prefRef.current = preferences;
  const { theme, showSystemConnections, graphTooltips } = preferences;
  const project = snapshot?.project,
    layout = snapshot?.views[view];
  const projection = useMemo(
    () => (project && layout ? visibleProjection(project, layout, systemId ?? undefined) : null),
    [project, layout, systemId],
  );
  const findingIndex = useMemo(() => {
    const counts = new Map<string, number>(),
      failed = new Set<string>();
    for (const f of snapshot?.findings ?? []) {
      if (f.status === 'pass' || f.status === 'not-applicable') continue;
      for (const id of f.targets) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (f.status === 'fail') failed.add(id);
      }
    }
    return { counts, failed };
  }, [snapshot?.findings]);
  const scene = useMemo(
    () =>
      project && layout && projection
        ? buildScene(
            project,
            layout,
            projection,
            selected,
            selectedContainer,
            findingIndex,
            theme,
            cache.current,
            showSystemConnections,
          )
        : null,
    [
      project,
      layout,
      projection,
      selected,
      selectedContainer,
      findingIndex,
      theme,
      showSystemConnections,
    ],
  );
  const renderIndex = scene ?? {
    byAppearance: new Map<string, string>(),
    byRender: new Map<string, ReturnType<typeof viewItems>[number]>(),
    entityId: (_id: string) => undefined,
  };
  const nodes = scene?.nodes ?? [],
    edges = scene?.edges ?? [];
  useEffect(() => updateDiagram({ nodes, guides: [] }), [nodes, updateDiagram]);
  useEffect(() => {
    if (layout) void flow.setViewport(layout.viewport);
  }, [project?.id, view]);
  useEffect(() => {
    if (nodes.length && nodes.length < 100) {
      const timer = setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1.15 }), 50);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, project?.id, view]);
  const onNodesChange = useCallback(
    (changes: NodeChange<DiagramNode>[]) => {
      const current = liveDiagram.current.nodes,
        prefs = prefRef.current,
        key = keyboardMove.current;
      const proposed =
        key && prefs.snapToGrid
          ? changes.map((change) => {
              if (change.type !== 'position' || !change.position || change.dragging === undefined)
                return change;
              const node = current.find((n) => n.id === change.id);
              if (!node) return change;
              const dx = key.key === 'ArrowLeft' ? -1 : key.key === 'ArrowRight' ? 1 : 0,
                dy = key.key === 'ArrowUp' ? -1 : key.key === 'ArrowDown' ? 1 : 0;
              return {
                ...change,
                position: {
                  x: node.position.x + dx * prefs.gridSize * key.factor,
                  y: node.position.y + dy * prefs.gridSize * key.factor,
                },
              };
            })
          : changes;
      let next = applyNodeChanges(proposed, current);
      const moving = proposed.flatMap((c) =>
        c.type === 'position' && c.position && c.dragging !== undefined ? [c.id] : [],
      );
      let guides = liveDiagram.current.guides;
      if (moving.length) {
        const result = alignNodes(
          next.map((n) => ({
            id: n.id,
            parentId: n.parentId,
            position: n.position,
            width: Number(n.style?.width ?? n.measured?.width ?? 228),
            height: Number(n.style?.height ?? n.measured?.height ?? 99),
          })),
          moving,
          { ...prefs, snapToObjects: prefs.snapToObjects && !key },
          flow.getZoom(),
        );
        next = next.map((n) =>
          result.positions.has(n.id) ? { ...n, position: result.positions.get(n.id)! } : n,
        );
        guides = proposed.some((c) => c.type === 'position' && c.dragging) ? result.guides : [];
      }
      for (const node of next) nodeCache.current.set(node.id, node);
      updateDiagram({ nodes: next, guides });
    },
    [flow, updateDiagram],
  );
  const latest = useRef({ layout, renderIndex, selected, view });
  latest.current = { layout, renderIndex, selected, view };
  const savePositions = useCallback(async () => {
    const { layout, renderIndex } = latest.current;
    if (!layout) return;
    const localNodes = liveDiagram.current.nodes;
    const changes = new Map<string, { x: number; y: number }>(),
      byId = new Map(localNodes.map((n) => [n.id, n]));
    for (const item of viewItems(layout)) {
      const node = localNodes.find((n) => n.id === renderIndex.byAppearance.get(item.id));
      if (!node) continue;
      const offset =
        item.parentAppearanceId && !node.parentId
          ? worldPosition(layout, item.parentAppearanceId)
          : { x: 0, y: 0 };
      if (item.x === node.position.x - offset.x && item.y === node.position.y - offset.y) continue;
      let parent = node.parentId,
        position = { ...node.position };
      while (parent) {
        const n = byId.get(parent);
        if (!n) break;
        position = { x: position.x + n.position.x, y: position.y + n.position.y };
        parent = n.parentId;
      }
      changes.set(item.id, position);
    }
    if (!changes.size) return;
    await run(() => mutateView(layout.id, (current) => moveItemsToWorld(current, changes)));
  }, [flow]);
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: DiagramNode) => {
      const { selected, renderIndex } = latest.current;
      const id = renderIndex.entityId(node.id);
      if (!id) {
        const item = renderIndex.byRender.get(node.id);
        if (item) selectContainer(item.id);
        return;
      }
      if (id)
        select(
          event.shiftKey || event.ctrlKey || event.metaKey
            ? selected.includes(id)
              ? selected.filter((s) => s !== id)
              : [...selected, id]
            : [id],
        );
    },
    [select, selectContainer],
  );
  const onSelectionEnd = useCallback(() => {
    const picked = flow.getNodes().filter((n) => n.selected);
    const entities = [
      ...new Set(
        picked
          .map((n) => latest.current.renderIndex.entityId(n.id))
          .filter((id): id is string => !!id),
      ),
    ];
    const frame = picked.find((n) => n.type === 'frame');
    if (!entities.length && frame)
      selectContainer(latest.current.renderIndex.byRender.get(frame.id)!.id);
    else select(entities);
  }, [flow, select, selectContainer]);
  const onMoveEnd = useCallback(
    (_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
      const { layout, view } = latest.current;
      if (
        layout &&
        (Math.abs(viewport.x - layout.viewport.x) > 0.5 ||
          Math.abs(viewport.y - layout.viewport.y) > 0.5 ||
          Math.abs(viewport.zoom - layout.viewport.zoom) > 0.001)
      )
        void run(() => window.lattice.saveViewport(view, viewport));
    },
    [],
  );
  const onPaneClick = useCallback(() => select([]), [select]);
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: DiagramNode) => {
      const entityId = latest.current.renderIndex.entityId(node.id);
      const entity = useEditor.getState().snapshot?.project.entities[entityId ?? ''];
      if (entity && ['system', 'subsystem'].includes(kindOf(entity.typeRef))) setSystem(entity.id);
    },
    [setSystem],
  );
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: { id: string }) => selectRelationship(edge.id),
    [selectRelationship],
  );
  async function connect() {
    if (!project) return;
    let a = source,
      b = target;
    if (connection?.source) a = renderIndex.entityId(connection.source) ?? source;
    if (connection?.target) b = renderIndex.entityId(connection.target) ?? target;
    if (!a || !b) return;
    await edit(
      [
        {
          kind: 'put-relationship',
          relationship: {
            id: uid(),
            typeRef: relation,
            source: a,
            target: b,
            ...(sourcePort ? { sourcePort } : {}),
            ...(targetPort ? { targetPort } : {}),
            properties: {},
            provenance: provenance(),
          },
        },
      ],
      'Connect specification entities',
    );
    setConnection(null);
  }
  async function autoLayout() {
    if (!layout) return;
    const token = JSON.stringify([layout.appearances, layout.containers, layout.collapsedIds]);
    const baseRevision = project!.revision;
    const currentNodes = flow.getNodes(),
      byId = new Map(currentNodes.map((n) => [n.id, n]));
    const rootId = (id: string): string => {
      const node = byId.get(id);
      return node?.parentId ? rootId(node.parentId) : id;
    };
    const worker = new LayoutWorker();
    worker.onmessage = (event) => {
      if (event.data.error) {
        useEditor.getState().setError(String(event.data.error));
        worker.terminate();
        return;
      }
      const state = useEditor.getState(),
        current = state.snapshot?.views[view];
      if (
        !current ||
        state.snapshot?.project.id !== project!.id ||
        state.snapshot.project.revision !== baseRevision ||
        state.view !== view ||
        state.systemId !== systemId ||
        JSON.stringify([current.appearances, current.containers, current.collapsedIds]) !== token
      ) {
        state.setError('The diagram changed while arranging. Run Arrange again.');
        worker.terminate();
        return;
      }
      const positions = new Map<string, { x: number; y: number }>(
        (event.data.nodes as { id: string; x: number; y: number }[]).map((n) => [n.id, n]),
      );
      void run(() =>
        mutateView(view, (current) => {
          if (
            JSON.stringify([current.appearances, current.containers, current.collapsedIds]) !==
            token
          )
            throw new Error('The diagram changed while arranging. Run Arrange again.');
          return {
            ...current,
            appearances: current.appearances.map((a) => {
              const position = positions.get(renderIndex.byAppearance.get(a.id)!);
              const offset = a.parentAppearanceId
                ? worldPosition(current, a.parentAppearanceId)
                : { x: 0, y: 0 };
              return position ? { ...a, x: position.x - offset.x, y: position.y - offset.y } : a;
            }),
            ...(current.containers
              ? {
                  containers: current.containers.map((c) => {
                    const position = positions.get(renderIndex.byAppearance.get(c.id)!);
                    const offset = c.parentAppearanceId
                      ? worldPosition(current, c.parentAppearanceId)
                      : { x: 0, y: 0 };
                    return position
                      ? { ...c, x: position.x - offset.x, y: position.y - offset.y }
                      : c;
                  }),
                }
              : {}),
          };
        }),
      ).then(() => setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1.15 }), 100));
      worker.terminate();
    };
    worker.onerror = () => {
      useEditor.getState().setError('Could not arrange this diagram.');
      worker.terminate();
    };
    worker.postMessage({
      view,
      nodes: currentNodes
        .filter((n) => !n.parentId)
        .map((n) => ({
          id: n.id,
          width: Number(n.style?.width ?? n.measured?.width ?? 230),
          height: Number(n.style?.height ?? n.measured?.height ?? 100),
        })),
      edges: edges
        .map((e) => ({ id: e.id, source: rootId(e.source), target: rootId(e.target) }))
        .filter((e) => e.source !== e.target),
    });
  }
  async function createFrame(group = false) {
    if (!layout) return;
    const ids = group
      ? [
          ...layout.appearances.filter((a) => selected.includes(a.entityId)).map((a) => a.id),
          ...(selectedContainer ? [selectedContainer] : []),
        ]
      : [];
    await run(async () => {
      let id = '';
      await mutateView(view, (current) => {
        const created = addContainer(current, ids, group ? 'Grouped selection' : 'New container');
        id = created.id;
        return created.view;
      });
      selectContainer(id);
    });
  }
  if (!snapshot || !project || !layout) return null;
  return (
    <div
      className="canvas-wrap"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const reference = event.dataTransfer.getData('application/lattice-type');
        if (!project.types[reference]) return;
        const entity = createEntity(reference, project.types[reference]!.name);
        const rawPoint = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const temporary = `drop:${entity.id}`,
          point =
            alignNodes(
              [
                ...liveDiagram.current.nodes.map((n) => ({
                  id: n.id,
                  parentId: n.parentId,
                  position: n.position,
                  width: Number(n.style?.width ?? n.measured?.width ?? 228),
                  height: Number(n.style?.height ?? n.measured?.height ?? 99),
                })),
                { id: temporary, position: rawPoint, width: 228, height: 99 },
              ],
              [temporary],
              preferences,
              flow.getZoom(),
            ).positions.get(temporary) ?? rawPoint;
        void edit([{ kind: 'create-entity', entity }], 'Insert dragged component').then(
          async () => {
            await mutateView(view, (v) => {
              const appearance = v.appearances.find((a) => a.entityId === entity.id);
              if (appearance) {
                return {
                  ...v,
                  appearances: v.appearances.map((a) =>
                    a.id === appearance.id ? { ...a, x: point.x, y: point.y } : a,
                  ),
                };
              } else
                return {
                  ...v,
                  appearances: [
                    ...v.appearances,
                    { id: uid(), entityId: entity.id, x: point.x, y: point.y },
                  ],
                };
            });
            select([entity.id]);
          },
        );
      }}
    >
      <div className="canvas-toolbar">
        <button
          className="text-link eyebrow"
          data-help={VIEW_HELP[view]}
          onClick={() => openGuide(view)}
          aria-label={`${view} view ⓘ — About this view`}
        >
          {view} view <span aria-hidden="true">ⓘ</span>
        </button>
        <span className="muted">
          {projection?.appearances.length ?? 0} appearances · {edges.length} relationships
        </span>
        <div className="spacer" />
        <button
          aria-pressed={showSystemConnections}
          className={showSystemConnections ? 'active' : ''}
          data-help="Show or hide relationships with a System at either endpoint. This display setting stays on this computer; all relationships remain in the model and exports."
          onClick={() =>
            void run(() =>
              savePreferences({ ...preferences, showSystemConnections: !showSystemConnections }),
            )
          }
        >
          System connections: {showSystemConnections ? 'shown' : 'hidden'}
        </button>
        <button
          aria-pressed={graphTooltips}
          className={graphTooltips ? 'active' : ''}
          data-help="Enable or disable hover and keyboard-focus tooltips on the graph canvas. Help for controls, toolbox items and inspector fields remains available."
          onClick={() =>
            void run(() => savePreferences({ ...preferences, graphTooltips: !graphTooltips }))
          }
        >
          Graph tooltips: {graphTooltips ? 'on' : 'off'}
        </button>
        <button onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1.15 })}>Fit view</button>
        <button onClick={() => void autoLayout()}>Arrange</button>
        <button disabled={snapshot.readOnly} onClick={() => void createFrame()}>
          Add container
        </button>
        <button
          disabled={snapshot.readOnly || (!selected.length && !selectedContainer)}
          onClick={() => void createFrame(true)}
        >
          Group selection
        </button>
        <button
          data-help="Explain line patterns, endpoints, importance and semantic node icons."
          onClick={() => openGuide('diagram')}
        >
          Legend
        </button>
        <button onClick={() => void run(() => window.lattice.undoView(view))}>Undo layout</button>
        <button
          onClick={() => {
            if (selected[0])
              void flow.fitView({
                nodes: localNodes.filter((n) =>
                  selected.includes(renderIndex.entityId(n.id) ?? ''),
                ),
                padding: 0.7,
              });
          }}
        >
          Focus selection
        </button>
        <button
          onClick={() => {
            setConnection({ source: '', target: '', sourceHandle: null, targetHandle: null });
            setSource(selected[0] ?? '');
            setTarget('');
            setSourcePort('');
            setTargetPort('');
          }}
        >
          Connect…
        </button>
      </div>
      {systemId && (
        <div className="breadcrumbs">
          <button onClick={() => setSystem(null)}>Whole system</button>
          <span>/</span>
          <strong>{project.entities[systemId]?.name}</strong>
        </div>
      )}
      <div
        className="flow-surface"
        data-testid="canvas"
        onPointerDownCapture={() => {
          keyboardMove.current = null;
        }}
        onKeyDownCapture={(event) => {
          if (
            event.key.startsWith('Arrow') &&
            (event.target as HTMLElement).classList.contains('react-flow__node')
          )
            keyboardMove.current = { key: event.key, factor: event.shiftKey ? 4 : 1 };
        }}
        onKeyUpCapture={(event) => {
          const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
          if (
            !snapshot.readOnly &&
            event.key.startsWith('Arrow') &&
            node &&
            flow.getNode(node.dataset.id!)?.selected
          )
            void savePositions();
          keyboardMove.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
            const id = renderIndex.entityId(node?.dataset.id ?? '');
            if (id) select([id]);
            else {
              const item = renderIndex.byRender.get(node?.dataset.id ?? '');
              if (item) selectContainer(item.id);
            }
          }
        }}
      >
        <ReactFlow<DiagramNode>
          nodes={localNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={() => {
            updateDiagram({ ...liveDiagram.current, guides: [] });
            void savePositions();
          }}
          onNodeClick={onNodeClick}
          onSelectionEnd={onSelectionEnd}
          onMoveEnd={onMoveEnd}
          onPaneClick={onPaneClick}
          onConnect={(connection) => {
            setSource('');
            setTarget('');
            setSourcePort('');
            setTargetPort('');
            setConnection(connection);
          }}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick}
          fitView={localNodes.length < 100}
          onlyRenderVisibleElements
          minZoom={0.15}
          maxZoom={2}
          deleteKeyCode={null}
          panActivationKeyCode={null}
          nodesConnectable={!snapshot.readOnly}
          nodesDraggable={!snapshot.readOnly}
          ariaLabelConfig={graphLabels}
          elevateNodesOnSelect={false}
          zIndexMode="manual"
          snapToGrid={false}
          snapGrid={[preferences.gridSize, preferences.gridSize]}
        >
          <ViewportPortal>
            <svg className="snap-guides" aria-hidden="true">
              {diagram.guides.map((g) => (
                <line
                  key={g.axis}
                  data-testid={`snap-guide-${g.axis}`}
                  x1={g.axis === 'x' ? g.value : g.from}
                  x2={g.axis === 'x' ? g.value : g.to}
                  y1={g.axis === 'y' ? g.value : g.from}
                  y2={g.axis === 'y' ? g.value : g.to}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </ViewportPortal>
          <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
            <defs>
              <marker
                id={`lattice-contains-${theme}`}
                viewBox="0 0 20 20"
                refX="1"
                refY="10"
                markerWidth="13"
                markerHeight="13"
                orient="auto-start-reverse"
              >
                <path
                  d="M1 10 10 3 19 10 10 17Z"
                  fill="var(--node-background)"
                  stroke={EDGE_COLORS[theme].structure}
                  strokeWidth="2"
                />
              </marker>
              <marker
                id={`lattice-denies-${theme}`}
                viewBox="0 0 24 20"
                refX="22"
                refY="10"
                markerWidth="17"
                markerHeight="14"
                orient="auto"
              >
                <path
                  d="m3 3 12 7-12 7M20 2v16"
                  fill="none"
                  stroke={EDGE_COLORS[theme].denial}
                  strokeWidth="2.5"
                />
              </marker>
            </defs>
          </svg>
          <Background gap={preferences.gridSize} size={1} color="var(--grid)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor="var(--accent-raw)"
            maskColor="var(--minimap-mask)"
          />
        </ReactFlow>
      </div>
      {!Object.keys(project.entities).length && !layout.containers?.length && (
        <div className="canvas-empty">
          <BrandIcon className="empty-mark" />
          <h2>Give your system a shape.</h2>
          <p>
            Start with a component, or explore a worked specification.
            <br />
            Every view will stay connected to the same model.
          </p>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => {
                const entity = createEntity(typeRef('system'), 'My system');
                void edit([{ kind: 'create-entity', entity }], 'Create a system').then(() =>
                  select([entity.id]),
                );
              }}
            >
              Add a system
            </button>
            <button onClick={() => void run(() => window.lattice.loadExample('development'))}>
              Explore development
            </button>
          </div>
          <span className="muted">Design and inspect here.</span>
        </div>
      )}
      {connection && (
        <div className="canvas-dialog" role="dialog" aria-label="Connect entities">
          <h3>Connect entities</h3>
          <p className="muted">Incompatible connections remain editable and produce findings.</p>
          <label>
            Source
            <select
              aria-label="Source"
              value={source || renderIndex.entityId(connection.source) || ''}
              onChange={(e) => {
                setSource(e.target.value);
                setConnection({ ...connection, source: '' });
              }}
            >
              <option value="">Choose source</option>
              {Object.values(project.entities).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source port
            <select value={sourcePort} onChange={(e) => setSourcePort(e.target.value)}>
              <option value="">Unspecified</option>
              {(
                project.types[
                  project.entities[source || renderIndex.entityId(connection.source) || '']
                    ?.typeRef ?? ''
                ]?.ports ?? []
              )
                .filter((p) => p.direction !== 'in')
                .map((p) => (
                  <option key={p.id}>{p.id}</option>
                ))}
            </select>
          </label>
          <label>
            Relationship
            <select
              aria-label="Relationship"
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
            >
              {Object.entries(project.relationTypes).map(([reference, d]) => (
                <option key={reference} value={reference}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target
            <select
              aria-label="Target"
              value={target || renderIndex.entityId(connection.target) || ''}
              onChange={(e) => {
                setTarget(e.target.value);
                setConnection({ ...connection, target: '' });
              }}
            >
              <option value="">Choose target</option>
              {Object.values(project.entities).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target port
            <select value={targetPort} onChange={(e) => setTargetPort(e.target.value)}>
              <option value="">Unspecified</option>
              {(
                project.types[
                  project.entities[target || renderIndex.entityId(connection.target) || '']
                    ?.typeRef ?? ''
                ]?.ports ?? []
              )
                .filter((p) => p.direction !== 'out')
                .map((p) => (
                  <option key={p.id}>{p.id}</option>
                ))}
            </select>
          </label>
          <div className="button-row">
            <button className="primary" onClick={() => void connect()}>
              Create relationship
            </button>
            <button onClick={() => setConnection(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
export const Canvas = memo(function Canvas() {
  return (
    <ReactFlowProvider>
      <Diagram />
    </ReactFlowProvider>
  );
});
