import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkReleaseMetadata } from '../scripts/check-release.mjs';
import { thirdPartyNotices } from '../scripts/third-party-notices.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('lattice-distribution-test-')
    )
      throw new Error('Unexpected test directory');
    rmSync(resolved, { recursive: true });
  }
});
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lattice-distribution-test-'));
  roots.push(root);
  const pkg = { name: 'synthetic-app', version: '0.1.0', private: true, license: 'MIT' };
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  writeFileSync(path.join(root, 'LICENSE'), readFileSync('LICENSE'));
  const lock = { name: pkg.name, version: pkg.version, packages: { '': pkg } };
  const saveLock = () => writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  saveLock();
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs/third-party.md'), 'Synthetic source information');
  return { root, lock, saveLock };
}
function dependency(root, location, version = '1.0.0') {
  const directory = path.join(root, location);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', version }));
  writeFileSync(path.join(directory, 'LICENSE'), 'Synthetic dependency copyright and license');
  writeFileSync(path.join(directory, 'ThirdPartyNotices.txt'), 'Synthetic embedded notice');
  return directory;
}

describe('distribution licensing', () => {
  it('rejects JSON values that cannot represent package metadata', () => {
    const { root } = fixture();
    writeFileSync(path.join(root, 'package.json'), 'null');
    writeFileSync(path.join(root, 'package-lock.json'), '[]');
    expect(checkReleaseMetadata(root)).toEqual([
      'package.json: missing or invalid release metadata',
      'package-lock.json: missing or invalid release metadata',
    ]);
  });
  it('rejects missing licenses and stale lockfile licensing', () => {
    const { root, lock, saveLock } = fixture();
    expect(checkReleaseMetadata(root)).toEqual([]);
    lock.packages[''] = { ...lock.packages[''], license: 'UNLICENSED' };
    saveLock();
    expect(checkReleaseMetadata(root)).toContain(
      'package-lock.json: root license differs from package.json',
    );
    rmSync(path.join(root, 'LICENSE'));
    expect(checkReleaseMetadata(root)).toContain('LICENSE: missing release license');
  });
  it('preserves nested production license and notice texts without development packages', () => {
    const { root, lock, saveLock } = fixture();
    const location = 'node_modules/editor/node_modules/sanitizer';
    lock.packages[location] = { version: '1.0.0', license: 'MIT' };
    lock.packages['node_modules/development-tool'] = { version: '1.0.0', dev: true };
    dependency(root, location);
    saveLock();
    const result = thirdPartyNotices(root);
    expect(result.count).toBe(1);
    expect(result.content).toContain('Synthetic dependency copyright and license');
    expect(result.content).toContain('Synthetic embedded notice');
    expect(result.content).toContain('Synthetic source information');
    expect(result.content).not.toContain('development-tool');
  });
  it('blocks a build when an installed license is absent or a dependency version drifts', () => {
    const { root, lock, saveLock } = fixture();
    const location = 'node_modules/library';
    lock.packages[location] = { version: '1.0.0', license: 'MIT' };
    const directory = dependency(root, location, '2.0.0');
    saveLock();
    expect(() => thirdPartyNotices(root)).toThrow('version differs');
    dependency(root, location);
    rmSync(path.join(directory, 'LICENSE'));
    expect(() => thirdPartyNotices(root)).toThrow('Missing dependency license');
  });
  it('rejects Windows traversal before reading a dependency outside node_modules', () => {
    const { root, lock, saveLock } = fixture();
    lock.packages['node_modules/..\\outside'] = { version: '1.0.0' };
    saveLock();
    expect(() => thirdPartyNotices(root)).toThrow('Invalid dependency location');
  });
});
