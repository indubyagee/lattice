import type { JsonObject, Project } from '../domain/types';
import { kindOf } from '../domain/builtins';
export type EdgeCategory =
  | 'structure'
  | 'behavior'
  | 'information'
  | 'authority'
  | 'denial'
  | 'validation'
  | 'dependency'
  | 'association';
export const EDGE_LEGEND: {
  category: EdgeCategory;
  name: string;
  pattern: string;
  description: string;
}[] = [
  {
    category: 'structure',
    name: 'Structure & responsibility',
    pattern: 'solid',
    description:
      'Ownership or responsibility. Contains uses a diamond at the owner. An arrow follows the declared source-to-target direction.',
  },
  {
    category: 'behavior',
    name: 'Behavior & handoffs',
    pattern: 'solid',
    description:
      'Sequence, branches, joins, transitions and handoffs. Follow the arrow and read the relationship label.',
  },
  {
    category: 'information',
    name: 'Information & artifacts',
    pattern: 'dashed',
    description:
      'Reads, writes, context and artifact exchange. Arrows show relationship direction; Reads points from the reader to its source, not the physical movement of data.',
  },
  {
    category: 'authority',
    name: 'Authority & grants',
    pattern: 'dash-dot',
    description:
      'Governance, constraints or explicit grants. Intended tool use is not an authorization.',
  },
  {
    category: 'denial',
    name: 'Explicit denial',
    pattern: 'short dash / stop',
    description:
      'An explicit denial; the target endpoint has a stop bar. Denial takes precedence in access checks.',
  },
  {
    category: 'validation',
    name: 'Validation & satisfaction',
    pattern: 'dotted',
    description:
      'Connect a requirement to its check or declared satisfaction. These links do not mean a runtime test has passed.',
  },
  {
    category: 'dependency',
    name: 'Dependencies & use',
    pattern: 'long dash',
    description:
      'A declared dependency, configuration or use. Impact follows the interpretation in its definition.',
  },
  {
    category: 'association',
    name: 'Association / custom',
    pattern: 'fine dots',
    description:
      'A general or custom relationship. Labels and its pinned definition remain authoritative; undirected definitions have no arrow.',
  },
];
export const EDGE_COLORS = {
  light: {
    structure: '#526b62',
    behavior: '#326a9b',
    information: '#24717c',
    authority: '#866025',
    denial: '#a44735',
    validation: '#74549a',
    dependency: '#577247',
    association: '#68747a',
  },
  dark: {
    structure: '#aac4b7',
    behavior: '#80b9ec',
    information: '#77c8cf',
    authority: '#e1bd76',
    denial: '#f2a391',
    validation: '#c8a9ef',
    dependency: '#aad191',
    association: '#aab9c1',
  },
};
export function edgePresentation(
  reference: string,
  properties: JsonObject,
  theme: 'light' | 'dark',
  failed = false,
  adjacent = false,
) {
  const kind = kindOf(reference);
  const category: EdgeCategory =
    kind === 'denies'
      ? 'denial'
      : ['precedes', 'hands-off-to', 'branches-to', 'joins', 'transitions-to'].includes(kind)
        ? 'behavior'
        : ['reads', 'writes', 'receives-context', 'retains-in', 'produces', 'consumes'].includes(
              kind,
            )
          ? 'information'
          : ['governed-by', 'grants', 'constrained-by'].includes(kind)
            ? 'authority'
            : ['checked-by', 'satisfies'].includes(kind)
              ? 'validation'
              : [
                    'depends-on',
                    'uses-capability',
                    'uses-tool',
                    'configured-with-model',
                    'pursues-goal',
                  ].includes(kind)
                ? 'dependency'
                : ['contains', 'fulfills-role', 'delegates-to', 'runs-in', 'performs'].includes(
                      kind,
                    )
                  ? 'structure'
                  : 'association';
  const importance = ['critical', 'high', 'low'].includes(String(properties.importance))
    ? String(properties.importance)
    : 'normal';
  const width =
    importance === 'critical'
      ? 3.2
      : importance === 'high'
        ? 2.6
        : importance === 'low'
          ? 1.2
          : 1.8;
  const dash =
    category === 'information'
      ? '6 4'
      : category === 'authority'
        ? '8 3 2 3'
        : category === 'denial'
          ? '3 3'
          : category === 'validation'
            ? '2 5'
            : category === 'dependency'
              ? '10 5'
              : category === 'association'
                ? '1 5'
                : undefined;
  return {
    category,
    importance,
    color: failed ? EDGE_COLORS[theme].denial : EDGE_COLORS[theme][category],
    width: Math.max(width, failed ? 2.8 : 0) + (adjacent ? 1.6 : 0),
    dash,
    contains: kind === 'contains',
    denial: kind === 'denies',
    description: EDGE_LEGEND.find((item) => item.category === category)!.description,
  };
}
export function immediateConnections(project: Pick<Project, 'relationships'>, selected: string[]) {
  const selectedIds = new Set(selected),
    nodes = new Set<string>(),
    edges = new Set<string>();
  for (const r of Object.values(project.relationships))
    if (selectedIds.has(r.source) || selectedIds.has(r.target)) {
      edges.add(r.id);
      if (!selectedIds.has(r.source)) nodes.add(r.source);
      if (!selectedIds.has(r.target)) nodes.add(r.target);
    }
  return { nodes, edges };
}
