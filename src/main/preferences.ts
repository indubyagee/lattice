import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { atomicText } from './files';
import { DEFAULT_PREFERENCES, parsePreferences, type UserPreferences } from '../shared/preferences';
let fonts: Promise<string[]> | null = null;
/** Enumerate installed families; never load a font or execute user-supplied command text. */
export function installedFonts(): Promise<string[]> {
  fonts ??= (async () => {
    const command =
      '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; $latticeFonts=[System.Drawing.Text.InstalledFontCollection]::new(); try { @($latticeFonts.Families.Name | Sort-Object -Unique) | ConvertTo-Json -Compress } finally { $latticeFonts.Dispose() }';
    const result = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
    );
    const values: unknown = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string'))
      throw new Error('Windows font enumeration failed');
    return [...new Set([...values, 'system-ui', 'monospace'])].sort((a, b) => a.localeCompare(b));
  })();
  return fonts;
}
export class PreferencesService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}
  async read(): Promise<UserPreferences> {
    try {
      return parsePreferences(
        JSON.parse(await fs.readFile(path.join(this.directory, 'appearance.json'), 'utf8')),
      );
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }
  async write(value: unknown): Promise<UserPreferences> {
    const p = parsePreferences(value);
    const next = this.queue.then(async () => {
      const old = await this.read();
      if (p.uiFont !== old.uiFont || p.editorFont !== old.editorFont) {
        const families = await installedFonts();
        if (!families.includes(p.uiFont) || !families.includes(p.editorFont))
          throw new Error('Choose a font installed on this computer');
      }
      await atomicText(
        path.join(this.directory, 'appearance.json'),
        JSON.stringify(p, null, 2) + '\n',
      );
      return p;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
