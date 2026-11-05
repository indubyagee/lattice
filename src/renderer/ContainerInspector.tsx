import type { ViewDefinition } from '../domain/types';
import { useEditor, run } from './store';
import { descendants, reparentItems, removeContainer, viewItems } from '../projection/containers';
import { SemanticIcon } from './SemanticIcon';
import { mutateView } from './view-actions';
export function ParentContainerField({ view, itemId }: { view: ViewDefinition; itemId: string }) {
  const blocked = descendants(view, itemId),
    item = viewItems(view).find((i) => i.id === itemId);
  return (
    <label data-help="Move this appearance or frame into a container without creating any semantic links. Choosing Canvas preserves its world position.">
      Parent container
      <select
        aria-label="Parent container"
        value={item?.parentAppearanceId ?? ''}
        onChange={(e) => {
          const parent = e.target.value || undefined;
          void run(() =>
            mutateView(view.id, (current) => reparentItems(current, [itemId], parent)),
          );
        }}
      >
        <option value="">Canvas (no container)</option>
        {item?.parentAppearanceId &&
          !view.containers?.some((c) => c.id === item.parentAppearanceId) && (
            <option value={item.parentAppearanceId}>Legacy appearance group</option>
          )}
        {view.containers
          ?.filter((c) => c.id !== itemId && !blocked.has(c.id))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>
    </label>
  );
}
export function ContainerInspector() {
  const { snapshot, view, selectedContainer, selectContainer, select, openGuide } = useEditor();
  const layout = snapshot!.views[view],
    c = layout.containers!.find((c) => c.id === selectedContainer)!;
  const children = viewItems(layout).filter((i) => i.parentAppearanceId === c.id),
    update = (patch: Partial<typeof c>) =>
      run(() =>
        mutateView(view, (current) => ({
          ...current,
          containers: current.containers!.map((item) =>
            item.id === c.id ? { ...item, ...patch } : item,
          ),
        })),
      );
  return (
    <aside className="inspector" aria-label="Container inspector">
      <div className="section-heading">
        <h2 className="eyebrow">Container</h2>
        <span className="badge">View only</span>
      </div>
      <div className="inspector-scroll">
        <p className="muted">
          This frame groups appearances in {view}. It adds no entities or relationships.
        </p>
        <fieldset disabled={snapshot!.readOnly}>
          <label data-help="Rename this presentation-only frame in the current view.">
            Container name
            <input
              aria-label="Container name"
              key={c.id + c.name}
              defaultValue={c.name}
              onBlur={(e) => {
                if (e.target.value !== c.name) void update({ name: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
          <label data-help="Explain why these items are grouped. This note is stored only in the view file.">
            Container description
            <textarea
              aria-label="Container description"
              key={c.id + c.description}
              rows={3}
              defaultValue={c.description}
              onBlur={(e) => {
                if (e.target.value !== c.description) void update({ description: e.target.value });
              }}
            />
          </label>
          <ParentContainerField view={layout} itemId={c.id} />
          <div className="container-dimensions">
            {(['width', 'height'] as const).map((field) => (
              <label
                key={field}
                data-help={`Set this visual frame’s ${field} in canvas units. Use resize handles for the same layout-only change; children keep their positions.`}
              >
                {field === 'width' ? 'Width' : 'Height'}
                <input
                  type="number"
                  aria-label={`Container ${field}`}
                  min={field === 'width' ? 240 : 120}
                  max={20000}
                  defaultValue={c[field]}
                  key={c.id + field + c[field]}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value !== c[field]) void update({ [field]: value });
                  }}
                />
              </label>
            ))}
          </div>
          <div className="button-row">
            <button
              onClick={() =>
                void run(() =>
                  mutateView(view, (current) => ({
                    ...current,
                    collapsedIds: current.collapsedIds.includes(c.id)
                      ? current.collapsedIds.filter((id) => id !== c.id)
                      : [...current.collapsedIds, c.id],
                  })),
                )
              }
            >
              {layout.collapsedIds.includes(c.id) ? 'Expand container' : 'Collapse container'}
            </button>
            <button
              onClick={() =>
                void run(async () => {
                  await mutateView(view, (current) => removeContainer(current, c.id));
                  select([]);
                })
              }
            >
              Remove container; keep items
            </button>
          </div>
        </fieldset>
        <h3>Direct members ({children.length})</h3>
        {children.map((item) => (
          <button
            className="container-member"
            key={item.id}
            onClick={() =>
              'entityId' in item ? select([item.entityId]) : selectContainer(item.id)
            }
          >
            <SemanticIcon symbol={'entityId' in item ? 'document' : 'frame'} />
            {'entityId' in item ? snapshot!.project.entities[item.entityId]?.name : item.name}
          </button>
        ))}
        <button className="text-link" onClick={() => openGuide('containers')}>
          How containers work ↗
        </button>
      </div>
    </aside>
  );
}
