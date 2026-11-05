import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import type {
  ArtifactBinding,
  ArtifactMapping,
  JsonValue,
  Operation,
  Project,
} from '../domain/types';
import { canonical, pointerGet, sha256 } from '../domain/hash';
import { ensure } from '../domain/integrity';

export interface ManagedSection {
  id: string;
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}
/** Offsets are UTF-16 string indices; slicing preserves all unowned text, BOM and EOL. */
export function sections(content: string): ManagedSection[] {
  const expression = /<!--\s*lattice:(begin|end)\s+([\w.-]+)\s*-->/g;
  const result: ManagedSection[] = [];
  const ids = new Set<string>();
  let opened: { id: string; start: number; bodyStart: number } | undefined;
  for (const match of content.matchAll(expression)) {
    const mode = match[1]!,
      id = match[2]!,
      index = match.index!;
    if (mode === 'begin') {
      ensure(!opened, 'Overlapping or nested managed markers');
      ensure(!ids.has(id), `Duplicate managed marker: ${id}`);
      opened = { id, start: index, bodyStart: index + match[0].length };
      ids.add(id);
    } else {
      ensure(opened && opened.id === id, `Missing or mismatched begin marker: ${id}`);
      result.push({ ...opened, end: index + match[0].length, bodyEnd: index });
      opened = undefined;
    }
  }
  ensure(!opened, 'Missing managed end marker');
  return result;
}
export function parseJson(content: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(content.replace(/^\uFEFF/, ''), errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  ensure(errors.length === 0, 'Artifact is not strict JSON');
  return value;
}
export function extractValue(content: string, mapping: ArtifactMapping): JsonValue {
  if (mapping.format === 'text') return content;
  if (mapping.format === 'json') {
    const value = pointerGet(parseJson(content), mapping.locator);
    ensure(value !== undefined, `JSON mapping missing: ${mapping.locator}`);
    return value;
  }
  const section = sections(content).find((s) => s.id === mapping.locator);
  ensure(section, `Managed section missing: ${mapping.locator}`);
  return content
    .slice(section.bodyStart, section.bodyEnd)
    .replace(/^\r?\n/, '')
    .replace(/\r?\n$/, '');
}
export function replaceValue(content: string, mapping: ArtifactMapping, value: JsonValue): string {
  if (mapping.format === 'text') return typeof value === 'string' ? value : canonical(value);
  if (mapping.format === 'json') {
    parseJson(content);
    const decoded = mapping.locator
      .slice(1)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let current = parseJson(content);
    const path: (string | number)[] = decoded.map((segment) => {
      ensure(
        !['__proto__', 'constructor', 'prototype'].includes(segment),
        'Unsafe JSON mapping path',
      );
      const key = Array.isArray(current) ? Number(segment) : segment;
      if (Array.isArray(current))
        ensure(/^(0|[1-9][0-9]*)$/.test(segment), 'Invalid JSON array index');
      current =
        current && typeof current === 'object'
          ? (current as Record<string | number, unknown>)[key]
          : undefined;
      return key;
    });
    ensure(mapping.locator.startsWith('/'), 'JSON mapping requires a JSON Pointer');
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const text = content.slice(bom.length);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return (
      bom +
      applyEdits(
        text,
        modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol } }),
      )
    );
  }
  const section = sections(content).find((s) => s.id === mapping.locator);
  ensure(section, `Managed section missing: ${mapping.locator}`);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const body = typeof value === 'string' ? value : canonical(value);
  return (
    content.slice(0, section.bodyStart) +
    eol +
    body.replace(/\r?\n/g, eol) +
    eol +
    content.slice(section.bodyEnd)
  );
}
export type ChangeClass = 'unchanged' | 'model-only' | 'file-only' | 'conflict' | 'initial';
export interface MappingChange {
  mapping: ArtifactMapping;
  classification: ChangeClass;
  baseline: JsonValue | null;
  model: JsonValue;
  file: JsonValue;
}
export interface ReconciliationPreview {
  bindingId: string;
  revision: number;
  resourceHash: string;
  content: string;
  changes: MappingChange[];
  initial: boolean;
}
export function previewReconciliation(
  project: Project,
  binding: ArtifactBinding,
  content: string,
): ReconciliationPreview {
  const changes = binding.mappings.map((mapping) => {
    const model = pointerGet(project.entities[mapping.entityId], mapping.pointer);
    ensure(model !== undefined, 'Mapped model value is missing');
    const file = extractValue(content, mapping);
    const baseline = binding.baseline?.values[mapping.id];
    let classification: ChangeClass = 'initial';
    if (baseline !== undefined) {
      const modelChanged = canonical(model) !== canonical(baseline),
        fileChanged = canonical(file) !== canonical(baseline);
      classification =
        modelChanged && fileChanged
          ? canonical(model) === canonical(file)
            ? 'unchanged'
            : 'conflict'
          : modelChanged
            ? 'model-only'
            : fileChanged
              ? 'file-only'
              : 'unchanged';
    }
    return { mapping, classification, baseline: baseline ?? null, model, file };
  });
  return {
    bindingId: binding.id,
    revision: project.revision,
    resourceHash: sha256(content),
    content,
    changes,
    initial: !binding.baseline,
  };
}
export type MappingResolution = {
  choice: 'model' | 'file' | 'revised' | 'defer';
  value?: JsonValue;
};
export function resolveReconciliation(
  project: Project,
  binding: ArtifactBinding,
  preview: ReconciliationPreview,
  resolutions: Record<string, MappingResolution>,
): { content: string; operations: Operation[]; pending: boolean } {
  ensure(project.revision === preview.revision, 'Reconciliation is stale; compare again');
  let content = preview.content;
  const operations: Operation[] = [];
  const values: Record<string, JsonValue> = { ...(binding.baseline?.values ?? {}) };
  let pending = false;
  for (const change of preview.changes) {
    const resolution = resolutions[change.mapping.id] ?? {
      choice: change.classification === 'unchanged' ? 'model' : 'defer',
    };
    if (resolution.choice === 'defer') {
      pending = true;
      continue;
    }
    const value =
      resolution.choice === 'file'
        ? change.file
        : resolution.choice === 'revised'
          ? resolution.value
          : change.model;
    ensure(value !== undefined, 'A revised value is required');
    if (resolution.choice !== 'model')
      operations.push({
        kind: 'set-value',
        id: change.mapping.entityId,
        pointer: change.mapping.pointer,
        value,
      });
    if (resolution.choice !== 'file' && binding.ownership !== 'independent')
      content = replaceValue(content, change.mapping, value);
    if (binding.ownership === 'independent' && canonical(value) !== canonical(change.file)) {
      pending = true;
      continue;
    }
    values[change.mapping.id] = value;
  }
  const updated: ArtifactBinding = {
    ...structuredClone(binding),
    state: pending ? 'pending' : 'accepted',
    baseline: {
      modelRevision: project.revision + 1,
      resourceHash: sha256(content),
      mappingVersion: '1.0.0',
      content: canonical(values),
      values,
    },
  };
  operations.push({ kind: 'put-binding', binding: updated });
  return { content, operations, pending };
}
