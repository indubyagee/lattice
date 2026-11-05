import type { CommandBatch, Operation, Project, ResourceRef } from '../domain/types';
import { createEntity, typeRef } from '../domain/builtins';

import { digest, sha256 } from '../domain/hash';
import { assertBatch, ensure } from '../domain/integrity';

export interface SelectedScope {
  entityIds: string[];
  excerpts: { resourceLabel: string; content: string; resource?: ResourceRef; hash?: string }[];
}
export interface ProposalGroup {
  id: string;
  title: string;
  operations: Operation[];
  requires: string[];
}
export interface FilePatch {
  resource: { rootId: string; path: string };
  expectedHash: string;
  before: string;
  after: string;
  reason: string;
}
export interface Proposal {
  id: string;
  baseRevision: number;
  scope: SelectedScope;
  reasons: string[];
  assumptions: string[];
  groups: ProposalGroup[];
  patches: FilePatch[];
  provider: 'simulated';
  status: 'pending' | 'accepted' | 'partial' | 'rejected';
}
export interface ProviderRequest {
  prompt: string;
  baseRevision: number;
  model: Pick<
    Project,
    'name' | 'purpose' | 'entities' | 'relationships' | 'types' | 'relationTypes'
  >;
  scope: SelectedScope;
}
export type AiEvent =
  { kind: 'progress'; message: string } | { kind: 'proposal'; proposal: Proposal };
export interface AiProvider {
  readonly id: string;
  propose(request: ProviderRequest, signal: AbortSignal): AsyncIterable<AiEvent>;
}
/** Explicit simulation; this implementation makes no network requests. */
export class FakeProvider implements AiProvider {
  readonly id = 'simulated-deterministic@1';
  async *propose(request: ProviderRequest, signal: AbortSignal): AsyncIterable<AiEvent> {
    if (signal.aborted) throw new Error('Proposal cancelled');
    yield {
      kind: 'progress',
      message: 'Simulated provider: preparing an example command proposal',
    };
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    if (signal.aborted) throw new Error('Proposal cancelled');
    if (request.prompt.includes('[fail]'))
      throw new Error('Simulated provider failure; current work preserved');
    if (request.prompt.includes('[malformed]')) {
      assertBatch({
        baseRevision: request.baseRevision,
        operations: [{ kind: 'unknown' }],
        reason: 'invalid example',
      });
    }
    const deterministicId = (label: string) => 'simulated-' + digest([request, label]).slice(0, 24);
    const scope = request.scope.entityIds.filter((id) => request.model.entities[id]);
    const groups: ProposalGroup[] = [];
    if (scope.length) {
      for (const id of scope) {
        const e = request.model.entities[id]!;
        groups.push({
          id: `describe-${id}`,
          title: `Propose a description for ${e.name}`,
          requires: [],
          operations: [
            {
              kind: 'update-entity',
              id,
              properties: {
                ...e.properties,
                description: `Proposed description for ${e.name}. Review and replace this simulated example.`,
              },
              propertyStatus: { ...e.propertyStatus, description: 'proposed' },
            },
          ],
        });
      }
    } else {
      const system = createEntity(typeRef('system'), 'Example system'),
        goal = createEntity(typeRef('goal'), 'Clarify intended outcome');
      system.id = deterministicId('system');
      goal.id = deterministicId('goal');
      system.provenance = { actor: 'simulated-provider', at: '2026-11-01T00:00:00.000Z' };
      goal.provenance = { ...system.provenance };
      system.properties.description = 'Simulated initial design — edit to specify your system.';
      goal.properties.description = 'State a concrete outcome and acceptance criteria.';
      system.propertyStatus.description = 'proposed';
      goal.propertyStatus.description = 'proposed';
      const first = 'initial-system';
      groups.push(
        {
          id: first,
          title: 'Create an example system',
          requires: [],
          operations: [{ kind: 'create-entity', entity: system }],
        },
        {
          id: 'initial-goal',
          title: 'Add a proposed goal',
          requires: [first],
          operations: [
            { kind: 'create-entity', entity: goal },
            {
              kind: 'put-relationship',
              relationship: {
                id: deterministicId('relationship'),
                typeRef: typeRef('pursues-goal'),
                source: system.id,
                target: goal.id,
                properties: {},
                provenance: { actor: 'simulated-provider', at: '2026-11-01T00:00:00.000Z' },
              },
            },
          ],
        },
      );
    }
    yield {
      kind: 'proposal',
      proposal: {
        id: deterministicId('proposal'),
        baseRevision: request.baseRevision,
        scope: structuredClone(request.scope),
        reasons: ['Demonstrates reviewed commands without contacting a live provider.'],
        assumptions: ['Generated content is an example and has not been judged adequate.'],
        groups,
        patches: request.scope.excerpts
          .filter((e) => e.resource && e.hash && /\.md$/i.test(e.resource.path))
          .map((e) => {
            const eol = e.content.includes('\r\n') ? '\r\n' : '\n';
            return {
              resource: e.resource!,
              expectedHash: e.hash!,
              before: e.content,
              after:
                e.content +
                eol +
                '<!-- Simulated suggestion: review this file change before saving. -->' +
                eol,
              reason:
                'Example file edit. Accepting it saves text separately and requires reconciliation of affected mappings.',
            };
          }),
        provider: 'simulated',
        status: 'pending',
      },
    };
  }
}
export function scopeRequest(
  project: Project,
  prompt: string,
  scope: SelectedScope,
): ProviderRequest {
  ensure(prompt.length <= 20000, 'Prompt is too long');
  ensure(
    scope.excerpts.reduce((n, e) => n + e.content.length, 0) <= 200000,
    'Selected excerpts are too large',
  );
  for (const e of scope.excerpts)
    if (e.resource)
      ensure(
        e.hash === sha256(e.content),
        'Selected resource excerpt must include the exact loaded file hash',
      );
  const selected = new Set(scope.entityIds);
  const entities = Object.fromEntries(
    Object.entries(project.entities).filter(([id]) => selected.has(id)),
  );
  const relationships = Object.fromEntries(
    Object.entries(project.relationships).filter(
      ([, r]) => selected.has(r.source) && selected.has(r.target),
    ),
  );
  const typeRefs = new Set(Object.values(entities).map((e) => e.typeRef));
  const relationRefs = new Set(Object.values(relationships).map((r) => r.typeRef));
  return {
    prompt,
    baseRevision: project.revision,
    scope: structuredClone(scope),
    model: {
      name: project.name,
      purpose: project.purpose,
      entities: structuredClone(entities),
      relationships: structuredClone(relationships),
      types: Object.fromEntries(Object.entries(project.types).filter(([key]) => typeRefs.has(key))),
      relationTypes: Object.fromEntries(
        Object.entries(project.relationTypes).filter(([key]) => relationRefs.has(key)),
      ),
    },
  };
}
export function proposalBatch(
  project: Project,
  proposal: Proposal,
  selectedGroups: string[],
): CommandBatch {
  ensure(
    project.revision === proposal.baseRevision,
    'Stale proposal: recompute against the current revision',
  );
  const selected = new Set(selectedGroups);
  const groups = proposal.groups.filter((g) => selected.has(g.id));
  ensure(groups.length > 0, 'Choose at least one proposal group');
  for (const group of groups)
    ensure(
      group.requires.every((id) => selected.has(id)),
      `Group ${group.title} needs its prerequisite groups`,
    );
  const operations = groups.flatMap((g) => g.operations);
  for (const op of operations) {
    ensure(
      !['review', 'decision', 'disposition', 'replace-snapshot'].includes(op.kind),
      'AI proposals cannot record human approvals, check dispositions, or replace the project',
    );
    if (op.kind === 'create-entity')
      ensure(
        op.entity.implementationStatus === 'planned',
        'AI cannot invent an implemented or verified claim',
      );
    if (op.kind === 'update-entity')
      ensure(
        !op.implementationStatus || op.implementationStatus === 'planned',
        'AI cannot invent an implemented or verified claim',
      );
  }
  const batch: CommandBatch = {
    baseRevision: proposal.baseRevision,
    reason: `Accept simulated proposal ${proposal.id}`,
    operations,
  };
  assertBatch(batch);
  return batch;
}
export const scopeFingerprint = (scope: SelectedScope): string => digest(scope);
