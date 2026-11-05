import { test, expect, _electron as electron } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

test('extracted unsigned ZIP runs with its own assets and dependencies', async () => {
  test.skip(
    !process.env.LATTICE_PACKAGED_EXE,
    'Set LATTICE_PACKAGED_EXE to an executable extracted from the ZIP',
  );
  const executable = path.resolve(process.env.LATTICE_PACKAGED_EXE!),
    local = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-packaged-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_PATH;
  env.LATTICE_TEST_HOME = path.join(local, 'settings');
  const app = await electron.launch({
    executablePath: executable,
    cwd: path.dirname(executable),
    args: [],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await expect(page).toHaveTitle('Lattice');
    const distribution = path.dirname(executable);
    expect(await fs.readFile(path.join(distribution, 'LICENSE'), 'utf8')).toBe(
      await fs.readFile(path.resolve('LICENSE'), 'utf8'),
    );
    const notices = await fs.readFile(path.join(distribution, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    expect(notices).toContain('elkjs@0.12.1');
    expect(notices).toContain('Eclipse Public License');
    expect(notices).toContain('THIRD-PARTY SOFTWARE NOTICES AND INFORMATION');
    for (const name of ['LICENSE.electron.txt', 'LICENSES.chromium.html'])
      expect((await fs.stat(path.join(distribution, name))).size).toBeGreaterThan(0);
    const desktopIcons = await app.evaluate(
      async ({ app }, files) => {
        const icon = await app.getFileIcon(files.executable, { size: 'large' }),
          stock = await app.getFileIcon(files.stock, { size: 'large' });
        return { empty: icon.isEmpty(), icon: icon.toDataURL(), stock: stock.toDataURL() };
      },
      { executable, stock: path.resolve('node_modules/electron/dist/electron.exe') },
    );
    expect(desktopIcons.empty).toBe(false);
    expect(desktopIcons.icon).not.toBe(desktopIcons.stock);
    const resources = await app.evaluate(() => process.resourcesPath);
    for (const mode of ['light', 'dark']) {
      for (const size of [256, 512]) {
        const name = `icon-on-${mode}-${size}.png`,
          source = await fs.readFile(path.resolve('public/icons', name)),
          bundled = await fs.readFile(path.join(resources, 'icons', name));
        expect(createHash('sha256').update(bundled).digest('hex')).toBe(
          createHash('sha256').update(source).digest('hex'),
        );
      }
    }
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'local font families available' }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Interface font family').selectOption('Arial');
    await page.getByRole('button', { name: 'Apply appearance' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Snapping', exact: true }).click();
    await page.getByLabel('Snap to grid', { exact: true }).check();
    await page.getByLabel('Snap to objects', { exact: true }).check();
    await page.getByLabel('Grid size (canvas units)', { exact: true }).fill('32');
    await page.getByRole('button', { name: 'Apply appearance' }).click();
    expect(await page.evaluate(() => window.lattice.getPreferences())).toMatchObject({
      snapToGrid: true,
      snapToObjects: true,
      gridSize: 32,
    });
    await page.keyboard.press('F1');
    await expect(page.getByRole('dialog', { name: 'Lattice user guide' })).toBeVisible();
    await page.getByLabel('Search the guide').fill('nested');
    await expect(
      page.getByRole('button', { name: 'Containers, grouping and nesting', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Close user guide').click();
    await page.getByRole('button', { name: 'Open development example' }).click();
    await expect(page.locator('.project-title')).toContainText('System Development & Evaluation');
    await expect
      .poll(async () => (await page.evaluate(() => window.lattice.snapshot())).validationPending)
      .toBe(false);
    const projectBeforeDisplayChanges = (await page.evaluate(() => window.lattice.snapshot()))
      .project;
    for (const name of [/^System connections:/, /^Graph tooltips:/]) {
      const toggle = page.getByRole('button', { name });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    }
    expect((await page.evaluate(() => window.lattice.snapshot())).project).toEqual(
      projectBeforeDisplayChanges,
    );
    await page.getByRole('button', { name: 'Add container', exact: true }).click();
    await expect(page.getByLabel('Container name')).toHaveValue('New container');
    await page.getByRole('button', { name: 'Collapse container', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Expand container', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove container; keep items', exact: true }).click();
    expect(
      (await page.evaluate(() => window.lattice.snapshot())).notices.some((n) =>
        n.includes('worker unavailable'),
      ),
    ).toBe(false);
    const directory = path.join(local, 'saved');
    await fs.mkdir(directory);
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, directory);
    await page.getByRole('button', { name: /^Save/ }).first().click();
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8')).name;
        } catch {
          return '';
        }
      })
      .toBe('System Development & Evaluation');
    const originalPositions = await page.evaluate(async () =>
      JSON.stringify(
        (await window.lattice.snapshot()).views.architecture.appearances.map((a) => [a.x, a.y]),
      ),
    );
    await page.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          JSON.stringify(
            (await window.lattice.snapshot()).views.architecture.appearances.map((a) => [a.x, a.y]),
          ),
        ),
      )
      .not.toBe(originalPositions);
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await page.getByRole('button', { name: 'Export package ↗' }).click();
    await page.getByRole('button', { name: 'Prepare preview' }).click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    const exportDirectory = path.join(local, 'export');
    await fs.mkdir(exportDirectory);
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, exportDirectory);
    await page.getByRole('button', { name: 'Choose destination and compare…' }).click();
    await page.getByRole('button', { name: 'Write reviewed package' }).click();
    await expect
      .poll(async () => {
        try {
          return JSON.parse(
            await fs.readFile(path.join(exportDirectory, 'EXPORT-MANIFEST.json'), 'utf8'),
          ).mode;
        } catch {
          return '';
        }
      })
      .toBe('draft');
    expect(errors).toEqual([]);
    await app.evaluate(({ BrowserWindow }) => {
      const probe = { seen: false, prevented: false };
      (globalThis as unknown as { latticeNavigationProbe: typeof probe }).latticeNavigationProbe =
        probe;
      BrowserWindow.getAllWindows()[0]!.webContents.once('will-navigate', (event) => {
        probe.seen = true;
        probe.prevented = event.defaultPrevented;
      });
    });
    await page.evaluate(() => {
      window.location.href = 'app://untrusted/index.html';
    });
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (
              globalThis as unknown as {
                latticeNavigationProbe: { seen: boolean; prevented: boolean };
              }
            ).latticeNavigationProbe,
        ),
      )
      .toEqual({ seen: true, prevented: true });
    const retained = await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      return {
        url: contents.getURL(),
        title: await contents.executeJavaScript('document.title'),
        heading: await contents.executeJavaScript('document.querySelector("h1")?.textContent'),
      };
    });
    expect(retained).toEqual({
      url: 'app://lattice/',
      title: 'Lattice',
      heading: 'Lattice',
    });
    const evidence = process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-evidence');
    await fs.mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'packaged-desktop.png') });
    await fs.writeFile(
      path.join(evidence, 'packaged-smoke.json'),
      JSON.stringify(
        {
          executable,
          cwd: path.dirname(executable),
          projectSaved: directory,
          exportDirectory,
          rendererErrors: errors,
          checkedAt: new Date().toISOString(),
          result: 'passed',
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
});
