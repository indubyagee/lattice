import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performanceProject } from '../fixtures/performance';
import AxeBuilder from '@axe-core/playwright';

test.describe.configure({ mode: 'serial' });
test.use({ trace: process.env.LATTICE_TRACE ? 'retain-on-failure' : 'off' });

let application: ElectronApplication, page: Page, local: string;
const errors: string[] = [];
const hostMetrics: string[] = [];
test.beforeAll(async () => {
  local = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-ui-'));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  env.LATTICE_TEST_HOME = path.join(local, 'settings');
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env,
    timeout: 30000,
  });
  application.process().stdout?.on('data', (chunk) => {
    const value = String(chunk);
    if (value.includes('LATTICE_PROFILE')) hostMetrics.push(value);
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await expect(page.getByRole('heading', { name: 'Give your system a shape.' })).toBeVisible();
});
test.afterAll(async () => {
  if (page && !page.isClosed()) {
    const evidence = process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-evidence');
    await fs.mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'lattice-desktop.png') });
    if (hostMetrics.length)
      await fs.writeFile(path.join(evidence, 'host-timings.log'), hostMetrics.join(''));
  }
  await application?.close();
});
test('actual Electron boot, keyboard insertion and shared identity', async () => {
  await expect(page).toHaveTitle('Lattice');
  await expect(page.locator('.toolbox-footer button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open development example' })).toBeVisible();
  expect(page.url()).toBe('app://lattice/');
  await page.getByRole('button', { name: 'Add a system', exact: true }).click();
  await expect(page.getByLabel('Component name')).toHaveValue('My system');
  await page.getByLabel('Component name').fill('Shared system');
  await page.getByLabel('Component name').press('Enter');
  await expect(page.locator('.component-node strong')).toContainText(['Shared system']);
  await page.getByRole('button', { name: '02 Behavior' }).click();
  await expect(page.locator('.component-node strong')).toContainText(['Shared system']);
  await page.getByRole('button', { name: '03 Information' }).click();
  await expect(page.locator('.component-node strong')).toContainText(['Shared system']);
  await page.getByRole('button', { name: '04 Validation' }).click();
  await expect(page.locator('.component-node strong')).toContainText(['Shared system']);
  await page.getByLabel('Insert a component').fill('capability');
  await page.getByRole('button', { name: 'Insert Capability', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Component name')).toHaveValue('Capability');
});
test('simulated proposals require acceptance and preserve intervening revisions', async () => {
  await page.getByRole('button', { name: 'AI proposals', exact: true }).click();
  await expect(page.getByText('Simulated provider', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview simulated proposal' }).click();
  await expect(page.getByRole('heading', { name: 'Review proposed changes' })).toBeVisible();
  await page.getByLabel('Component name').fill('Newer user edit');
  await page.getByLabel('Component name').press('Enter');
  await page.getByRole('button', { name: 'Accept selected commands' }).click();
  await expect(page.getByRole('alert')).toContainText('Stale proposal');
  await expect(page.getByLabel('Component name')).toHaveValue('Newer user edit');
  await page.getByRole('button', { name: 'Preview simulated proposal' }).click();
  await page.getByRole('button', { name: 'Accept selected commands' }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(/Proposed description/);
});
test('save/reopen and bundled Monaco export preview', async () => {
  const projectDirectory = path.join(local, 'project');
  await fs.mkdir(projectDirectory);
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, projectDirectory);
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await fs.readFile(path.join(projectDirectory, 'project.json'), 'utf8'))
          .name;
      } catch {
        return null;
      }
    })
    .toBe('Untitled system');
  await page.getByRole('button', { name: 'Export package ↗' }).click();
  await page.getByRole('button', { name: 'Prepare preview' }).click();
  await expect(page.getByRole('button', { name: /SYSTEM-SPECIFICATION.md/ })).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  const destination = path.join(local, 'export');
  await fs.mkdir(destination);
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, destination);
  await page.getByRole('button', { name: 'Choose destination and compare…' }).click();
  await page.getByRole('button', { name: 'Write reviewed package' }).click();
  await expect(page.getByRole('dialog', { name: 'Export implementation package' })).toHaveCount(0);
  expect(
    JSON.parse(await fs.readFile(path.join(destination, 'EXPORT-MANIFEST.json'), 'utf8')).mode,
  ).toBe('draft');
  await page.getByRole('button', { name: 'Export package ↗' }).click();
  await page.getByLabel('Close export').click();
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, projectDirectory);
  await page.getByRole('button', { name: 'Open…', exact: true }).click();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  const snap = await page.evaluate(() => window.lattice.snapshot());
  expect(Object.values(snap.project.entities).some((e) => e.name === 'Newer user edit')).toBe(true);
  const evidence = process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-evidence');
  await fs.mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'lattice-desktop.png') });
  expect(errors).toEqual([]);
});
test('associated file editing, explicit initial review and conflict protection', async () => {
  const snapshot = await page.evaluate(() => window.lattice.snapshot());
  const dir = snapshot.directory!;
  await fs.writeFile(
    path.join(dir, 'review.md'),
    '# Independent prose\n<!-- lattice:begin component-name -->\nReviewer from file\n<!-- lattice:end component-name -->\nKeep this paragraph.\n',
  );
  const entity = Object.values(snapshot.project.entities).find(
    (e) => e.name === 'Newer user edit',
  )!;
  await page.getByLabel('Search all components').fill(entity.name);
  await page.locator('.search-results button').first().click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.getByLabel('Refresh resources').click();
  await page.getByRole('button', { name: '· review.md', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Associate…' })).toBeVisible();
  await page.getByRole('button', { name: 'Associate…' }).click();
  await page.getByLabel('Content ownership').selectOption('managed');
  await page.getByRole('button', { name: 'Create association' }).click();
  await page.getByRole('button', { name: 'Compare / reconcile' }).click();
  await expect(page.getByText('Initial association review', { exact: true })).toBeVisible();
  await page.getByLabel('Mapping disposition').selectOption('file');
  await page.getByRole('button', { name: 'Accept reviewed dispositions' }).click();
  await expect(page.getByLabel('Component name')).toHaveValue('Reviewer from file');
  expect(await fs.readFile(path.join(dir, 'review.md'), 'utf8')).toContain('Keep this paragraph.');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.locator('.files-panel .monaco-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nEdited through Monaco.');
  await expect(page.locator('.files-panel .view-lines')).toContainText('Edited through Monaco.');
  await expect(page.getByText('Unsaved buffer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Findings/ }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByText('Unsaved buffer', { exact: true })).toBeVisible();
  await page.locator('.files-panel .monaco-editor').click();
  await page.keyboard.press('Control+s');
  await expect
    .poll(() => fs.readFile(path.join(dir, 'review.md'), 'utf8'))
    .toContain('Edited through Monaco.');
  await page.getByRole('button', { name: 'AI proposals', exact: true }).click();
  await page.getByLabel('Proposal file scope').selectOption({ label: 'review.md' });
  await page.getByRole('button', { name: 'Preview simulated proposal' }).click();
  await expect(page.getByRole('button', { name: 'Save reviewed file patch' })).toBeVisible();
  await page.getByRole('button', { name: 'Save reviewed file patch' }).click();
  await expect
    .poll(() => fs.readFile(path.join(dir, 'review.md'), 'utf8'))
    .toContain('Simulated suggestion');
  const read = await page.evaluate(() =>
    window.lattice.readResource({ rootId: 'project', path: 'review.md' }),
  );
  await fs.writeFile(path.join(dir, 'review.md'), 'Newer independent disk text');
  const result = await page.evaluate(async (r) => {
    try {
      await window.lattice.saveResource(r.resource, 'stale overwrite', r.hash);
      return 'wrong';
    } catch {
      return 'conflict';
    }
  }, read);
  expect(result).toBe('conflict');
  expect(await fs.readFile(path.join(dir, 'review.md'), 'utf8')).toBe(
    'Newer independent disk text',
  );
});
test('keyboard authoring and accessibility semantics', async () => {
  await page.getByRole('button', { name: '01 Architecture' }).click();
  await page.getByRole('button', { name: /^Findings/ }).click();
  await page.getByLabel('Insert a component').fill('goal');
  await page.getByRole('button', { name: 'Insert Goal', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Component name')).toHaveValue('Goal');
  await page.getByRole('button', { name: 'Connect…', exact: true }).click();
  await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Goal' });
  await page.getByLabel('Target', { exact: true }).selectOption({ label: 'Shared system' });
  await page.getByRole('button', { name: 'Create relationship' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Connect entities' })).toHaveCount(0);
  // Electron cannot create an extra browser page. The app contains no cross-origin frames.
  const accessibility = await new AxeBuilder({ page }).setLegacyMode(true).analyze();
  const evidence = process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-evidence');
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, 'accessibility.json'),
    JSON.stringify(accessibility.violations, null, 2),
  );
  expect(accessibility.violations.map((v) => ({ id: v.id, description: v.description }))).toEqual(
    [],
  );
});
test('declarative library, assembly insertion, migration preview and relationship editing', async () => {
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Register version', exact: true }).click();
  await expect
    .poll(async () =>
      Object.keys((await page.evaluate(() => window.lattice.snapshot())).project.types),
    )
    .toContain('local.custom-capability@1.0.0');
  await page.getByRole('button', { name: 'Save selection as assembly' }).click();
  await page.getByLabel('Pinned definition').selectOption({ label: 'Review assembly · 1.0.0' });
  await page.getByRole('button', { name: 'Insert new instance' }).click();
  await expect
    .poll(
      async () =>
        Object.keys((await page.evaluate(() => window.lattice.snapshot())).project.instances)
          .length,
    )
    .toBe(1);
  await page.getByLabel('New pinned type').selectOption('local.custom-capability@1.0.0');
  await page.getByRole('button', { name: 'Preview migration' }).click();
  await page.getByRole('button', { name: 'Accept reviewed migration' }).click();
  await expect(page.locator('.type-reference')).toContainText('local.custom-capability@1.0.0');
  await page
    .getByRole('button', { name: /^Inspect relationship/ })
    .first()
    .click();
  await expect(page.getByRole('complementary', { name: 'Relationship inspector' })).toBeVisible();
  await page
    .getByLabel('Relationship properties')
    .fill('{"rationale":"Reviewed from the relationship inspector"}');
  await page.getByRole('button', { name: 'Apply relationship properties' }).click();
  await expect
    .poll(async () =>
      Object.values(
        (await page.evaluate(() => window.lattice.snapshot())).project.relationships,
      ).some((r) => r.properties.rationale === 'Reviewed from the relationship inspector'),
    )
    .toBe(true);
  await page.getByRole('button', { name: /^Findings/ }).click();
});
test('desktop boundary rejects malformed commands and prevents renderer Node access', async () => {
  const result = await page.evaluate(async () => {
    const before = await window.lattice.snapshot();
    let rejected = false;
    try {
      await window.lattice.execute({
        baseRevision: before.project.revision,
        reason: 'Invalid test',
        operations: [{ kind: 'execute-code' }],
      } as unknown as Parameters<typeof window.lattice.execute>[0]);
    } catch {
      rejected = true;
    }
    return {
      rejected,
      unchanged: (await window.lattice.snapshot()).project.revision === before.project.revision,
      node: typeof (window as unknown as { require?: unknown }).require,
    };
  });
  expect(result).toEqual({ rejected: true, unchanged: true, node: 'undefined' });
});
test('500/1,000 fixture visible-paint edit and cross-view selection performance', async () => {
  test.setTimeout(120000);
  const directory = path.join(local, 'performance');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify(performanceProject()));
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, directory);
  await page.getByRole('button', { name: 'Open…', exact: true }).click();
  await expect(page.locator('.project-title')).toContainText('500-entity performance fixture');
  await page.getByLabel('Search all components').fill('Component 001');
  await page.locator('.search-results button').first().click();
  await expect(page.getByLabel('Component name')).toHaveValue('Component 001');
  await page.getByRole('button', { name: 'Focus selection', exact: true }).click();
  const editSamples: number[] = [];
  const profiler =
    process.env.LATTICE_PROFILE === '1' ? await page.context().newCDPSession(page) : null;
  if (profiler) {
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.start');
  }
  for (let i = 0; i < 35; i++) {
    const name = `Measured component ${i}`;
    await page.getByLabel('Component name').fill(name);
    const elapsed = await page.evaluate(async (name) => {
      const start = performance.now();
      (document.querySelector('[aria-label="Component name"]') as HTMLInputElement).blur();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error('Graph did not reflect edit'));
        }, 10000);
        const check = () => {
          if (
            [...document.querySelectorAll('.component-node strong')].some(
              (e) => e.textContent === name,
            )
          ) {
            observer.disconnect();
            clearTimeout(timer);
            resolve();
          }
        };
        const observer = new MutationObserver(check);
        observer.observe(document.querySelector('[data-testid="canvas"]')!, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        check();
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return performance.now() - start;
    }, name);
    if (i >= 5) editSamples.push(elapsed);
  }
  const selectionSamples: number[] = [];
  for (let i = 0; i < 25; i++) {
    const label = ['02 Behavior', '03 Information', '04 Validation', '01 Architecture'][i % 4]!;
    const elapsed = await page.evaluate(async (label) => {
      const name = (document.querySelector('[aria-label="Component name"]') as HTMLInputElement)
        .value;
      const start = performance.now();
      const button = [...document.querySelectorAll('.view-tabs button')].find(
        (e) => e.textContent?.replace(/\s+/g, ' ').trim() === label,
      ) as HTMLButtonElement;
      button.click();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (
        ![...document.querySelectorAll('.react-flow__node.selected strong')].some(
          (e) => e.textContent === name,
        )
      )
        throw new Error('Selected entity did not remain visibly selected in the coordinated view');
      return performance.now() - start;
    }, label);
    if (i >= 5) selectionSamples.push(elapsed);
  }
  const p95 = (samples: number[]) =>
    [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;
  const result = {
    entities: 500,
    relationships: 1000,
    method:
      'Edit: inspector blur through graph text update and two animation frames. Cross-view selection: selected entity retained through view-tab click and two animation frames.',
    editP95Ms: p95(editSamples),
    selectionP95Ms: p95(selectionSamples),
    editSamples,
    selectionSamples,
    targetMs: 100,
    measuredAt: new Date().toISOString(),
    cpu: os.cpus()[0]?.model,
    os: os.release(),
  };
  const evidence = process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-evidence');
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, 'ui-performance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    await fs.writeFile(path.join(evidence, 'renderer-cpu-profile.json'), JSON.stringify(profile));
    await profiler.detach();
  }
  expect(result.editP95Ms).toBeLessThan(100);
  expect(result.selectionP95Ms).toBeLessThan(100);
});
