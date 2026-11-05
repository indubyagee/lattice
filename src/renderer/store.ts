import { create } from 'zustand';
import type { SessionSnapshot } from '../shared/contracts';
import type { Operation, ViewKind } from '../domain/types';

export type Panel = 'findings' | 'files' | 'ai' | 'review' | 'library';
interface PendingRename {
  entityId: string;
  name: string;
  baseRevision: number;
}
interface EditorState {
  snapshot: SessionSnapshot | null;
  pendingRename: PendingRename | null;
  selected: string[];
  selectedRelation: string | null;
  selectedContainer: string | null;
  guideTopic: string | null;
  view: ViewKind;
  panel: Panel;
  error: string | null;
  systemId: string | null;
  setSnapshot: (snapshot: SessionSnapshot) => void;
  select: (ids: string[]) => void;
  selectRelationship: (id: string) => void;
  selectContainer: (id: string) => void;
  openGuide: (topic?: string) => void;
  closeGuide: () => void;
  setView: (view: ViewKind) => void;
  setPanel: (panel: Panel) => void;
  setError: (error: string | null) => void;
  setSystem: (id: string | null) => void;
}
export const useEditor = create<EditorState>((set) => ({
  snapshot: null,
  pendingRename: null,
  selected: [],
  selectedRelation: null,
  selectedContainer: null,
  guideTopic: null,
  view: 'architecture',
  panel: 'findings',
  error: null,
  systemId: null,
  setSnapshot: (incoming) =>
    set((state) => {
      const previous = state.snapshot;
      if (!previous || previous.project.id !== incoming.project.id)
        return {
          snapshot: incoming,
          pendingRename: null,
          selected: [],
          selectedRelation: null,
          selectedContainer: null,
          systemId: null,
        };
      // IPC structured clones lose reference identity. Restore it for unchanged records.
      const share = <T>(old: Record<string, T>, next: Record<string, T>): Record<string, T> => {
        let same = Object.keys(old).length === Object.keys(next).length;
        const result = Object.fromEntries(
          Object.entries(next).map(([id, value]) => {
            const reuse =
              old[id] === value ||
              (old[id] !== undefined && JSON.stringify(old[id]) === JSON.stringify(value));
            if (!reuse) same = false;
            return [id, reuse ? old[id]! : value];
          }),
        );
        return same ? old : result;
      };
      const project =
        previous.project.revision === incoming.project.revision
          ? previous.project
          : {
              ...incoming.project,
              entities: share(previous.project.entities, incoming.project.entities),
              relationships: share(previous.project.relationships, incoming.project.relationships),
              types: share(previous.project.types, incoming.project.types),
              relationTypes: share(previous.project.relationTypes, incoming.project.relationTypes),
              assemblies: share(previous.project.assemblies, incoming.project.assemblies),
            };
      const views = share(previous.views, incoming.views) as typeof incoming.views;
      const selected = state.selected.filter((id) => !!project.entities[id]);
      return {
        snapshot: { ...incoming, project, views },
        pendingRename:
          !incoming.readOnly && state.pendingRename?.baseRevision === project.revision
            ? state.pendingRename
            : null,
        selected: selected.length === state.selected.length ? state.selected : selected,
        selectedContainer: incoming.views[state.view].containers?.some(
          (c) => c.id === state.selectedContainer,
        )
          ? state.selectedContainer
          : null,
        selectedRelation:
          state.selectedRelation && project.relationships[state.selectedRelation]
            ? state.selectedRelation
            : null,
      };
    }),
  select: (selected) =>
    set((state) =>
      !state.selectedRelation &&
      !state.selectedContainer &&
      state.selected.length === selected.length &&
      state.selected.every((id, index) => id === selected[index])
        ? state
        : { selected, selectedRelation: null, selectedContainer: null },
    ),
  selectRelationship: (selectedRelation) =>
    set({ selectedRelation, selected: [], selectedContainer: null }),
  selectContainer: (selectedContainer) =>
    set({ selectedContainer, selected: [], selectedRelation: null }),
  openGuide: (guideTopic = 'start') => set({ guideTopic }),
  closeGuide: () => set({ guideTopic: null }),
  setView: (view) => set({ view, selectedContainer: null }),
  setPanel: (panel) => set({ panel }),
  setError: (error) => set((state) => (state.error === error ? state : { error })),
  setSystem: (systemId) => set({ systemId }),
}));
export async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    useEditor.getState().setError(null);
    return await action();
  } catch (error) {
    useEditor.getState().setError(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
export async function edit(operations: Operation[], reason: string) {
  const snapshot = useEditor.getState().snapshot;
  if (!snapshot) return;
  return run(() =>
    window.lattice.execute({
      baseRevision: snapshot.project.revision,
      operations,
      reason,
    }),
  );
}

export async function renameEntity(entityId: string, name: string): Promise<boolean> {
  const { snapshot, pendingRename } = useEditor.getState();
  if (!snapshot || snapshot.readOnly || pendingRename || !snapshot.project.entities[entityId])
    return false;
  // Keep the preview outside the authoritative snapshot until the host publishes a revision.
  const rename = { entityId, name, baseRevision: snapshot.project.revision };
  useEditor.setState({ pendingRename: rename });
  const acknowledgement = await edit(
    [{ kind: 'update-entity', id: entityId, name }],
    'Rename entity',
  );
  if (acknowledgement) return true;
  useEditor.setState((state) => (state.pendingRename === rename ? { pendingRename: null } : state));
  return false;
}
