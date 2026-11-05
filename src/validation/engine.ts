import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import type { CheckStatus, Entity, Finding, JsonObject, Project, Rule } from '../domain/types';
import { digest, designHash, pointerGet } from '../domain/hash';
import { kindOf } from '../domain/builtins';

export interface ArtifactInspection {
  bindingId: string;
  state: 'current' | 'changed' | 'missing' | 'unknown';
  hash?: string;
  message?: string;
}
export interface ValidationResult {
  revision: number;
  designHash: string;
  findings: Finding[];
  durationMs: number;
}
const schemaCache = new Map<string, Map<string, ValidateFunction>>();
const topics = [
  'responsibilities',
  'interfaces',
  'information',
  'failure-paths',
  'acceptance',
] as const;

function schemas(project: Project): Map<string, ValidateFunction> {
  const key = digest([project.types, project.relationTypes]);
  const cached = schemaCache.get(key);
  if (cached) return cached;
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    logger: false,
  });
  for (const [reference, d] of Object.entries({ ...project.types, ...project.relationTypes }))
    ajv.addSchema(d.schema, `lattice:${reference}`);
  const result = new Map<string, ValidateFunction>();
  for (const reference of Object.keys({ ...project.types, ...project.relationTypes }))
    result.set(reference, ajv.getSchema(`lattice:${reference}`)!);
  if (schemaCache.size > 12) schemaCache.delete(schemaCache.keys().next().value!);
  schemaCache.set(key, result);
  return result;
}
export function validateDefinitionSchemas(project: Project): void {
  schemas(project);
}
/** Specification analysis only. These checks neither execute nor enforce a modeled system. */
export function validate(
  project: Project,
  inspections: ArtifactInspection[] = [],
): ValidationResult {
  const began = performance.now(),
    hash = designHash(project),
    findings: Finding[] = [];
  const add = (
    rule: string,
    targets: string[],
    status: CheckStatus,
    message: string,
    inputs: unknown,
    mandatory = true,
    evidence: string[] = [],
  ) => {
    const inputHash = digest(inputs),
      id = `${rule}:${targets.join(':')}`,
      disposition = project.dispositions[id];
    findings.push({
      id,
      rule,
      version: '1.0.0',
      targets,
      status,
      severity: mandatory ? 'error' : 'warning',
      mandatory,
      message,
      evidence,
      revision: project.revision,
      inputHash,
      stale: !!disposition && disposition.inputHash !== inputHash,
      disposition: disposition?.inputHash === inputHash ? disposition.disposition : 'open',
    });
  };
  const check = (
    rule: string,
    targets: string[],
    pass: boolean,
    message: string,
    inputs: unknown,
    mandatory = true,
    evidence: string[] = [],
  ) => add(rule, targets, pass ? 'pass' : 'fail', message, inputs, mandatory, evidence);
  check(
    'project-purpose',
    [project.id],
    !!project.name.trim() && !!project.purpose.trim(),
    'Project needs a name and purpose',
    [project.name, project.purpose],
  );
  check(
    'system-present',
    [project.id],
    Object.values(project.entities).some((e) => kindOf(e.typeRef) === 'system'),
    'At least one system must be specified',
    Object.values(project.entities).map((e) => e.typeRef),
  );
  let validators: Map<string, ValidateFunction>;
  try {
    validators = schemas(project);
  } catch (error) {
    add(
      'schema-compilation',
      [project.id],
      'unknown',
      `Definition schema cannot be compiled: ${String(error)}`,
      project.types,
    );
    return {
      revision: project.revision,
      designHash: hash,
      findings,
      durationMs: performance.now() - began,
    };
  }
  const outgoing = new Map<string, Project['relationships'][string][]>(),
    incoming = new Map<string, Project['relationships'][string][]>();
  for (const r of Object.values(project.relationships)) {
    outgoing.set(r.source, [...(outgoing.get(r.source) ?? []), r]);
    incoming.set(r.target, [...(incoming.get(r.target) ?? []), r]);
  }
  function ruleCheck(
    e: Pick<Entity, 'id' | 'name' | 'properties'>,
    rule: Rule,
    index: number | string,
  ): void {
    const key = `${rule.kind}-${index}`;
    if (rule.kind === 'required')
      check(
        key,
        [e.id],
        pointerGet(
          e.properties,
          rule.property.startsWith('/') ? rule.property : `/${rule.property}`,
        ) !== undefined,
        `Required property ${rule.property}`,
        e.properties,
      );
    if (rule.kind === 'allowed')
      check(
        key,
        [e.id],
        rule.values.some(
          (v) =>
            digest(v) ===
            digest(
              pointerGet(
                e.properties,
                rule.property.startsWith('/') ? rule.property : `/${rule.property}`,
              ) ?? null,
            ),
        ),
        `Allowed values for ${rule.property}`,
        e.properties,
      );
    if (rule.kind === 'relation-count') {
      const relations = (rule.direction === 'out' ? outgoing : incoming).get(e.id) ?? [];
      const count = relations.filter((r) => r.typeRef === rule.relation).length;
      check(
        key,
        [e.id],
        (rule.min === undefined || count >= rule.min) &&
          (rule.max === undefined || count <= rule.max),
        `${e.name}: ${rule.relation} count ${count}; required ${rule.min ?? 0}–${rule.max ?? 'unbounded'}`,
        [e, relations],
      );
    }
    if (rule.kind === 'dependency') {
      const candidates = (outgoing.get(e.id) ?? []).filter((r) => r.typeRef === rule.relation);
      check(
        key,
        [e.id],
        candidates.some(
          (r) => !rule.targetType || project.entities[r.target]?.typeRef === rule.targetType,
        ),
        `${e.name} needs dependency ${rule.relation}`,
        [e, candidates],
      );
    }
    if (rule.kind === 'reachability') {
      if (
        rule.boundProperty &&
        typeof e.properties[rule.boundProperty] === 'number' &&
        Number(e.properties[rule.boundProperty]) > 0
      ) {
        check(key, [e.id], true, 'Explicit positive iteration bound declared', [e, rule]);
        return;
      }
      const queue = [{ id: e.id, depth: 0, path: [e.id] }],
        seen = new Set([e.id]);
      let path: string[] | undefined;
      while (queue.length) {
        const current = queue.shift()!;
        if (current.depth >= rule.maxDepth) continue;
        for (const r of outgoing.get(current.id) ?? []) {
          if (!rule.relations.includes(r.typeRef)) continue;
          const next = project.entities[r.target];
          const nextPath = [...current.path, r.id, r.target];
          if (next?.typeRef === rule.targetType) {
            path = nextPath;
            break;
          }
          if (!seen.has(r.target)) {
            seen.add(r.target);
            queue.push({ id: r.target, depth: current.depth + 1, path: nextPath });
          }
        }
        if (path) break;
      }
      check(
        key,
        [e.id],
        !!path,
        `${e.name}: ${path ? 'completion path found' : 'missing completion path or declared bound'} to ${rule.targetType}`,
        [e, rule, [...seen].map((id) => outgoing.get(id))],
        true,
        path ?? [],
      );
    }
  }
  for (const e of Object.values(project.entities)) {
    const d = project.types[e.typeRef];
    if (!d) {
      add('unknown-type', [e.id], 'unknown', `Definition unavailable: ${e.typeRef}`, e);
      continue;
    }
    const validator = validators.get(e.typeRef)!;
    const valid = validator(e.properties);
    check(
      'properties',
      [e.id],
      !!valid,
      valid
        ? `${e.name}: properties valid`
        : `${e.name}: ${validator.errors?.map((err) => `${err.instancePath || '/'} ${err.message}`).join('; ')}`,
      [e.typeRef, e.properties, d.schema],
    );
    if (e.implementationStatus === 'verified')
      check(
        'implementation-evidence',
        [e.id],
        e.evidence.length > 0,
        'Verified claims need evidence references',
        [e.implementationStatus, e.evidence],
      );
    d.rules.forEach((r, i) => ruleCheck(e, r, i));
    if (kindOf(e.typeRef) === 'requirement')
      check(
        'requirement-check',
        [e.id],
        (outgoing.get(e.id) ?? []).some((r) => kindOf(r.typeRef) === 'checked-by'),
        `${e.name} needs a check specification`,
        [e, outgoing.get(e.id)],
      );
  }
  for (const r of Object.values(project.relationships)) {
    const d = project.relationTypes[r.typeRef],
      source = project.entities[r.source],
      target = project.entities[r.target];
    if (!d) {
      add(
        'unknown-relation',
        [r.id],
        'unknown',
        `Relationship definition unavailable: ${r.typeRef}`,
        r,
      );
      continue;
    }
    if (!source || !target) {
      add('missing-endpoint', [r.id], 'fail', 'Relationship endpoint missing', r);
      continue;
    }
    const sf = project.types[source.typeRef]?.family,
      tf = project.types[target.typeRef]?.family;
    if (!sf || !tf)
      add('endpoint-family', [r.id], 'unknown', 'Endpoint family cannot be checked', r);
    else
      check(
        'endpoint-family',
        [r.id],
        d.sourceFamilies.includes(sf) && d.targetFamilies.includes(tf),
        `${source.name} → ${target.name}: endpoint compatibility`,
        [r, d, sf, tf],
      );
    const validator = validators.get(r.typeRef)!;
    check(
      'relationship-properties',
      [r.id],
      !!validator(r.properties),
      'Relationship properties must match their schema',
      [r.properties, d.schema],
    );
    d.rules.forEach((rule, index) => {
      if (rule.kind === 'required' || rule.kind === 'allowed')
        ruleCheck({ ...r, name: d.name }, rule, index);
    });
    if (r.sourcePort || r.targetPort) {
      const a = project.types[source.typeRef]?.ports.find((p) => p.id === r.sourcePort),
        b = project.types[target.typeRef]?.ports.find((p) => p.id === r.targetPort);
      if (!a?.contractRef || !b?.contractRef)
        add('ports', [r.id], 'unknown', 'Port contract references are unresolved', [
          a ?? null,
          b ?? null,
        ]);
      else
        check(
          'ports',
          [r.id],
          a.contractRef === b.contractRef && a.direction !== 'in' && b.direction !== 'out',
          'Port contract and direction compatibility',
          [a, b],
        );
    }
    if (d.rules.some((rule) => rule.kind === 'access')) {
      const rules = Object.values(project.relationships).filter(
        (candidate) =>
          ['grants', 'denies'].includes(kindOf(candidate.typeRef)) &&
          candidate.target === r.target &&
          (candidate.source === r.source ||
            (candidate.properties.inherit === true &&
              (outgoing.get(candidate.source) ?? []).some(
                (member) => kindOf(member.typeRef) === 'contains' && member.target === r.source,
              ))) &&
          (candidate.properties.action === undefined || candidate.properties.action === 'use'),
      );
      const entityRules = Object.values(project.entities).filter(
        (e) =>
          kindOf(e.typeRef) === 'access-rule' &&
          e.properties.actorId === r.source &&
          e.properties.resourceId === r.target &&
          e.properties.action === 'use',
      );
      const denied =
        rules.some((x) => kindOf(x.typeRef) === 'denies') ||
        entityRules.some((e) => e.properties.effect === 'deny');
      const granted =
        rules.some((x) => kindOf(x.typeRef) === 'grants') ||
        entityRules.some((e) => e.properties.effect === 'grant');
      add(
        'tool-access',
        [r.id],
        denied ? 'fail' : granted ? 'pass' : 'unknown',
        `${source.name} → ${target.name}: ${denied ? 'explicit denial takes precedence' : granted ? 'explicit grant declared' : 'permission unspecified; intended use is not a grant'}`,
        [r, rules, entityRules],
        true,
        [r.source, r.id, r.target, ...rules.map((x) => x.id), ...entityRules.map((x) => x.id)],
      );
    }
  }
  const ownership = new Map<string, string>();
  for (const binding of Object.values(project.bindings)) {
    if (binding.ownership !== 'independent')
      for (const m of binding.mappings) {
        const key = `${binding.resource.rootId}:${binding.resource.path}:${m.locator}`;
        check(
          'ownership',
          [binding.id, m.id],
          !ownership.has(key),
          'Managed artifact ownership must not overlap',
          [key, ownership.get(key) ?? null, binding.id],
        );
        ownership.set(key, binding.id);
      }
    const modelChanged =
      !!binding.baseline &&
      binding.mappings.some(
        (m) =>
          digest(pointerGet(project.entities[m.entityId], m.pointer) ?? null) !==
          digest(binding.baseline!.values[m.id] ?? null),
      );
    const inspection = inspections.find((i) => i.bindingId === binding.id);
    const status =
      inspection?.state === 'current' && binding.state === 'accepted' && !modelChanged
        ? 'pass'
        : inspection?.state === 'unknown' || !inspection
          ? 'unknown'
          : 'fail';
    add(
      'artifact-freshness',
      [binding.id],
      status,
      modelChanged
        ? `${binding.resource.path}: mapped model values changed; reconciliation required`
        : (inspection?.message ?? `${binding.resource.path}: ${binding.state}`),
      [binding, inspection ?? null, modelChanged],
    );
  }
  for (const instance of Object.values(project.instances))
    check(
      'assembly-pin',
      [instance.id],
      !!project.assemblies[instance.definitionRef] &&
        digest(project.assemblies[instance.definitionRef]) === instance.definitionHash,
      'Assembly pin must match its exact definition',
      [instance, project.assemblies[instance.definitionRef] ?? null],
    );
  for (const topic of topics) {
    const review = project.reviews.find((r) => r.topic === topic && r.designHash === hash);
    add(
      `review-${topic}`,
      [project.id],
      review ? 'pass' : 'unknown',
      `Human design review: ${topic}`,
      [hash, review ?? null],
    );
  }
  return {
    revision: project.revision,
    designHash: hash,
    findings,
    durationMs: performance.now() - began,
  };
}
export interface Readiness {
  ready: boolean;
  blockers: Finding[];
  advisory: Finding[];
  profile: 'implementation-ready@1.0.0';
}
export function readiness(result: ValidationResult): Readiness {
  return {
    profile: 'implementation-ready@1.0.0',
    ready: !result.findings.some(
      (f) => f.mandatory && ((f.status !== 'pass' && f.status !== 'not-applicable') || f.stale),
    ),
    blockers: result.findings.filter(
      (f) => f.mandatory && ((f.status !== 'pass' && f.status !== 'not-applicable') || f.stale),
    ),
    advisory: result.findings.filter((f) => !f.mandatory && f.status !== 'pass'),
  };
}
export function propertiesSchema(properties: JsonObject): JsonObject {
  return { type: 'object', properties, additionalProperties: true };
}
