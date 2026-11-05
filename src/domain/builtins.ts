import type { Family, Project, RelationDefinition, TypeDefinition, Entity } from './types';
import { provenance, ref, uid } from './types';

const families: Record<Family, string[]> = {
  structure: ['system', 'subsystem', 'agent', 'role', 'human-actor', 'environment', 'annotation'],
  purpose: ['goal', 'constraint', 'requirement', 'decision', 'acceptance-criterion'],
  capability: [
    'model-configuration',
    'capability',
    'action',
    'prompt',
    'skill',
    'skill-collection',
    'tool',
    'framework-reference',
  ],
  behavior: ['workflow', 'task', 'handoff', 'branch', 'loop', 'join', 'gate', 'human-interaction'],
  information: ['context-contract', 'state-definition', 'memory-store', 'artifact-contract'],
  boundary: [
    'authority-boundary',
    'access-rule',
    'trust-boundary',
    'validation-rule',
    'test-case',
    'evaluation-plan',
  ],
};
export const label = (slug: string): string =>
  slug
    .split('-')
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join(' ');
export const typeRef = (name: string): string => `lattice.${name}@1.0.0`;
export const kindOf = (reference: string): string =>
  reference.replace(/^lattice\./, '').split('@')[0]!;
export function builtinTypes(): Record<string, TypeDefinition> {
  const result: Record<string, TypeDefinition> = {};
  for (const [family, names] of Object.entries(families) as [Family, string[]][])
    for (const name of names) {
      const properties: Record<string, import('./types').JsonValue> = {
        description: { type: 'string', title: 'Description' },
      };
      let required: string[] = [];
      if (name === 'role') {
        properties.responsibilities = { type: 'string', title: 'Responsibilities' };
        required = ['responsibilities'];
      }
      if (name === 'task') {
        for (const p of ['inputs', 'outputs', 'failurePath'])
          properties[p] = { type: 'string', title: label(p) };
        required = ['inputs', 'outputs', 'failurePath'];
      }
      if (name === 'skill') {
        properties.body = { type: 'string', title: 'Skill instructions' };
        properties.slug = { type: 'string' };
        required = ['description', 'body'];
      }
      if (name === 'evaluation-plan') {
        properties.baseline = { type: 'string' };
        properties.criteria = { type: 'string' };
        required = ['baseline', 'criteria'];
      }
      if (name === 'access-rule') {
        properties.effect = { enum: ['grant', 'deny'] };
        properties.action = { type: 'string' };
        properties.inherit = { type: 'boolean' };
        required = ['effect', 'action'];
      }
      for (const key of required) {
        const schema = properties[key];
        if (
          schema &&
          typeof schema === 'object' &&
          !Array.isArray(schema) &&
          schema.type === 'string'
        )
          schema.minLength = 1;
      }
      const definition: TypeDefinition = {
        id: `lattice.${name}`,
        version: '1.0.0',
        name: label(name),
        family,
        description: `${label(name)} specification.`,
        schema: { type: 'object', properties, required, additionalProperties: true },
        ports: [],
        renderer: [
          'system',
          'subsystem',
          'workflow',
          'authority-boundary',
          'trust-boundary',
        ].includes(name)
          ? 'container'
          : name === 'annotation'
            ? 'annotation'
            : 'node',
        rules: [],
      };
      if (name === 'role')
        definition.rules.push({
          kind: 'relation-count',
          relation: typeRef('fulfills-role'),
          direction: 'in',
          min: 1,
        });
      if (name === 'loop')
        definition.rules.push({
          kind: 'reachability',
          relations: [typeRef('precedes'), typeRef('branches-to'), typeRef('transitions-to')],
          targetType: typeRef('gate'),
          maxDepth: 100,
          boundProperty: 'maxIterations',
        });
      result[ref(definition)] = definition;
    }
  return result;
}
export function builtinRelations(): Record<string, RelationDefinition> {
  const names = [
    'contains',
    'fulfills-role',
    'delegates-to',
    'pursues-goal',
    'constrained-by',
    'runs-in',
    'performs',
    'uses-capability',
    'uses-tool',
    'configured-with-model',
    'precedes',
    'hands-off-to',
    'branches-to',
    'joins',
    'transitions-to',
    'reads',
    'writes',
    'receives-context',
    'retains-in',
    'governed-by',
    'grants',
    'denies',
    'produces',
    'consumes',
    'depends-on',
    'satisfies',
    'checked-by',
    'associated-with',
  ];
  const all = Object.keys(families) as Family[];
  const result: Record<string, RelationDefinition> = {};
  const sourceDepends = new Set([
    'uses-tool',
    'uses-capability',
    'configured-with-model',
    'reads',
    'receives-context',
    'retains-in',
    'governed-by',
    'depends-on',
    'consumes',
    'constrained-by',
  ]);
  const targetDepends = new Set([
    'precedes',
    'hands-off-to',
    'produces',
    'performs',
    'fulfills-role',
    'checked-by',
    'satisfies',
  ]);
  for (const name of names) {
    const d: RelationDefinition = {
      id: `lattice.${name}`,
      version: '1.0.0',
      name: label(name),
      sourceFamilies: all,
      targetFamilies: all,
      direction: 'directed',
      impact: sourceDepends.has(name)
        ? 'source-depends-on-target'
        : targetDepends.has(name)
          ? 'target-depends-on-source'
          : name === 'associated-with'
            ? 'possible'
            : 'none',
      schema: { type: 'object' },
      rules: [{ kind: 'endpoint-port' }],
    };
    if (name === 'uses-tool') {
      d.sourceFamilies = ['structure', 'capability', 'behavior'];
      d.targetFamilies = ['capability'];
      d.rules.push({ kind: 'access' });
    }
    if (name === 'fulfills-role') {
      d.sourceFamilies = ['structure'];
      d.targetFamilies = ['structure'];
    }
    result[ref(d)] = d;
  }
  return result;
}
export function createProject(name = 'Untitled system', purpose = ''): Project {
  return {
    schemaVersion: '1.0.0',
    id: uid(),
    name,
    purpose,
    revision: 0,
    entities: {},
    relationships: {},
    types: builtinTypes(),
    relationTypes: builtinRelations(),
    assemblies: {},
    instances: {},
    bindings: {},
    decisions: [],
    reviews: [],
    dispositions: {},
    extensions: {},
  };
}
export function createEntity(type: string, name?: string): Entity {
  return {
    id: uid(),
    typeRef: type,
    name: name ?? label(kindOf(type)),
    properties: {},
    propertyStatus: {},
    systemIds: [],
    provenance: provenance(),
    implementationStatus: 'planned',
    evidence: [],
  };
}
