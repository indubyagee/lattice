import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Preserve the notices supplied by every installed production package, including bundled code. */
export function thirdPartyNotices(root = process.cwd()) {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const sections = [
    'Lattice third-party software notices',
    'Lattice is licensed under MIT; see LICENSE. Dependencies retain their own licenses.',
    'Electron and Chromium notices are in LICENSE.electron.txt and LICENSES.chromium.html.',
    'Dependency licensing and corresponding source information: see docs/third-party.md in the Lattice source distribution.',
    readFileSync(path.join(root, 'docs/third-party.md'), 'utf8').trim(),
  ];
  let count = 0;
  for (const [location, entry] of Object.entries(lock.packages).sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    if (!location || entry.dev) continue;
    if (
      !/^node_modules\/(?:[^/]+\/)*[^/]+$/.test(location) ||
      location.includes('\\') ||
      location.split('/').includes('..')
    )
      throw new Error('Invalid dependency location in lockfile');
    const directory = path.join(root, location);
    if (!existsSync(directory) && entry.optional) continue;
    const installed = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (installed.version !== entry.version)
      throw new Error(`Dependency version differs from lockfile: ${location}`);
    const files = readdirSync(directory, { withFileTypes: true })
      .filter(
        (file) =>
          file.isFile() && /^(?:licen[cs]e|copying|notice|third[-_. ]?party)/i.test(file.name),
      )
      .map((file) => file.name)
      .sort();
    if (!files.some((file) => /^(?:licen[cs]e|copying)/i.test(file)))
      throw new Error(`Missing dependency license text: ${location}`);
    sections.push(
      '='.repeat(72),
      `${installed.name}@${installed.version} (${entry.license ?? 'see supplied license'})`,
      ...files.map(
        (file) => `${file}\n\n${readFileSync(path.join(directory, file), 'utf8').trim()}`,
      ),
    );
    count++;
  }
  return { content: sections.join('\n\n') + '\n', count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { content, count } = thirdPartyNotices();
  mkdirSync('out', { recursive: true });
  writeFileSync('out/THIRD_PARTY_NOTICES.txt', content);
  console.log(`Preserved license and notice texts for ${count} production dependencies.`);
}
