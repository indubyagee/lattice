import { parentPort } from 'node:worker_threads';
import { validate } from '../validation/engine';
import type { Project } from '../domain/types';
import type { ArtifactInspection } from '../validation/engine';
parentPort?.on(
  'message',
  (request: { id: number; project: Project; inspections: ArtifactInspection[] }) => {
    try {
      parentPort?.postMessage({
        id: request.id,
        result: validate(request.project, request.inspections),
      });
    } catch (error) {
      parentPort?.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
