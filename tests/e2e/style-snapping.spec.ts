import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { GROUP_COLORS, DEFAULT_COLORS, type ThemeColors } from '../../src/shared/style';
test.describe.configure({ mode: 'serial' });
test.use({ trace: process.env.LATTICE_TRACE ? 'retain-on-failure' : 'off' });
let app: ElectronApplication, page: Page, local: string;
const errors: string[] = [];
const evidence =
  process.env.LATTICE_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'lattice-style-evidence');
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
const rgb = (hex: string) => {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
  if (hex.length === 9) {
    const alpha = Number((parseInt(hex.slice(7, 9), 16) / 255).toFixed(3));
    if (alpha < 1) return `rgba(${channels}, ${alpha})`;
  }
  return `rgb(${channels})`;
};
const settings = () => page.getByRole('dialog', { name: 'User settings' });
async function open(section: string) {
  await page.keyboard.press('Control+,');
  await expect(settings()).toBeVisible();
  await settings().getByRole('button', { name: section, exact: true }).click();
}
async function apply() {
  await settings().getByRole('button', { name: 'Apply appearance' }).click();
  await expect(settings()).toHaveCount(0);
}
async function nodeBox(name: string) {
  return (await page
    .locator('.component-node')
    .filter({ has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) })
    .boundingBox())!;
}
async function select(name: string, shift = false) {
  await page
    .locator('.component-node strong')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .click({ modifiers: shift ? ['Shift'] : [] });
}
test.beforeAll(async () => {
  local = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-style-'));
  await fs.mkdir(evidence, { recursive: true });
  await launch();
});
test.afterAll(async () => {
  await app?.close();
});
test('supplied logos, exact mode/group palettes and accessible default screens', async () => {
  await page.getByRole('button', { name: 'Add a system', exact: true }).click();
  await expect(page.getByLabel('Component name')).toHaveValue('My system');
  for (const mode of ['light', 'dark'] as const) {
    if (mode === 'dark') await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await expect(page.locator('.app-header .brand-mark')).toHaveAttribute('data-theme-icon', mode);
    await expect(page.locator('#lattice-favicon')).toHaveAttribute(
      'href',
      `/icons/icon-on-${mode}.svg`,
    );
    const hash = await page.evaluate(async () => {
      const img = document.querySelector<HTMLImageElement>('.app-header .brand-mark')!;
      await img.decode();
      return [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', await (await fetch(img.src)).arrayBuffer()),
        ),
      ]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
    });
    expect(hash).toBe(
      createHash('sha256')
        .update(await fs.readFile(path.resolve(`public/icons/icon-on-${mode}.svg`)))
        .digest('hex'),
    );
    await expect(page.locator('.app-header')).toHaveCSS(
      'background-color',
      rgb(DEFAULT_COLORS[mode].background),
    );
    await expect(page.locator('.flow-surface')).toHaveCSS(
      'background-color',
      rgb(DEFAULT_COLORS[mode].graphBackground),
    );
    await expect(page.locator('.component-node')).toHaveCSS(
      'background-color',
      rgb(DEFAULT_COLORS[mode].nodeBackground),
    );
    for (const [family, color] of Object.entries(GROUP_COLORS[mode]))
      await expect(
        page.locator(`.component-group.family-${family} .toolbox-item`).first(),
      ).toHaveCSS('background-color', rgb(color));
    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');
    const result = await new AxeBuilder({ page }).setLegacyMode(true).analyze();
    await fs.writeFile(
      path.join(evidence, `palette-accessibility-${mode}.json`),
      JSON.stringify(result.violations, null, 2),
    );
    await page.screenshot({ path: path.join(evidence, `palette-${mode}.png`) });
    expect(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  }
});
test('independent custom palettes, every requested style control and tooltip timing', async () => {
  const before = (await snapshot()).project;
  await open('Colors');
  const custom: ThemeColors = {
    accent: '#5EBFC0',
    background: '#101114',
    border: '#4B545B',
    graphBackground: '#181B20',
    grid: '#788694',
    nodeBackground: '#20262D',
    font: '#F0F4F8',
    tooltipFont: '#FEFEFE',
    tooltipBackground: '#30343B',
    tooltipBorder: '#9EAFB8',
  };
  await page.getByLabel('Accent color hex').fill('invalid');
  await page.getByLabel('Background color hex', { exact: true }).fill('url(x)');
  await expect(page.getByLabel('Palette preview')).toHaveCSS('background-image', 'none');
  await expect(settings().getByRole('button', { name: 'Apply appearance' })).toBeDisabled();
  const labels = {
    accent: 'Accent color',
    background: 'Background color',
    border: 'Border color',
    graphBackground: 'Graph background color',
    grid: 'Grid color',
    nodeBackground: 'Node background color',
    font: 'Font color',
    tooltipFont: 'Tooltip font color',
    tooltipBackground: 'Tooltip background color',
    tooltipBorder: 'Tooltip border color',
  };
  for (const key of Object.keys(custom) as (keyof ThemeColors)[])
    if (!key.startsWith('tooltip'))
      await page.getByLabel(`${labels[key]} hex`, { exact: true }).fill(custom[key]);
  await settings().getByRole('button', { name: 'Tooltips', exact: true }).click();
  await page.getByLabel('Tooltip delay (ms)', { exact: true }).fill('1200');
  await page.getByLabel('Tooltip font size (px)', { exact: true }).fill('16');
  for (const key of ['tooltipFont', 'tooltipBackground', 'tooltipBorder'] as const)
    await page.getByLabel(`${labels[key]} hex`, { exact: true }).fill(custom[key]);
  await page.screenshot({ path: path.join(evidence, 'tooltip-settings.png') });
  await apply();
  await expect(page.locator('.app-header')).toHaveCSS('background-color', rgb(custom.background));
  await expect(page.locator('.component-node')).toHaveCSS(
    'background-color',
    rgb(custom.nodeBackground),
  );
  await expect(page.locator('.component-node strong')).toHaveCSS('color', rgb(custom.font));
  await expect(page.locator('.component-node')).toHaveCSS('border-left-color', rgb(custom.border));
  await page.getByRole('button', { name: 'Export package ↗' }).click();
  await page.getByRole('button', { name: 'Prepare preview' }).click();
  await expect(page.locator('.monaco-editor').first()).toHaveCSS(
    'background-color',
    rgb(custom.background),
  );
  await expect(page.locator('.monaco-editor .mtk1').first()).toHaveCSS('color', rgb(custom.font));
  await page.getByLabel('Close export').click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  const definition = page.locator('.library-panel .monaco-editor').first();
  await definition.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n// unsaved style buffer probe');
  await expect(definition.locator('.view-lines')).toContainText('unsaved style buffer probe');
  await expect(page.locator('.primary').first()).toHaveCSS('background-color', rgb(custom.accent));
  expect(
    await page
      .locator('html')
      .evaluate((e) => getComputedStyle(e).getPropertyValue('--grid').trim()),
  ).toBe(custom.grid);
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('.app-header')).toHaveCSS(
    'background-color',
    rgb(DEFAULT_COLORS.light.background),
  );
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('.app-header')).toHaveCSS('background-color', rgb(custom.background));
  await expect(definition.locator('.view-lines')).toContainText('unsaved style buffer probe');
  await definition.click();
  await page.keyboard.press('Control+z');
  await expect(definition.locator('.view-lines')).not.toContainText('unsaved style buffer probe');
  await page.getByRole('button', { name: /^Findings/ }).click();
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  const component = page.getByRole('button', { name: 'Insert System', exact: true });
  await component.hover();
  await page.waitForTimeout(250);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toBeVisible({ timeout: 2500 });
  await expect(page.getByRole('tooltip')).toHaveCSS('font-size', '16px');
  await expect(page.getByRole('tooltip')).toHaveCSS('color', rgb(custom.tooltipFont));
  await expect(page.getByRole('tooltip')).toHaveCSS(
    'background-color',
    rgb(custom.tooltipBackground),
  );
  await expect(page.getByRole('tooltip')).toHaveCSS('border-top-color', rgb(custom.tooltipBorder));
  await page.screenshot({ path: path.join(evidence, 'custom-tooltip.png') });
  await page.keyboard.press('Escape');
  expect((await snapshot()).project).toEqual(before);
});
test('object snapping displays guides and persists the aligned position', async () => {
  await page.getByLabel('Component name').fill('A');
  await page.getByLabel('Component name').press('Enter');
  await page.getByRole('button', { name: 'Insert System', exact: true }).click();
  await expect(page.getByLabel('Component name')).toHaveValue('System');
  await page.getByLabel('Component name').fill('B');
  await page.getByLabel('Component name').press('Enter');
  await expect(page.locator('.component-node strong').filter({ hasText: /^B$/ })).toBeVisible();
  await page.evaluate(async () => {
    const s = await window.lattice.snapshot(),
      v = s.views.architecture;
    await window.lattice.saveView({
      ...v,
      appearances: v.appearances.map((a) => ({
        ...a,
        x: s.project.entities[a.entityId]!.name === 'A' ? 120 : 410,
        y: s.project.entities[a.entityId]!.name === 'A' ? 120 : 310,
      })),
    });
  });
  await page.getByRole('button', { name: 'Fit view', exact: true }).click();
  await open('Snapping');
  await page.getByLabel('Snap to objects', { exact: true }).check();
  await apply();
  await select('A');
  const a = await nodeBox('A'),
    b = await nodeBox('B'),
    start = { x: a.x + 70, y: a.y + 45 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y);
  await page.mouse.move(start.x + b.x - a.x - 5, start.y, { steps: 8 });
  await expect(page.getByTestId('snap-guide-x')).toHaveCount(1);
  await page.screenshot({ path: path.join(evidence, 'object-snapping.png') });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const s = await snapshot();
      return s.views.architecture.appearances.find(
        (a) => s.project.entities[a.entityId]!.name === 'A',
      )!.x;
    })
    .toBeCloseTo(410, 6);
  await expect(page.getByTestId('snap-guide-x')).toHaveCount(0);
});
test('grid drag preserves group spacing; nested frames and keyboard work with both modes', async () => {
  await open('Snapping');
  await page.getByLabel('Snap to grid', { exact: true }).check();
  await page.getByLabel('Snap to objects', { exact: true }).uncheck();
  await page.getByLabel('Grid size (canvas units)', { exact: true }).fill('32');
  await apply();
  await select('A');
  await select('B', true);
  const before = await snapshot(),
    old = before.views.architecture.appearances,
    a = await nodeBox('A');
  await page.mouse.move(a.x + 70, a.y + 45);
  await page.mouse.down();
  await page.mouse.move(a.x + 107, a.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await snapshot()).views.architecture.appearances[0]!.x)
    .not.toBe(old[0]!.x);
  const moved = (await snapshot()).views.architecture.appearances;
  expect(moved[0]!.x).toBeCloseTo(Math.round(moved[0]!.x / 32) * 32, 6);
  const minY = Math.min(...moved.map((a) => a.y));
  expect(minY).toBeCloseTo(Math.round(minY / 32) * 32, 6);
  expect(moved[1]!.x - moved[0]!.x).toBeCloseTo(old[1]!.x - old[0]!.x, 6);
  expect(moved[1]!.y - moved[0]!.y).toBeCloseTo(old[1]!.y - old[0]!.y, 6);
  await page.getByRole('button', { name: 'Group selection', exact: true }).click();
  await expect(page.getByLabel('Container name')).toHaveValue('Grouped selection');
  const grouped = (await snapshot()).views.architecture,
    frame = grouped.containers![0]!;
  await open('Snapping');
  await page.getByLabel('Snap to objects', { exact: true }).check();
  await apply();
  const el = page.getByRole('group', {
    name: 'Grouped selection, presentation-only container',
    exact: true,
  });
  await el.focus();
  await el.press('ArrowDown');
  await expect
    .poll(async () => (await snapshot()).views.architecture.containers![0]!.y)
    .toBe(frame.y + 32);
  expect((await snapshot()).views.architecture.appearances).toEqual(grouped.appearances);
  expect((await snapshot()).project).toEqual(before.project);
  const dir = path.join(local, 'saved');
  await fs.mkdir(dir);
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, dir);
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await expect
    .poll(async () => {
      try {
        return (await fs.readdir(dir)).includes('project.json');
      } catch {
        return false;
      }
    })
    .toBe(true);
  const saved = (await snapshot()).views.architecture;
  await app.close();
  await launch();
  expect(await page.evaluate(() => window.lattice.getPreferences())).toMatchObject({
    snapToGrid: true,
    snapToObjects: true,
    gridSize: 32,
    tooltipDelay: 1200,
    tooltipFontSize: 16,
  });
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, dir);
  await page.getByRole('button', { name: 'Open…', exact: true }).click();
  await expect
    .poll(async () => (await snapshot()).views.architecture.containers)
    .toEqual(saved.containers);
  expect((await snapshot()).views.architecture.appearances).toEqual(saved.appearances);
  expect(errors).toEqual([]);
});
test('cancel and palette/default resets preserve model data; settings controls are accessible', async () => {
  const model = (await snapshot()).project,
    original = await page.evaluate(() => window.lattice.getPreferences());
  expect(original.colors.dark.nodeBackground).toBe('#20262D');
  await open('Colors');
  await settings().getByRole('button', { name: 'Reset dark palette' }).click();
  await settings().getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => window.lattice.getPreferences())).toEqual(original);
  await open('Colors');
  await settings().getByRole('button', { name: 'Reset dark palette' }).click();
  await apply();
  const reset = await page.evaluate(() => window.lattice.getPreferences());
  expect(reset.colors.dark).toEqual(DEFAULT_COLORS.dark);
  expect(reset).toMatchObject({ snapToGrid: true, snapToObjects: true, tooltipDelay: 1200 });
  await open('Fonts');
  await settings().getByRole('button', { name: 'Restore defaults' }).click();
  await apply();
  await open('Fonts');
  for (const section of ['Fonts', 'Colors', 'Snapping', 'Tooltips']) {
    await settings().getByRole('button', { name: section, exact: true }).click();
    const report = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .include('[aria-modal="true"]')
      .analyze();
    await fs.writeFile(
      path.join(evidence, `settings-accessibility-${section.toLowerCase()}.json`),
      JSON.stringify(report.violations, null, 2),
    );
    expect(
      report.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  }
  await settings().getByRole('button', { name: 'Colors', exact: true }).click();
  await page.screenshot({ path: path.join(evidence, 'color-settings-light.png') });
  await settings().getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await snapshot()).project).toEqual(model);
  expect(errors).toEqual([]);
});
