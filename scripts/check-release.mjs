import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootFiles = new Set([
  '.gitattributes',
  '.gitignore',
  '.node-version',
  '.npmrc',
  '.prettierignore',
  '.prettierrc.json',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'LICENSE.md',
  'README.md',
  'SECURITY.md',
  'electron.vite.config.ts',
  'eslint.config.js',
  'package.json',
  'package-lock.json',
  'playwright.config.ts',
  'tsconfig.json',
  'vitest.config.ts',
  'docs/contracts.md',
  'docs/media/lattice-desktop-dark-theme.png',
  'docs/releasing.md',
  'docs/third-party.md',
]);
const privatePath =
  /(?:^|\/)(?:AGENTS(?:\.override)?\.md|tasks|conversations|chats|sessions|\.agents|\.codex|\.codex-log|\.claude|\.cursor|\.git|\.aws|\.azure|\.ssh|\.lattice)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12|jks|keystore|jsonl|log|ai|psd|psb|indd|idml)$/i;
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['cloud credential', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  [
    'service token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/,
  ],
  ['API credential', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
  [
    'credential assignment',
    /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*['"][A-Za-z0-9+/_=-]{20,}['"]/i,
  ],
  ['machine path', /[a-z]:[\\/]+(?:users|repositories|obsidian|vscode)[\\/]+[^\s"'<>]+/i],
  ['home directory', /\/(?:home|Users)\/[A-Za-z0-9._-]+(?:\/[^\s"'<>]+)?/],
  ['registry credential', /^(?:\/\/[^\s]+:)?_auth(?:Token)?\s*=\s*\S+/m],
];

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding, maxBuffer: 64 * 1024 * 1024 });
}

export function isPublicPath(file) {
  if (privatePath.test(file) || file.split('/').includes('..') || path.isAbsolute(file))
    return false;
  return (
    rootFiles.has(file) ||
    /^(?:src|tests|scripts)\//.test(file) ||
    /^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/i.test(file) ||
    /^public\/icons\/icon-on-(?:light|dark)(?:\.svg|-(?:256|512)\.png)$/.test(file)
  );
}

export function inspectContent(bytes, privateTerms = []) {
  // PNGs can carry text metadata, so inspect binary data as well as source text.
  const content = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes;
  const findings = rules.filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
  if (privateTerms.some((term) => content.toLowerCase().includes(term.toLowerCase()))) {
    findings.push('private content');
  }
  return findings;
}

export function collectSourceFiles(root = process.cwd()) {
  if (!existsSync(path.join(root, '.git'))) {
    const candidates = [...rootFiles].filter((file) => existsSync(path.join(root, file)));
    for (const directory of ['src', 'tests', 'scripts', 'public', '.github']) {
      candidates.push(...walkFiles(root, directory));
    }
    return [...new Set(candidates)].sort();
  }
  return [
    ...new Set(
      git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean),
    ),
  ]
    .filter((file) => {
      try {
        lstatSync(path.join(root, file));
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    })
    .sort();
}

function walkFiles(root, relative) {
  const target = path.join(root, relative);
  if (!existsSync(target)) return [];
  if (!lstatSync(target).isDirectory()) return [relative];
  return readdirSync(target).flatMap((entry) => walkFiles(root, `${relative}/${entry}`));
}

export function checkSource(root = process.cwd(), privateTerms = []) {
  const files = collectSourceFiles(root);
  const findings = [];
  for (const file of files) {
    if (!isPublicPath(file)) {
      findings.push(`${file}: excluded publication path`);
      continue;
    }
    if (
      !lstatSync(path.join(root, file)).isFile() ||
      !realpathSync(path.join(root, file)).startsWith(realpathSync(root) + path.sep)
    ) {
      findings.push(`${file}: only regular files may be distributed`);
      continue;
    }
    for (const issue of inspectContent(readFileSync(path.join(root, file)), privateTerms)) {
      findings.push(`${file}: ${issue}`);
    }
  }
  // Vite copies publicDir independently of Git, including ignored files.
  const allAssets = walkFiles(root, 'public');
  for (const file of allAssets) {
    if (!isPublicPath(file)) findings.push(`${file}: unexpected file in copied public assets`);
  }
  return { files, findings: [...new Set(findings)] };
}

export function checkReleaseMetadata(root = process.cwd()) {
  const findings = [];
  const read = (file) => {
    try {
      const value = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Release metadata must be an object');
      return value;
    } catch {
      findings.push(`${file}: missing or invalid release metadata`);
      return null;
    }
  };
  const pkg = read('package.json');
  const lock = read('package-lock.json');
  if (pkg) {
    if (typeof pkg.name !== 'string' || !pkg.name.trim())
      findings.push('package.json: missing release name');
    if (pkg.license !== 'MIT') findings.push('package.json: release license must be MIT');
    if (pkg.private !== true)
      findings.push('package.json: keep the desktop application private from npm publication');
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? ''))
      findings.push('package.json: invalid release version');
  }
  if (pkg && lock) {
    if (lock.name !== pkg.name || lock.version !== pkg.version)
      findings.push('package-lock.json: release identity differs from package.json');
    for (const key of ['name', 'version', 'license'])
      if (lock.packages?.['']?.[key] !== pkg[key])
        findings.push(`package-lock.json: root ${key} differs from package.json`);
  }
  try {
    const license = readFileSync(path.join(root, 'LICENSE'), 'utf8');
    if (
      !license.startsWith('MIT License') ||
      !license.includes('Permission is hereby granted, free of charge') ||
      !license.includes('THE SOFTWARE IS PROVIDED "AS IS"')
    )
      findings.push('LICENSE: expected MIT license text');
  } catch {
    findings.push('LICENSE: missing release license');
  }
  return findings;
}

export function checkHistory(root = process.cwd(), privateTerms = []) {
  const findings = [];
  const seen = new Set();
  const commits = git(root, ['rev-list', '--all']).trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    const label = commit.slice(0, 8);
    const metadata = git(root, ['show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%B', commit]);
    for (const issue of inspectContent(metadata, privateTerms))
      findings.push(`${label}: ${issue} in commit metadata`);
    const emails = metadata
      .split('\n')
      .slice(0, 4)
      .filter((line) => line.includes('@'));
    if (
      emails.some(
        (email) =>
          !/@(?:users\.noreply\.github\.com|example\.(?:com|org|net|invalid))$/i.test(email),
      )
    ) {
      findings.push(`${label}: review private email in commit identity`);
    }
    for (const entry of git(root, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean)) {
      const [header, file] = entry.split('\t');
      const [mode, type, object] = header.split(' ');
      if (!isPublicPath(file)) {
        findings.push(`${label}:${file}: excluded publication path in history`);
        continue;
      }
      if (type !== 'blob' || mode === '120000') {
        findings.push(`${label}:${file}: non-regular history entry`);
        continue;
      }
      if (seen.has(object)) continue;
      seen.add(object);
      for (const issue of inspectContent(
        git(root, ['cat-file', 'blob', object], null),
        privateTerms,
      )) {
        findings.push(`${label}:${file}: ${issue} in history`);
      }
    }
  }
  return { commits: commits.length, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const privateTerms = (process.env.LATTICE_PRIVATE_TERMS ?? '').split('\n').filter(Boolean);
  const source = checkSource(process.cwd(), privateTerms);
  const history = process.argv.includes('--history')
    ? checkHistory(process.cwd(), privateTerms)
    : null;
  const findings = [...source.findings, ...checkReleaseMetadata(), ...(history?.findings ?? [])];
  if (findings.length) {
    console.error(
      `Release check failed (${findings.length} findings; matching values are withheld):`,
    );
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Release check passed: ${source.files.length} source files${history ? `, ${history.commits} reachable commits` : ''}.`,
    );
  }
}
