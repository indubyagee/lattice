import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { worldPosition } from '../../src/projection/containers';
import type { ViewDefinition } from '../../src/domain/types';
test.describe.configure({ mode: 'serial' });
test.use({ trace: process.env.LATTICE_TRACE ? 'retain-on-failure' : 'off' });
let app: ElectronApplication, page: Page, local: string;
const errors: string[] = [];
const evidence =
  process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-presentation-evidence');
async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.LATTICE_TEST_HOME = path.join(local, 'settings');
  app = await electron.launch({ args: [path.resolve('out/main/index.js')], env });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('.app-header')).toBeVisible();
}
const snapshot = () => page.evaluate(() => window.lattice.snapshot());
async function rename(name: string) {
  await page.getByLabel('Component name').fill(name);
  await page.getByLabel('Component name').press('Enter');
  await expect(
    page.locator('.component-node strong').filter({ hasText: new RegExp(`^${name}$`) }),
  ).toBeVisible();
  await expect(page.getByLabel('Component name')).toBeEditable();
}
async function selectNode(name: string, shift = false) {
  await page
    .locator('.component-node strong')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .click({ modifiers: shift ? ['Shift'] : [] });
}
test.beforeAll(async () => {
  local = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-presentation-'));
  await fs.mkdir(evidence, { recursive: true });
  await launch();
});
test.afterAll(async () => {
  await app?.close();
});
test('component-specific tooltips, coordinated tab explanations and one-hop graph cues', async () => {
  await page.getByLabel('Insert a component').fill('system');
  const system = page.getByRole('button', { name: 'Insert System', exact: true });
  await system.hover();
  await expect(page.getByRole('tooltip')).toContainText('complete system');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await system.click();
    await expect(page.getByLabel('Component name')).toHaveValue('System');
    await rename(name);
  }
  const initial = await snapshot(),
    [a, b, c] = Object.values(initial.project.entities);
  await page.evaluate(
    async ({ a, b, c }) => {
      const p = (await window.lattice.snapshot()).project;
      const provenance = { actor: 'local-user', source: 'human', at: new Date().toISOString() };
      await window.lattice.execute({
        baseRevision: p.revision,
        reason: 'Presentation fixture',
        operations: [
          {
            kind: 'update-entity',
            id: a,
            properties: {
              ...p.entities[a]!.properties,
              description: 'Owns the intake interface and routing responsibility.',
            },
          },
          {
            kind: 'put-relationship',
            relationship: {
              id: crypto.randomUUID(),
              typeRef: 'lattice.reads@1.0.0',
              source: a,
              target: b,
              properties: { importance: 'high' },
              provenance,
            },
          },
          {
            kind: 'put-relationship',
            relationship: {
              id: crypto.randomUUID(),
              typeRef: 'lattice.depends-on@1.0.0',
              source: b,
              target: c,
              properties: {},
              provenance,
            },
          },
        ],
      });
    },
    { a: a!.id, b: b!.id, c: c!.id },
  );
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await page.getByRole('button', { name: /^System connections:/ }).click();
  await page.getByRole('button', { name: /^Graph tooltips:/ }).click();
  await selectNode('Alpha');
  await expect(page.locator('.component-node.is-neighbor strong')).toHaveText(['Beta']);
  await expect(page.locator('.react-flow__edge.is-adjacent')).toHaveCount(1);
  const edge = page.locator('.react-flow__edge.edge-information .react-flow__edge-path');
  await expect(edge).toHaveCSS('stroke-dasharray', '6px, 4px');
  await expect(edge).toHaveAttribute('marker-end', /arrowclosed/);
  await expect(edge).toHaveCSS('stroke-width', '4.2px');
  await page.locator('.component-node strong').filter({ hasText: 'Alpha' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Owns the intake interface');
  for (const name of [
    '01 Architecture',
    '02 Behavior',
    '03 Information',
    '04 Validation',
    'Findings',
    'Files',
    'AI proposals',
    'Review',
    'Library',
  ]) {
    const button = page.getByRole('button', {
      name: name === 'Findings' ? /^Findings/ : name,
      exact: name !== 'Findings',
    });
    await button.hover();
    const explanation = await button.getAttribute('data-help');
    expect(explanation?.length).toBeGreaterThan(50);
    await expect(page.getByRole('tooltip'), `Hover explanation for ${name}`).toHaveText(
      explanation!,
    );
  }
  await page.mouse.move(0, 0);
  await page.getByLabel('Component name').focus();
  await expect(page.getByRole('tooltip')).toContainText('Rename the shared entity');
  await expect(page.getByLabel('Component name')).toHaveAttribute(
    'aria-describedby',
    'lattice-context-tooltip',
  );
  await page.keyboard.press('Escape');
  await page.getByLabel('Description', { exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('Value state: declared');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(evidence, 'light-connections.png') });
});
test('light/dark and installed fonts apply to controls and Monaco, with accessible settings', async () => {
  const revision = (await snapshot()).project.revision;
  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: 'User settings' });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'local font families available' }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByLabel('Interface font family').selectOption('monospace');
  await page.getByRole('button', { name: 'Apply appearance' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.locator('body').evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(
    /^monospace,/,
  );
  await page.keyboard.press('Control+,');
  await expect(dialog).toBeVisible();
  await page.getByLabel('Interface font family').selectOption('Arial');
  await page.getByLabel('Interface font size').selectOption('14');
  await page.getByLabel('Editor font family').selectOption('Courier New');
  await page.getByLabel('Editor font size').selectOption('16');
  await dialog.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Apply appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('body').evaluate((e) => getComputedStyle(e).fontFamily)).toContain(
    'Arial',
  );
  expect((await snapshot()).project.revision).toBe(revision);
  await page.getByRole('button', { name: 'Export package ↗' }).click();
  await page.getByRole('button', { name: 'Prepare preview' }).click();
  await expect(page.locator('.monaco-editor.vs-dark').first()).toBeVisible();
  await expect(page.locator('.monaco-editor .view-lines').first()).toHaveCSS('font-size', '16px');
  expect(
    await page
      .locator('.monaco-editor .view-lines')
      .first()
      .evaluate((e) => getComputedStyle(e).fontFamily),
  ).toContain('Courier New');
  await page.getByLabel('Close export').click();
  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');
    const report = await new AxeBuilder({ page }).setLegacyMode(true).analyze();
    await page.screenshot({ path: path.join(evidence, `${theme}-workspace.png`) });
    await fs.writeFile(
      path.join(evidence, `accessibility-${theme}.json`),
      JSON.stringify(report.violations, null, 2),
    );
    expect(
      report.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  }
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.keyboard.press('Control+,');
  await page.getByLabel('Interface font size').selectOption('12');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await page.evaluate(() => window.lattice.getPreferences())).uiFontSize).toBe(14);
});
test('containers group, nest, resize, arrange, collapse and remove without semantic changes', async () => {
  const before = await snapshot();
  await selectNode('Alpha');
  await selectNode('Beta', true);
  await page.getByRole('button', { name: 'Group selection', exact: true }).click();
  await expect(page.getByLabel('Container name')).toHaveValue('Grouped selection');
  await page.getByLabel('Container name').fill('Intake group');
  await page.getByLabel('Container name').press('Enter');
  await expect
    .poll(async () => (await snapshot()).views.architecture.containers?.[0]?.name)
    .toBe('Intake group');
  const grouped = (await snapshot()).views.architecture,
    group = grouped.containers![0]!;
  expect(grouped.appearances.filter((a) => a.parentAppearanceId === group.id)).toHaveLength(2);
  const frame = page.locator(`.react-flow__node[data-id="frame:${group.id}"]`);
  await frame.focus();
  await frame.press('ArrowRight');
  await expect
    .poll(async () => (await snapshot()).views.architecture.containers![0]!.x)
    .toBe(group.x + 5);
  await page.getByRole('button', { name: 'Add container', exact: true }).click();
  await expect(page.getByLabel('Container name')).toHaveValue('New container');
  await page.getByLabel('Container name').fill('Nested notes');
  await page.getByLabel('Container name').press('Enter');
  await expect
    .poll(async () => (await snapshot()).views.architecture.containers?.[1]?.name)
    .toBe('Nested notes');
  await page.getByLabel('Parent container').selectOption({ label: 'Intake group' });
  await page.getByLabel('Container width').fill('600');
  await page.getByLabel('Container width').press('Tab');
  await expect
    .poll(async () => (await snapshot()).views.architecture.containers?.[1]?.width)
    .toBe(600);
  const nested = (await snapshot()).views.architecture;
  expect(nested.containers![1]!.parentAppearanceId).toBe(group.id);
  const nestedFrame = page.locator(
      `.react-flow__node[data-id="frame:${nested.containers![1]!.id}"]`,
    ),
    handle = await nestedFrame
      .locator('.react-flow__resize-control.handle.bottom.right')
      .boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 32, handle!.y + handle!.height / 2 + 24, {
    steps: 6,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await snapshot()).views.architecture.containers![1]!.width)
    .toBeGreaterThan(600);
  const header = page.locator('.container-title strong').filter({ hasText: 'Intake group' });
  await header.click();
  const oldGroup = (await snapshot()).views.architecture.containers![0]!,
    headerBox = await header.boundingBox();
  // Wait for both layout changes to reach the renderer before using them as baselines.
  const updates = await page.evaluateHandle(() => {
    let view: ViewDefinition | undefined;
    const stop = window.lattice.onSessionEvent((event) => {
      if (event.kind === 'update' && event.views.architecture) view = event.views.architecture;
    });
    return { latest: () => view, stop };
  });
  try {
    await page.mouse.move(
      headerBox!.x + headerBox!.width / 2,
      headerBox!.y + headerBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      headerBox!.x + headerBox!.width / 2 + 35,
      headerBox!.y + headerBox!.height / 2 + 20,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect
      .poll(() =>
        updates.evaluate(({ latest }, oldX) => {
          const x = latest()?.containers?.[0]?.x;
          return x !== undefined && x !== oldX;
        }, oldGroup.x),
      )
      .toBe(true);
    const beforeArrange = await updates.evaluate(({ latest }) => latest()!);
    const childPositions = beforeArrange.appearances
      .filter((a) => a.parentAppearanceId)
      .map((a) => [a.id, a.x, a.y]);
    await page.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect
      .poll(() => updates.evaluate(({ latest }) => latest()?.containers?.map((c) => [c.x, c.y])))
      .not.toEqual(beforeArrange.containers!.map((c) => [c.x, c.y]));
    const arranged = await updates.evaluate(({ latest }) => latest()!);
    expect(
      arranged.appearances.filter((a) => a.parentAppearanceId).map((a) => [a.id, a.x, a.y]),
    ).toEqual(childPositions);
  } finally {
    await updates.evaluate(({ stop }) => stop());
    await updates.dispose();
  }
  await page.locator('.container-title strong').filter({ hasText: 'Intake group' }).click();
  await expect(page.getByLabel('Parent container').locator('option')).not.toContainText([
    'Nested notes',
  ]);
  await page.getByRole('button', { name: 'Collapse container', exact: true }).click();
  await expect(page.locator('.component-node strong')).toHaveText(['Gamma']);
  await page.getByRole('button', { name: 'Expand container', exact: true }).click();
  await expect(page.locator('.component-node strong')).toHaveCount(3);
  const old = (await snapshot()).views.architecture;
  await page.getByRole('button', { name: 'Remove container; keep items', exact: true }).click();
  await expect.poll(async () => (await snapshot()).views.architecture.containers?.length).toBe(1);
  const removed = (await snapshot()).views.architecture;
  expect(removed.containers).toHaveLength(1);
  for (const a of removed.appearances)
    expect(worldPosition(removed, a.id)).toEqual(worldPosition(old, a.id));
  const after = await snapshot();
  expect(after.project).toEqual(before.project);
  expect(after.views.behavior).toEqual(before.views.behavior);
  await page.getByRole('button', { name: 'Undo layout', exact: true }).click();
  await expect.poll(async () => (await snapshot()).views.architecture.containers?.length).toBe(2);
  await page.screenshot({ path: path.join(evidence, 'dark-containers.png') });
});
test('searchable guide, contextual view help, focus trap and minimum desktop layout', async () => {
  await page.keyboard.press('F1');
  const guide = page.getByRole('dialog', { name: 'Lattice user guide' });
  await expect(guide).toBeVisible();
  await page.getByRole('button', { name: 'How the four views work', exact: true }).click();
  await expect(guide.locator('article')).toContainText('same entities and relationships');
  await page.getByRole('button', { name: 'Containers, grouping and nesting', exact: true }).click();
  await expect(guide.locator('article')).toContainText('No links are required');
  await page.getByLabel('Search the guide').fill('baseline');
  await expect(
    page.getByRole('button', { name: 'Reconcile and analyze impact', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search the guide').fill('');
  await page.getByRole('button', { name: 'Read the diagram and legend', exact: true }).click();
  await expect(guide.locator('.edge-legend>div')).toHaveCount(8);
  await page.screenshot({ path: path.join(evidence, 'user-guide.png') });
  await page.getByLabel('Close user guide').click();
  await page.getByRole('button', { name: 'architecture view ⓘ — About this view' }).click();
  await expect(guide.locator('article h2')).toHaveText('Architecture view');
  await page.getByLabel('Close user guide').click();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1120, 720);
  });
  await page.getByRole('button', { name: 'User guide', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'User guide', exact: true })).toBeFocused();
  expect(
    await page
      .getByRole('button', { name: 'User guide', exact: true })
      .evaluate((e) => getComputedStyle(e).outlineStyle),
  ).toBe('solid');
  await page.screenshot({ path: path.join(evidence, 'minimum-desktop.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
test('appearance choices survive a native application restart', async () => {
  await app.close();
  await launch();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const p = await page.evaluate(() => window.lattice.getPreferences());
  expect(p).toMatchObject({
    uiFont: 'Arial',
    uiFontSize: 14,
    editorFont: 'Courier New',
    editorFontSize: 16,
    theme: 'dark',
  });
  expect(await page.locator('body').evaluate((e) => getComputedStyle(e).fontFamily)).toContain(
    'Arial',
  );
});
