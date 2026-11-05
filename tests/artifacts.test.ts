import { describe, it, expect } from 'vitest';
import { createEntity, createProject, typeRef } from '../src/domain/builtins';
import { execute } from '../src/domain/commands';
import {
  sections,
  extractValue,
  replaceValue,
  previewReconciliation,
  resolveReconciliation,
} from '../src/artifacts/reconciliation';
import { uid, type ArtifactBinding, type ArtifactMapping } from '../src/domain/types';
import { sha256 } from '../src/domain/hash';

function setup() {
  const p = createProject();
  const e = createEntity(typeRef('role'), 'Reviewer');
  e.properties.responsibilities = 'original';
  p.entities[e.id] = e;
  const mapping: ArtifactMapping = {
    id: uid(),
    entityId: e.id,
    pointer: '/properties/responsibilities',
    format: 'markdown',
    locator: 'review-role',
  };
  const binding: ArtifactBinding = {
    id: uid(),
    resource: { rootId: 'workspace', path: 'review.md' },
    entityIds: [e.id],
    ownership: 'managed',
    mappings: [mapping],
    state: 'unreviewed',
  };
  const content =
    '\uFEFF# Independent manuscript\r\nUntouched 🙂 text.\r\n<!-- lattice:begin review-role -->\r\noriginal\r\n<!-- lattice:end review-role -->\r\nIndependent ending.\r\n';
  p.bindings[binding.id] = binding;
  return { p, e, mapping, binding, content };
}
describe('ownership and three-way reconciliation', () => {
  it('supports declared whole-text generation and JSON array pointers', () => {
    const { mapping } = setup();
    const text = { ...mapping, format: 'text' as const, locator: '' };
    expect(extractValue('whole body', text)).toBe('whole body');
    expect(replaceValue('old body', text, 'new body')).toBe('new body');
    const array = { ...mapping, format: 'json' as const, locator: '/roles/0/name' };
    expect(extractValue(replaceValue('{"roles":[{"name":"old"}]}', array, 'new'), array)).toBe(
      'new',
    );
  });
  it('preserves BOM, CRLF, and all bytes outside owned Markdown sections', () => {
    const { mapping, content } = setup();
    const [section] = sections(content);
    const changed = replaceValue(content, mapping, 'new\nresponsibility');
    expect(changed.slice(0, section!.bodyStart)).toBe(content.slice(0, section!.bodyStart));
    expect(changed.slice(changed.indexOf('<!-- lattice:end'))).toBe(
      content.slice(content.indexOf('<!-- lattice:end')),
    );
    expect(changed).toContain('\r\nnew\r\nresponsibility\r\n');
    expect(changed.startsWith('\uFEFF')).toBe(true);
  });
  it.each([
    '<!-- lattice:begin a -->x',
    '<!-- lattice:end a -->',
    '<!-- lattice:begin a --><!-- lattice:begin b --><!-- lattice:end b --><!-- lattice:end a -->',
    '<!-- lattice:begin a -->x<!-- lattice:end a --><!-- lattice:begin a -->y<!-- lattice:end a -->',
  ])('rejects malformed markers: %s', (content) => expect(() => sections(content)).toThrow());
  it('requires an initial review and then classifies model-only, file-only and conflict', () => {
    const { p, e, binding, content } = setup();
    let preview = previewReconciliation(p, binding, content);
    expect(preview.initial).toBe(true);
    expect(preview.changes[0]!.classification).toBe('initial');
    const accepted = resolveReconciliation(p, binding, preview, {
      [binding.mappings[0]!.id]: { choice: 'model' },
    });
    const next = execute(p, {
      baseRevision: 0,
      reason: 'accept initial baseline',
      operations: accepted.operations,
    }).project;
    const b = next.bindings[binding.id]!;
    expect(b.state).toBe('accepted');
    expect(b.baseline!.resourceHash).toBe(sha256(content));
    next.entities[e.id]!.properties.responsibilities = 'model edit';
    preview = previewReconciliation(next, b, content);
    expect(preview.changes[0]!.classification).toBe('model-only');
    next.entities[e.id]!.properties.responsibilities = 'original';
    preview = previewReconciliation(next, b, content.replace('original', 'file edit'));
    expect(preview.changes[0]!.classification).toBe('file-only');
    next.entities[e.id]!.properties.responsibilities = 'model edit';
    preview = previewReconciliation(next, b, content.replace('original', 'file edit'));
    expect(preview.changes[0]!.classification).toBe('conflict');
  });
  it('imports mapped file values without overwriting independent prose', () => {
    const { p, binding, content } = setup();
    const changed = content
      .replace('original', 'external responsibility')
      .replace('Independent ending.', 'Revised independent ending.');
    const preview = previewReconciliation(p, binding, changed);
    const resolved = resolveReconciliation(p, binding, preview, {
      [binding.mappings[0]!.id]: { choice: 'file' },
    });
    expect(resolved.content).toBe(changed);
    const next = execute(p, {
      baseRevision: 0,
      reason: 'import mapped value',
      operations: resolved.operations,
    }).project;
    expect(next.entities[binding.entityIds[0]!]!.properties.responsibilities).toBe(
      'external responsibility',
    );
  });
  it('keeps deferred mappings pending and rejects stale comparisons', () => {
    const { p, binding, content } = setup();
    const preview = previewReconciliation(p, binding, content);
    expect(resolveReconciliation(p, binding, preview, {}).pending).toBe(true);
    p.revision++;
    expect(() => resolveReconciliation(p, binding, preview, {})).toThrow('stale');
  });
  it('updates strict JSON pointers without changing unrelated values or comments silently', () => {
    const { mapping } = setup();
    const jsonMapping = { ...mapping, format: 'json' as const, locator: '/role/name' };
    const text = '{\r\n  "role": { "name": "old" },\r\n  "independent": [1, 2, 3]\r\n}\r\n';
    const result = replaceValue(text, jsonMapping, 'new');
    expect(extractValue(result, jsonMapping)).toBe('new');
    expect(result).toContain('"independent": [1, 2, 3]');
    expect(() => extractValue('{/* comment */"role":{}}', jsonMapping)).toThrow('strict JSON');
  });
});
