import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ResourceRef } from '../domain/types';
import type {
  BatchStatus,
  BatchWrite,
  GitMetadata,
  ResourceEntry,
  TextResource,
} from '../shared/contracts';

export class FileConflictError extends Error {
  override name = 'FileConflictError';
}
export const fileHash = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
export async function hashOnDisk(file: string): Promise<string | null> {
  try {
    return fileHash(await fs.readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function readUtf8(file: string): Promise<string> {
  const bytes = await fs.readFile(file);
  if (bytes.includes(0)) throw new Error('Binary content is not editable');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
/** Stage on the same volume; never delete a destination to force replacement. */
export async function atomicText(
  file: string,
  content: string,
  expectedHash?: string | null,
): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const staged = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await fs.open(staged, 'wx');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (expectedHash !== undefined && (await hashOnDisk(file)) !== expectedHash)
      throw new FileConflictError('Disk content changed; compare before saving');
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(staged, file);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
        if (expectedHash !== undefined && (await hashOnDisk(file)) !== expectedHash)
          throw new FileConflictError('Disk changed while replacement was waiting');
      }
    }
    const actual = await hashOnDisk(file);
    const expected = fileHash(content);
    if (actual !== expected) throw new Error('Written content failed hash verification');
    return expected;
  } catch (error) {
    // Keep a flushed staging file after a replacement failure for manual recovery.
    if (error instanceof FileConflictError) await fs.unlink(staged).catch(() => undefined);
    throw error;
  }
}
function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}
export class WorkspaceFiles {
  constructor(
    readonly roots: Map<string, string>,
    readonly journalDirectory: string,
    readonly writable: () => boolean = () => true,
  ) {}
  async resolve(resource: ResourceRef, allowMissing = false): Promise<string> {
    if (!resource || typeof resource.rootId !== 'string' || typeof resource.path !== 'string')
      throw new Error('Invalid resource reference');
    const root = this.roots.get(resource.rootId);
    if (!root) throw new Error(`Workspace root ${resource.rootId} is unresolved`);
    if (
      path.isAbsolute(resource.path) ||
      /^[a-z]:/i.test(resource.path) ||
      resource.path.includes(':') ||
      resource.path.includes('\0')
    )
      throw new Error('Resource paths must be relative');
    const canonicalRoot = await fs.realpath(root);
    const candidate = path.resolve(canonicalRoot, resource.path);
    if (!within(canonicalRoot, candidate))
      throw new Error('Resource is outside its workspace root');
    let existing = candidate;
    while (true) {
      try {
        const resolved = await fs.realpath(existing);
        if (!within(canonicalRoot, resolved))
          throw new Error('Symlink or junction escapes workspace root');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !allowMissing) throw error;
        const parent = path.dirname(existing);
        if (parent === existing) throw error;
        existing = parent;
      }
    }
    return candidate;
  }
  async list(rootId: string, relative = ''): Promise<ResourceEntry[]> {
    const directory = await this.resolve({ rootId, path: relative });
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const result: ResourceEntry[] = [];
    for (const entry of entries) {
      if (['node_modules', '.git', '.lattice'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      try {
        const safe = await this.resolve({ rootId, path: path.join(relative, entry.name) });
        const stat = await fs.stat(safe);
        result.push({
          name: entry.name,
          path: path.join(relative, entry.name).replace(/\\/g, '/'),
          directory: stat.isDirectory(),
          size: stat.size,
        });
      } catch {
        if (!entry.isSymbolicLink()) throw new Error(`Cannot inspect ${path.basename(file)}`);
      }
    }
    return result.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
    );
  }
  async read(resource: ResourceRef): Promise<TextResource> {
    const file = await this.resolve(resource),
      stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('Select a file');
    const bytes = await fs.readFile(file);
    let content: string | null = null,
      reason: string | undefined;
    try {
      if (stat.size > 5 * 1024 * 1024)
        throw new Error('Text files above 5 MiB are read-only in this experiment');
      if (bytes.includes(0)) throw new Error('Binary file; use Show in Explorer');
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (error) {
      reason = error instanceof Error ? error.message : 'Unsupported encoding';
    }
    const crlf = !!content?.includes('\r\n'),
      lf = !!content?.replace(/\r\n/g, '').includes('\n');
    const mixed = crlf && lf;
    if (mixed)
      reason =
        'Mixed newline conventions are read-only; normalize explicitly in an external editor';
    return {
      resource,
      content,
      hash: fileHash(bytes),
      size: stat.size,
      editable: content !== null && !mixed,
      eol: mixed ? 'mixed' : crlf ? 'CRLF' : 'LF',
      bom: bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191,
      ...(reason ? { reason } : {}),
    };
  }
  async write(resource: ResourceRef, content: string, expectedHash: string): Promise<TextResource> {
    if (!this.writable()) throw new Error('Project is read-only');
    const current = await this.read(resource);
    if (!current.editable) throw new Error(current.reason ?? 'Resource is read-only');
    const file = await this.resolve(resource);
    await atomicText(file, content, expectedHash);
    return this.read(resource);
  }
  async prepare(writes: BatchWrite[], reason: string): Promise<BatchStatus> {
    if (!this.writable()) throw new Error('Project is read-only');
    if (!writes.length) throw new Error('No files selected');
    const seen = new Set<string>();
    const files: BatchStatus['files'] = [];
    for (const write of writes) {
      const file = await this.resolve(write.resource, true);
      if (seen.has(file.toLowerCase())) throw new Error('Duplicate file in write batch');
      seen.add(file.toLowerCase());
      const hash = await hashOnDisk(file);
      if (hash !== write.expectedHash)
        throw new FileConflictError('File changed while preparing batch');
      const before = hash === null ? null : await readUtf8(file);
      files.push({ ...write, afterHash: fileHash(write.content), before, state: 'pending' });
    }
    const status: BatchStatus = { id: randomUUID(), state: 'prepared', files, reason };
    await this.record(status);
    return status;
  }
  async record(status: BatchStatus): Promise<void> {
    await atomicText(
      path.join(this.journalDirectory, `${status.id}.json`),
      JSON.stringify(status, null, 2),
    );
  }
  async statuses(): Promise<BatchStatus[]> {
    await fs.mkdir(this.journalDirectory, { recursive: true });
    const entries = await fs.readdir(this.journalDirectory);
    const result: BatchStatus[] = [];
    for (const name of entries.filter((n) => n.endsWith('.json'))) {
      const parsed: unknown = JSON.parse(
        await fs.readFile(path.join(this.journalDirectory, name), 'utf8'),
      );
      if (parsed && typeof parsed === 'object' && 'files' in parsed && 'id' in parsed)
        result.push(parsed as BatchStatus);
    }
    return result;
  }
  async run(
    status: BatchStatus,
    reverse = false,
    fault?: (index: number) => void,
  ): Promise<BatchStatus> {
    if (!this.writable()) throw new Error('Project is read-only');
    status = structuredClone(status);
    status.state = 'writing';
    await this.record(status);
    try {
      for (let index = 0; index < status.files.length; index++) {
        const item = status.files[index]!;
        const file = await this.resolve(item.resource, true);
        const hash = await hashOnDisk(file);
        if (reverse) {
          if (item.state === 'reversed') continue;
          if (item.state === 'pending' && hash === item.expectedHash) continue;
          if (hash !== item.afterHash)
            throw new FileConflictError('Newer disk content prevents reversal');
          if (item.before === null) await fs.unlink(file);
          else await atomicText(file, item.before, item.afterHash);
          item.state = 'reversed';
        } else {
          if (item.state === 'written') {
            if (hash !== item.afterHash)
              throw new FileConflictError('A completed batch file was changed later');
            continue;
          }
          if (hash === item.afterHash) {
            item.state = 'written';
          } else {
            if (hash !== item.expectedHash)
              throw new FileConflictError('Newer disk content prevents batch resume');
            await atomicText(file, item.content, item.expectedHash);
            item.state = 'written';
          }
        }
        await this.record(status);
        fault?.(index);
      }
      status.state = reverse ? 'reversed' : 'complete';
      await this.record(status);
      return status;
    } catch (error) {
      status.state = 'interrupted';
      await this.record(status);
      throw error;
    }
  }
  async renameCandidates(
    resource: ResourceRef,
    hash: string,
    maxFiles = 1500,
  ): Promise<ResourceRef[]> {
    const result: ResourceRef[] = [];
    let inspected = 0;
    const visit = async (relative: string) => {
      for (const entry of await this.list(resource.rootId, relative)) {
        if (inspected++ >= maxFiles) return;
        if (entry.directory) await visit(entry.path);
        else if (
          entry.path !== resource.path &&
          (await hashOnDisk(await this.resolve({ rootId: resource.rootId, path: entry.path }))) ===
            hash
        )
          result.push({ rootId: resource.rootId, path: entry.path });
      }
    };
    await visit('');
    return result;
  }
  async git(rootId: string): Promise<GitMetadata> {
    const root = this.roots.get(rootId);
    if (!root) return { available: false, message: 'Root is unresolved' };
    const run = async (args: string[]) =>
      (
        await promisify(execFile)(
          'git',
          ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args],
          {
            windowsHide: true,
            timeout: 5000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
          },
        )
      ).stdout.trim();
    try {
      const gitRoot = await run(['rev-parse', '--show-toplevel']);
      const status = await run(['status', '--porcelain=v2', '--branch']);
      const commit = await run(['rev-parse', 'HEAD']).catch(() => 'unborn');
      const branch = await run(['branch', '--show-current']).catch(() => 'detached');
      return { available: true, root: gitRoot, commit, branch, status };
    } catch {
      return { available: false, message: 'Git is unavailable or this root is not a repository' };
    }
  }
}
