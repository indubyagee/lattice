import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkReleaseMetadata, checkSource } from './check-release.mjs';

const root = process.cwd();
const privateTerms = (process.env.LATTICE_PRIVATE_TERMS ?? '').split('\n').filter(Boolean);
const source = checkSource(root, privateTerms);
const findings = [...source.findings, ...checkReleaseMetadata(root)];
if (findings.length) throw new Error(`Source release blocked:\n${findings.join('\n')}`);
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
const output = path.join(root, 'dist', `lattice-${version}-source.tar.gz`);
const staging = mkdtempSync(path.join(os.tmpdir(), 'lattice-public-source-'));
try {
  for (const file of source.files) {
    const target = path.join(staging, 'lattice', file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, file), target);
  }
  mkdirSync(path.dirname(output), { recursive: true });
  execFileSync('tar', ['-czf', output, '-C', staging, 'lattice'], { stdio: 'inherit' });
  const entries = execFileSync('tar', ['-tzf', output], { encoding: 'utf8' });
  const actual = entries
    .split(/\r?\n/)
    .filter((file) => file && !file.endsWith('/'))
    .sort();
  const expected = source.files.map((file) => `lattice/${file}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Archive file list differs from reviewed source');
  console.log(`Created ${output} (${source.files.length} reviewed files, no Git history).`);
} finally {
  const resolved = realpathSync(staging);
  if (
    path.dirname(resolved) !== realpathSync(os.tmpdir()) ||
    !path.basename(resolved).startsWith('lattice-public-source-')
  ) {
    throw new Error('Refusing to remove an unexpected staging directory');
  }
  rmSync(resolved, { recursive: true });
}
