import type {
  Project,
  CommandBatch,
  TypeDefinition,
  RelationDefinition,
  AssemblyDefinition,
  Rule,
} from './types';
import { ref } from './types';

export class IntegrityError extends Error {
  override name = 'IntegrityError';
}
export class StaleRevisionError extends Error {
  override name = 'StaleRevisionError';
}
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new IntegrityError(message);
}
export const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'type',
  'title',
  'description',
  'default',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'allOf',
  'anyOf',
  'oneOf',
]);
export function assertSchema(schema: unknown): void {
  ensure(typeof schema === 'boolean' || object(schema), 'Schema must be an object or boolean');
  if (typeof schema === 'boolean') return;
  for (const [key, value] of Object.entries(schema)) {
    ensure(SUPPORTED_KEYWORDS.has(key), `Unsupported schema keyword: ${key}`);
    if (key === '$schema')
      ensure(
        value === 'https://json-schema.org/draft/2020-12/schema',
        'Only JSON Schema Draft 2020-12 is supported',
      );
    if (key === '$ref')
      ensure(
        typeof value === 'string' && (value.startsWith('#') || value.startsWith('lattice:')),
        'Schema references must be local or lattice: package references',
      );
    if (key === '$defs' || key === 'properties') {
      ensure(object(value), `${key} must be an object`);
      Object.values(value).forEach(assertSchema);
    }
    if (['items', 'additionalProperties'].includes(key)) assertSchema(value);
    if (['allOf', 'anyOf', 'oneOf'].includes(key)) {
      ensure(Array.isArray(value), `${key} must be an array`);
      value.forEach(assertSchema);
    }
  }
}
export function assertRules(rules: Rule[]): void {
  ensure(Array.isArray(rules), 'Rules must be an array');
  for (const r of rules) {
    ensure(object(r), 'Rule must be an object');
    ensure(
      [
        'required',
        'allowed',
        'endpoint-port',
        'relation-count',
        'dependency',
        'access',
        'reachability',
      ].includes(r.kind),
      'Unsupported rule kind',
    );
    if (r.kind === 'required' || r.kind === 'allowed')
      ensure(
        typeof r.property === 'string' && r.property.length > 0,
        'Property rule needs a property path',
      );
    if (r.kind === 'allowed')
      ensure(Array.isArray(r.values), 'Allowed-value rule needs a value array');
    if (r.kind === 'relation-count' || r.kind === 'dependency')
      ensure(
        typeof r.relation === 'string' && r.relation.includes('@'),
        'Dependency rules need an exact relationship reference',
      );
    if (r.kind === 'relation-count')
      ensure(r.direction === 'in' || r.direction === 'out', 'Relation count needs a direction');
    if (r.kind === 'reachability')
      ensure(
        Array.isArray(r.relations) &&
          r.relations.every((x) => typeof x === 'string') &&
          typeof r.targetType === 'string',
        'Reachability needs relationship and target type references',
      );
    if (r.kind === 'reachability')
      ensure(
        Number.isInteger(r.maxDepth) && r.maxDepth > 0 && r.maxDepth <= 10000,
        'Reachability depth must be between 1 and 10000',
      );
    if (r.kind === 'relation-count')
      ensure(
        (r.min === undefined || (Number.isInteger(r.min) && r.min >= 0)) &&
          (r.max === undefined || (Number.isInteger(r.max) && r.max >= 0)),
        'Invalid relation count',
      );
  }
}
export function assertDefinition(
  d: TypeDefinition | RelationDefinition | AssemblyDefinition,
): void {
  ensure(
    object(d) &&
      typeof d.id === 'string' &&
      /^[a-zA-Z][\w.-]+$/.test(d.id) &&
      /^\d+\.\d+\.\d+$/.test(d.version) &&
      typeof d.name === 'string',
    'Definition needs a namespaced ID, semantic version and name',
  );
  ensure('family' in d || 'sourceFamilies' in d || 'entities' in d, 'Definition family is missing');
  if ('schema' in d) {
    assertSchema(d.schema);
    assertRules(d.rules as Rule[]);
  }
  if ('family' in d) {
    ensure(
      Array.isArray(d.rules) &&
        d.rules.every((r: Rule) => !['access', 'endpoint-port'].includes(r.kind)),
      'Access and endpoint-port rules belong on relationship definitions',
    );
    ensure(
      typeof d.renderer === 'string' && ['node', 'container', 'annotation'].includes(d.renderer),
      'Unsupported presentation renderer',
    );
    ensure(
      typeof d.family === 'string' &&
        ['structure', 'purpose', 'capability', 'behavior', 'information', 'boundary'].includes(
          d.family,
        ),
      'Unknown type family',
    );
    ensure(Array.isArray(d.ports), 'Ports must be an array');
    ensure(new Set(d.ports.map((p) => p.id)).size === d.ports.length, 'Duplicate ports');
    for (const port of d.ports)
      ensure(
        object(port) &&
          typeof port.id === 'string' &&
          port.id.length > 0 &&
          typeof port.direction === 'string' &&
          ['in', 'out', 'both'].includes(port.direction) &&
          (port.contractRef === undefined || typeof port.contractRef === 'string'),
        'Invalid port definition',
      );
  }
  if ('sourceFamilies' in d) {
    ensure(
      Array.isArray(d.rules) &&
        d.rules.every((r: Rule) =>
          ['required', 'allowed', 'endpoint-port', 'access'].includes(r.kind),
        ),
      'Relationship rules support properties, endpoint compatibility and access; place graph traversal/count rules on entity types',
    );
    ensure(
      Array.isArray(d.sourceFamilies) &&
        Array.isArray(d.targetFamilies) &&
        d.sourceFamilies.every((f) =>
          ['structure', 'purpose', 'capability', 'behavior', 'information', 'boundary'].includes(f),
        ) &&
        d.targetFamilies.every((f) =>
          ['structure', 'purpose', 'capability', 'behavior', 'information', 'boundary'].includes(f),
        ),
      'Invalid relationship endpoint families',
    );
    ensure(
      d.direction === 'directed' || d.direction === 'undirected',
      'Invalid relationship direction',
    );
    ensure(
      ['source-depends-on-target', 'target-depends-on-source', 'possible', 'none'].includes(
        String(d.impact),
      ),
      'Invalid impact interpretation',
    );
  }
  if ('entities' in d) {
    ensure(
      Array.isArray(d.entities) &&
        Array.isArray(d.relationships) &&
        Array.isArray(d.dependencies) &&
        Array.isArray(d.parameters) &&
        Array.isArray(d.ports),
      'Malformed assembly',
    );
    const ids = new Set(d.entities.map((e) => e.id));
    ensure(ids.size === d.entities.length, 'Assembly identity collision');
    for (const r of d.relationships)
      ensure(ids.has(r.source) && ids.has(r.target), 'Assembly relationship endpoint missing');
  }
}
export function assertProject(value: unknown): asserts value is Project {
  ensure(object(value), 'Project must be a JSON object');
  ensure(value.schemaVersion === '1.0.0', 'Unsupported schema version; original data preserved');
  ensure(
    typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      typeof value.purpose === 'string' &&
      Number.isSafeInteger(value.revision) &&
      Number(value.revision) >= 0,
    'Invalid project envelope',
  );
  for (const collection of [
    'entities',
    'relationships',
    'types',
    'relationTypes',
    'assemblies',
    'instances',
    'bindings',
    'dispositions',
    'extensions',
  ])
    ensure(object(value[collection]), `Missing project collection: ${collection}`);
  for (const collection of ['reviews', 'decisions'])
    ensure(Array.isArray(value[collection]), `Missing project collection: ${collection}`);
  const p = value as unknown as Project;
  const ids = new Set<string>([p.id]);
  for (const records of [p.entities, p.relationships, p.instances, p.bindings])
    for (const [key, item] of Object.entries(records)) {
      ensure(
        object(item) && key === item.id && typeof item.id === 'string',
        'Invalid record identity',
      );
      ensure(
        item.id.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(item.id),
        'Invalid stable record identity',
      );
      ensure(!ids.has(item.id), `ID collision: ${item.id}`);
      ids.add(item.id);
    }
  for (const e of Object.values(p.entities)) {
    ensure(
      typeof e.name === 'string' &&
        typeof e.typeRef === 'string' &&
        object(e.properties) &&
        object(e.propertyStatus) &&
        Array.isArray(e.systemIds) &&
        object(e.provenance),
      'Malformed entity',
    );
    ensure(
      ['planned', 'implemented', 'verified'].includes(e.implementationStatus) &&
        Array.isArray(e.evidence),
      'Invalid implementation claim',
    );
  }
  for (const r of Object.values(p.relationships))
    ensure(
      typeof r.typeRef === 'string' &&
        !!p.entities[r.source] &&
        !!p.entities[r.target] &&
        object(r.properties) &&
        object(r.provenance),
      'Relationship has missing endpoints or malformed properties',
    );
  for (const records of [p.types, p.relationTypes, p.assemblies])
    for (const [key, d] of Object.entries(records)) {
      assertDefinition(d);
      ensure(key === ref(d), 'Definition key mismatch');
    }
  for (const b of Object.values(p.bindings)) {
    ensure(
      object(b.resource) &&
        typeof b.resource.rootId === 'string' &&
        typeof b.resource.path === 'string' &&
        Array.isArray(b.entityIds) &&
        Array.isArray(b.mappings),
      'Malformed artifact binding',
    );
    ensure(['independent', 'generated', 'managed'].includes(b.ownership), 'Unknown ownership mode');
    for (const m of b.mappings)
      ensure(
        !!p.entities[m.entityId] &&
          typeof m.pointer === 'string' &&
          typeof m.locator === 'string' &&
          ['markdown', 'json', 'text'].includes(m.format),
        'Invalid artifact mapping',
      );
  }
}
export function assertBatch(value: unknown): asserts value is CommandBatch {
  ensure(
    object(value) &&
      Number.isSafeInteger(value.baseRevision) &&
      typeof value.reason === 'string' &&
      Array.isArray(value.operations) &&
      value.operations.length > 0 &&
      value.operations.length <= 5000,
    'Invalid command envelope',
  );
  const kinds = [
    'create-entity',
    'update-entity',
    'set-value',
    'remove-entity',
    'put-relationship',
    'remove-relationship',
    'register-type',
    'register-relation',
    'register-assembly',
    'instantiate',
    'upgrade-instance',
    'put-binding',
    'remove-binding',
    'disposition',
    'decision',
    'review',
    'replace-snapshot',
  ];
  for (const operation of value.operations) {
    ensure(object(operation) && kinds.includes(String(operation.kind)), 'Unknown command');
    if (operation.kind === 'update-entity')
      ensure(
        Object.keys(operation).every((key) =>
          [
            'kind',
            'id',
            'name',
            'typeRef',
            'properties',
            'propertyStatus',
            'systemIds',
            'provenance',
            'implementationStatus',
            'evidence',
          ].includes(key),
        ),
        'Unknown entity update field',
      );
  }
}
