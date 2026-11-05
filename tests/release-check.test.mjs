import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkHistory,
  checkSource,
  inspectContent,
  isPublicPath,
} from '../scripts/check-release.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function repository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lattice-release-test-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(path.join(root, 'README.md'), '# Synthetic example\n');
  writeFileSync(path.join(root, '.gitignore'), 'AGENTS.md\npublic/*.local\n');
  return root;
}
function commit(root) {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test fixture',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'Synthetic fixture',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test fixture',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test fixture',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
      },
    },
  );
}

describe('publication boundaries', () => {
  it('allows only the supplied theme icon names and supported sizes in public assets', () => {
    for (const mode of ['light', 'dark']) {
      expect(isPublicPath(`public/icons/icon-on-${mode}.svg`)).toBe(true);
      for (const size of [256, 512])
        expect(isPublicPath(`public/icons/icon-on-${mode}-${size}.png`)).toBe(true);
    }
    for (const name of ['icon-on-dark-128.png', 'icon-on-light.local.svg', 'source.ai'])
      expect(isPublicPath(`public/icons/${name}`)).toBe(false);
  });
  it('detects already tracked private instructions even after they are ignored', () => {
    const root = repository();
    writeFileSync(path.join(root, 'AGENTS.md'), 'Local instructions');
    execFileSync('git', ['add', '-f', 'AGENTS.md'], { cwd: root });
    expect(checkSource(root).findings).toContain('AGENTS.md: excluded publication path');
    execFileSync('git', ['rm', '--cached', 'AGENTS.md'], { cwd: root });
    expect(checkSource(root).findings).toEqual([]);
  });
  it('rejects ignored files that Vite would otherwise copy into the application', () => {
    const root = repository();
    mkdirSync(path.join(root, 'public'));
    writeFileSync(path.join(root, 'public', 'private.local'), 'Private asset');
    expect(checkSource(root).findings).toContain(
      'public/private.local: unexpected file in copied public assets',
    );
  });
  it('reports categories without echoing credential values', () => {
    const token = ['sk', 'proj', 'x'.repeat(32)].join('-');
    expect(inspectContent(`Token ${token}`)).toEqual(['API credential']);
    expect(inspectContent('This is a confidential fixture', ['confidential fixture'])).toEqual([
      'private content',
    ]);
  });
  it('checks an extracted source archive without requiring Git metadata', () => {
    const root = repository();
    rmSync(path.join(root, '.git'), { recursive: true });
    expect(checkSource(root).files).toEqual(['.gitignore', 'README.md']);
    expect(checkSource(root).findings).toEqual([]);
  });
  it('checks old commits after a private file has been removed from the current tree', () => {
    const root = repository();
    commit(root);
    expect(checkHistory(root).findings).toEqual([]);
    mkdirSync(path.join(root, 'tasks'));
    writeFileSync(path.join(root, 'tasks', 'private.md'), 'Private checklist');
    commit(root);
    rmSync(path.join(root, 'tasks'), { recursive: true });
    commit(root);
    expect(checkSource(root).findings).toEqual([]);
    expect(
      checkHistory(root).findings.some((finding) => finding.includes('tasks/private.md')),
    ).toBe(true);
  });
});
