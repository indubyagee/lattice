import { memo } from 'react';
import {
  Handle,
  Position,
  NodeResizer,
  useReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { SemanticIcon, symbolFor } from './SemanticIcon';
import { useEditor, run } from './store';
import { worldPosition } from '../projection/containers';
import { mutateView } from './view-actions';
export type DiagramNode = Node<
  {
    label: string;
    typeName: string;
    family: string;
    issues: number;
    implementation: string;
    renderer: string;
    reference: string;
    tooltip: string;
    neighbor: boolean;
    containerId?: string;
    collapsed?: boolean;
    description?: string;
    members?: number;
  },
  'component' | 'frame'
>;
const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps<DiagramNode>) {
  return (
    <div
      data-help={data.tooltip}
      className={`component-node family-${data.family} render-${data.renderer} symbol-${symbolFor(data.reference, data.family)}${selected ? ' selected' : ''}${data.neighbor ? ' is-neighbor' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-eyebrow">
        <span className="node-glyph">
          <SemanticIcon reference={data.reference} family={data.family} />
        </span>
        {data.typeName}
        {data.neighbor && (
          <span className="neighbor-indicator" aria-label="Directly connected to selection">
            ↔
          </span>
        )}
        {data.issues > 0 && (
          <span className="node-issues" aria-label={`${data.issues} findings`}>
            ! {data.issues}
          </span>
        )}
      </div>
      <strong>{data.label}</strong>
      <div className="node-caption">{data.implementation} specification</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
const FrameNode = memo(function FrameNode({ id, data, selected }: NodeProps<DiagramNode>) {
  const flow = useReactFlow(),
    readOnly = useEditor((s) => s.snapshot?.readOnly);
  return (
    <div className={`container-frame${selected ? ' selected' : ''}`}>
      <NodeResizer
        isVisible={!!selected && !readOnly && !data.collapsed}
        minWidth={240}
        minHeight={120}
        onResizeEnd={(_event, size) => {
          const state = useEditor.getState(),
            view = state.snapshot?.views[state.view],
            container = view?.containers?.find((c) => c.id === data.containerId);
          if (!view || !container) return;
          void run(() =>
            mutateView(view.id, (current) => {
              const container = current.containers!.find((c) => c.id === data.containerId)!;
              const offset =
                container.parentAppearanceId && !flow.getNode(id)?.parentId
                  ? worldPosition(current, container.parentAppearanceId)
                  : { x: 0, y: 0 };
              return {
                ...current,
                containers: current.containers!.map((c) =>
                  c.id === container.id
                    ? {
                        ...c,
                        x: size.x - offset.x,
                        y: size.y - offset.y,
                        width: size.width,
                        height: size.height,
                      }
                    : c,
                ),
              };
            }),
          );
        }}
      />
      <div className="container-title" data-help={data.tooltip}>
        <SemanticIcon symbol="frame" />
        <strong>{data.label}</strong>
        <small>VIEW ONLY · {data.members}</small>
        <button
          className="nodrag nopan"
          disabled={readOnly}
          aria-label={`${data.collapsed ? 'Expand' : 'Collapse'} ${data.label}`}
          onClick={(event) => {
            event.stopPropagation();
            const state = useEditor.getState(),
              view = state.snapshot!.views[state.view];
            void run(() =>
              mutateView(view.id, (current) => ({
                ...current,
                collapsedIds: current.collapsedIds.includes(data.containerId!)
                  ? current.collapsedIds.filter((key) => key !== data.containerId)
                  : [...current.collapsedIds, data.containerId!],
              })),
            );
          }}
        >
          {data.collapsed ? '+' : '−'}
        </button>
      </div>
      {!data.collapsed && <div className="container-description">{data.description}</div>}
    </div>
  );
});
export const nodeTypes = { component: ComponentNode, frame: FrameNode };
