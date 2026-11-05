import type { JsonValue, Project } from '../domain/types';
import { canonical, designHash, digest, sha256 } from '../domain/hash';
import { kindOf } from '../domain/builtins';
import { ensure } from '../domain/integrity';
import {
  readiness,
  validate,
  type ArtifactInspection,
  type ValidationResult,
} from '../validation/engine';

export type ExportProfile = 'portable-spec@1.0.0' | 'codex-workspace@1.0.0';
export interface ExportFile {
  path: string;
  content: string;
  hash: string;
}
export interface ExportPreview {
  id: string;
  revision: number;
  designHash: string;
  profile: ExportProfile;
  mode: 'draft' | 'implementation-ready';
  generatedAt: string;
  files: ExportFile[];
  validation: ValidationResult;
  exclusions: string[];
}
const pretty = (v: unknown) => JSON.stringify(JSON.parse(canonical(v)), null, 2) + '\n';
const safeSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '') || 'skill';
function clean(value: unknown, path = '', exclusions: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((v, i) => clean(v, `${path}/${i}`, exclusions));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => {
        const next = `${path}/${key}`;
        if (
          /^(?:api[_-]?key|secret|password|credentials?|(?:access|refresh|auth)[_-]?token|client[_-]?secret|private[_-]?key|OPENAI_API_KEY)$/i.test(
            key,
          ) &&
          v
        ) {
          exclusions.push(next);
          return [key, '[excluded secret]'];
        }
        return [key, clean(v, next, exclusions)];
      }),
    );
  if (
    typeof value === 'string' &&
    (/\b[A-Za-z]:[\\/]/.test(value) ||
      /\\\\[^\s\\]+\\/.test(value) ||
      /\/(?:home|Users)\/[^/\s]+\//.test(value) ||
      /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/.test(
        value,
      ) ||
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(value))
  ) {
    exclusions.push(path);
    return '[excluded local path or credential]';
  }
  return value;
}
const md = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/\r\n/g, '\n') : canonical(v);
export function prepareExport(
  project: Project,
  profile: ExportProfile,
  mode: 'draft' | 'implementation-ready',
  generatedAt: string,
  inspections: ArtifactInspection[] = [],
): ExportPreview {
  ensure(
    ['portable-spec@1.0.0', 'codex-workspace@1.0.0'].includes(profile),
    'Unknown export profile',
  );
  const validation = validate(project, inspections);
  validation.findings.sort((a, b) => a.id.localeCompare(b.id));
  if (mode === 'implementation-ready')
    ensure(
      readiness(validation).ready,
      'Implementation readiness has failed, unknown or stale mandatory checks',
    );
  const exclusions: string[] = [];
  const sanitized = clean(project, '', exclusions) as Project;
  const exportValidation = clean(validation, '/validation', exclusions) as ValidationResult;
  exclusions.sort();
  const bindings = Object.values(sanitized.bindings).sort((a, b) => a.id.localeCompare(b.id));
  // Baselines may contain independent file content; exports reference resources by default.
  for (const binding of Object.values(sanitized.bindings)) delete binding.baseline;
  if (mode === 'implementation-ready')
    ensure(exclusions.length === 0, 'Resolve export exclusions before implementation-ready export');
  const files: ExportFile[] = [];
  const add = (path: string, content: string) => {
    ensure(
      !path.startsWith('/') &&
        !path.split('/').some((p) => p === '..' || p === '.' || p === '') &&
        !/[\\:]/.test(path),
      'Unsafe export path',
    );
    ensure(!files.some((f) => f.path === path), 'Duplicate generated path');
    files.push({ path, content, hash: sha256(content) });
  };
  const entities = Object.values(sanitized.entities).sort((a, b) => a.id.localeCompare(b.id)),
    relationships = Object.values(sanitized.relationships).sort((a, b) => a.id.localeCompare(b.id));
  const trace: Record<string, unknown> = {};
  let spec = `# ${sanitized.name}\n\n**${mode === 'draft' ? 'DRAFT — unresolved specification findings may remain' : 'Specification profile: implementation-ready@1.0.0'}**\n\nRevision: ${project.revision}. These are specification requirements, not runtime execution results.\n\n## Purpose and scope\n\n${sanitized.purpose || '[Purpose unresolved]'}\n`;
  const groups: [string, string[]][] = [
    ['Architecture and responsibilities', ['structure', 'capability']],
    ['Behavior and failure paths', ['behavior']],
    ['Information and contracts', ['information']],
    ['Authority and validation', ['boundary', 'purpose']],
  ];
  for (const [heading, families] of groups) {
    spec += `\n## ${heading}\n`;
    for (const e of entities.filter((e) =>
      families.includes(sanitized.types[e.typeRef]?.family ?? 'unknown'),
    )) {
      const marker = `entity-${e.id}`;
      trace[e.id] = {
        file: 'SYSTEM-SPECIFICATION.md',
        section: marker,
        properties: Object.keys(e.properties).sort(),
        bindings: bindings.filter((b) => b.entityIds.includes(e.id)).map((b) => b.resource),
      };
      spec += `\n<!-- lattice:begin ${marker} -->\n### ${e.name}\n\nType: \`${e.typeRef}\`. Implementation claim: **${e.implementationStatus}**${e.evidence.length ? `; evidence references: ${e.evidence.join(', ')}` : ''}.\n\n`;
      for (const [key, value] of Object.entries(e.properties).sort(([a], [b]) =>
        a.localeCompare(b),
      ))
        spec += `- **${key}:** ${md(value)}\n`;
      if (!Object.keys(e.properties).length) spec += '[Design properties unresolved]\n';
      const relations = relationships.filter((r) => r.source === e.id || r.target === e.id);
      if (relations.length)
        spec +=
          '\nDeclared relationships:\n\n' +
          relations
            .map(
              (r) =>
                `- ${sanitized.entities[r.source]?.name ?? r.source} → **${kindOf(r.typeRef)}** → ${sanitized.entities[r.target]?.name ?? r.target} (\`${r.id}\`)`,
            )
            .join('\n') +
          '\n';
      spec += `<!-- lattice:end ${marker} -->\n`;
    }
  }
  const unknown = entities.filter((e) => !sanitized.types[e.typeRef]);
  for (const e of unknown)
    trace[e.id] = {
      file: 'system-model.json',
      pointer: `/entities/${e.id.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      typeUnresolved: true,
    };
  if (unknown.length)
    spec +=
      '\n## Unresolved types\n\n' +
      unknown
        .map((e) => `- ${e.name}: ${e.typeRef}; original properties retained in system-model.json`)
        .join('\n') +
      '\n';
  spec +=
    '\n## Decisions and unresolved questions\n\n' +
    (sanitized.decisions.length
      ? sanitized.decisions
          .map((d) => `- ${d.question}: ${d.disposition}. ${d.rationale} (actor: ${d.actor})`)
          .join('\n')
      : 'No decision records supplied.') +
    '\n';
  for (const r of relationships)
    trace[r.id] = {
      file: 'system-model.json',
      pointer: `/relationships/${r.id}`,
      source: r.source,
      target: r.target,
    };
  for (const e of entities)
    for (const key of Object.keys(e.properties))
      trace[`${e.id}/properties/${key}`] = {
        file: 'SYSTEM-SPECIFICATION.md',
        section: `entity-${e.id}`,
        property: key,
      };
  add('system-model.json', pretty(sanitized));
  add('SYSTEM-SPECIFICATION.md', spec);
  let brief = `# Implementation brief: ${sanitized.name}\n\nStatus: ${mode}. Model revision: ${project.revision}.\n\n## Required behavior and interfaces\n\nUse SYSTEM-SPECIFICATION.md and the pinned definitions as the specification. Roles describe responsibilities; they do not require separate agents. A capability may be a script, skill, tool, prompt, human action, or system.\n\n`;
  for (const family of ['behavior', 'information', 'purpose'])
    for (const e of entities.filter((e) => sanitized.types[e.typeRef]?.family === family))
      brief += `- **${e.name}:** ${
        Object.entries(e.properties)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}: ${md(value)}`)
          .join('; ') || '[contract incomplete]'
      }\n`;
  brief +=
    '\n## Artifact ownership\n\n' +
    (bindings
      .map(
        (b) =>
          `- ${b.resource.rootId}/${b.resource.path}: ${b.ownership}; mappings ${b.mappings.map((m) => `${m.entityId}${m.pointer} → ${m.locator}`).join(', ') || 'none'}`,
      )
      .join('\n') || 'No associated artifacts declared.') +
    '\n\n## Acceptance and remaining choices\n\nImplement the declared acceptance criteria and failure paths. Planned checks are not completed tests. Release authorization and activation require separately modeled decisions.\n\n';
  brief +=
    exportValidation.findings
      .filter((f) => f.status !== 'pass' && f.status !== 'not-applicable')
      .map((f) => `- [${f.status}] ${f.message}`)
      .join('\n') + '\n';
  add('IMPLEMENTATION-BRIEF.md', brief);
  for (const [reference, d] of Object.entries({
    ...sanitized.types,
    ...sanitized.relationTypes,
    ...sanitized.assemblies,
  }))
    add(`definitions/${safeSlug(reference)}.json`, pretty(d));
  if (profile === 'codex-workspace@1.0.0') {
    const scopes = new Map<string, string[]>();
    const instructions = entities.filter(
      (e) => typeof e.properties.instructions === 'string' && e.properties.instructions.trim(),
    );
    for (const e of instructions) {
      const scope =
        typeof e.properties.instructionScope === 'string'
          ? e.properties.instructionScope.replace(/\\/g, '/').replace(/\/$/, '')
          : '';
      ensure(
        !scope.startsWith('/') &&
          !/[:]/.test(scope) &&
          !scope.split('/').some((p) => p === '..' || p === '.'),
        'Instruction scope must be a relative directory',
      );
      const list = scopes.get(scope) ?? [];
      list.push(`## ${e.name}\n\n${e.properties.instructions as string}\n`);
      scopes.set(scope, list);
    }
    for (const [scope, sections] of scopes)
      add(
        `${scope ? scope + '/' : ''}AGENTS.md`,
        `# Project instructions\n\nDerived from model revision ${project.revision}; directory scope: ${scope || 'repository root'}.\n\n${sections.join('\n')}`,
      );
    for (const e of entities.filter(
      (e) =>
        kindOf(e.typeRef) === 'skill' &&
        typeof e.properties.body === 'string' &&
        e.properties.body.trim() &&
        typeof e.properties.description === 'string' &&
        e.properties.description.trim(),
    )) {
      const slug = safeSlug(String(e.properties.slug ?? e.name));
      add(
        `.agents/skills/${slug}/SKILL.md`,
        `---\nname: ${JSON.stringify(slug)}\ndescription: ${JSON.stringify(e.properties.description)}\n---\n\n${e.properties.body as string}\n`,
      );
      const resources = e.properties.supportingFiles;
      if (Array.isArray(resources))
        for (const resource of resources) {
          if (
            resource &&
            typeof resource === 'object' &&
            !Array.isArray(resource) &&
            typeof resource.path === 'string' &&
            typeof resource.content === 'string'
          )
            add(`.agents/skills/${slug}/${resource.path}`, resource.content);
        }
    }
  }
  const report = `# Specification validation report\n\nProfile: implementation-ready@1.0.0\nRevision: ${project.revision}\nDesign hash: ${designHash(project)}\nExport mode: ${mode}\n\nThese are deterministic specification checks and attributed design reviews. They do not establish runtime correctness. Live AI integration is deferred.\n\n| Check | Status | Disposition | Mandatory | Rationale |\n|---|---|---|---|---|\n${exportValidation.findings.map((f) => `| ${f.rule} | ${f.status}${f.stale ? ' (stale)' : ''} | ${f.disposition} | ${f.mandatory ? 'yes' : 'no'} | ${f.message.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`).join('\n')}\n\n## Design reviews\n\n${sanitized.reviews.map((r) => `- ${r.topic}: ${r.actor}; ${r.rationale}; covers ${r.designHash}; ${r.at}`).join('\n') || 'Required human reviews have not been recorded.'}\n`;
  add('VALIDATION-REPORT.md', report);
  add('TRACEABILITY.json', pretty(trace));
  files.sort((a, b) => a.path.localeCompare(b.path));
  add(
    'EXPORT-MANIFEST.json',
    pretty({
      format: 'lattice-export@1',
      modelRevision: project.revision,
      modelHash: digest(project),
      designHash: designHash(project),
      profile,
      readinessProfile: 'implementation-ready@1.0.0',
      mode,
      generatedAt,
      definitions: Object.entries({
        ...project.types,
        ...project.relationTypes,
        ...project.assemblies,
      })
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([reference, d]) => ({ reference, hash: digest(d) })),
      files: files.map(({ path, hash }) => ({ path, hash })),
      manifestSelfHash: 'excluded to avoid recursive hashing',
      artifactDependencies: bindings.map((b) => ({
        resource: b.resource,
        ownership: b.ownership,
      })),
      findings: validation.findings.map((f) => ({
        id: f.id,
        status: f.status,
        mandatory: f.mandatory,
        stale: f.stale,
      })),
      exclusions,
      limitations: [
        'Specification checks do not verify runtime behavior.',
        'Workspace root mappings and binding baseline contents are excluded.',
        'Resources are referenced unless explicitly supplied as supporting files.',
        'Live AI provider integration is deferred.',
      ],
    }),
  );
  return {
    id: digest([project.revision, profile, mode, generatedAt, files.map((f) => f.hash)]),
    revision: project.revision,
    designHash: designHash(project),
    profile,
    mode,
    generatedAt,
    files,
    validation: exportValidation,
    exclusions,
  };
}
export function exportProperty(value: JsonValue): string {
  return md(value);
}
