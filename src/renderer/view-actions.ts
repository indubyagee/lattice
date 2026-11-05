import type { ViewDefinition, ViewKind } from '../domain/types';
import { useEditor } from './store';
let queue: Promise<unknown> = Promise.resolve();
/** Compose layout controls against the newest host view, including rapid consecutive edits. */
export function mutateView(
  kind: ViewKind,
  change: (view: ViewDefinition) => ViewDefinition,
): Promise<void> {
  const projectId = useEditor.getState().snapshot?.project.id;
  const next = queue.then(async () => {
    const snapshot = await window.lattice.snapshot();
    if (snapshot.project.id !== projectId)
      throw new Error('Project changed before the layout edit. Try again.');
    const current = snapshot.views[kind],
      updated = change(current);
    if (updated !== current) await window.lattice.saveView(updated);
  });
  queue = next.catch(() => undefined);
  return next;
}
