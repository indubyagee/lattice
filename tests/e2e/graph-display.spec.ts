import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEntity, typeRef } from '../../src/domain/builtins';
import { provenance, type Operation } from '../../src/domain/types';

test('graph display controls default off, preserve the model and persist across launches', async () => {
  const local = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-graph-display-')),
    env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
  delete env.ELECTRON_RUN_AS_NODE;
  env.LATTICE_TEST_HOME = local;
  const errors: string[] = [];
  const launch = async () => {
    const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env }),
      page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.app-header')).toBeVisible();
    return { app, page };
  };
  const systemConnections = (page: Page) =>
      page.getByRole('button', { name: /^System connections:/ }),
    graphTooltips = (page: Page) => page.getByRole('button', { name: /^Graph tooltips:/ });
  let { app, page } = await launch();
  try {
    await expect(systemConnections(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(graphTooltips(page)).toHaveAttribute('aria-pressed', 'false');
    const entities = [
        createEntity(typeRef('system'), 'Graph system'),
        createEntity(typeRef('agent'), 'Graph agent'),
        createEntity(typeRef('subsystem'), 'Graph subsystem'),
      ],
      [system, agent, subsystem] = entities,
      operations: Operation[] = entities.map((entity) => ({ kind: 'create-entity', entity }));
    for (const [id, source, target] of [
      ['system-out', system!.id, agent!.id],
      ['system-in', subsystem!.id, system!.id],
      ['peers', agent!.id, subsystem!.id],
    ])
      operations.push({
        kind: 'put-relationship',
        relationship: {
          id: id!,
          source: source!,
          target: target!,
          typeRef: typeRef('depends-on'),
          properties: {},
          provenance: provenance(),
        },
      });
    await page.evaluate(async (serialized) => {
      const { project } = await window.lattice.snapshot();
      await window.lattice.execute({
        baseRevision: project.revision,
        reason: 'Graph display fixture',
        operations: JSON.parse(serialized) as Operation[],
      });
    }, JSON.stringify(operations));
    const before = await page.evaluate(() => window.lattice.snapshot());
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await systemConnections(page).focus();
    await page.keyboard.press('Space');
    await expect(systemConnections(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.react-flow__edge')).toHaveCount(3);
    await systemConnections(page).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    const node = page.locator('.react-flow__node').filter({ hasText: 'Graph agent' });
    await node.hover();
    await page.waitForTimeout(700);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await node.focus();
    await page.waitForTimeout(700);
    await expect(node).not.toHaveAttribute('aria-describedby', /lattice-context-tooltip/);
    await graphTooltips(page).click();
    await node.hover();
    await expect(page.getByRole('tooltip')).toContainText('Graph agent');
    await page.keyboard.press('Escape');
    await node.focus();
    await expect(page.getByRole('tooltip')).toContainText('Graph agent');
    await expect(node).toHaveAttribute('aria-describedby', /lattice-context-tooltip/);
    await graphTooltips(page).click();
    await node.focus();
    await page.waitForTimeout(700);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(node).not.toHaveAttribute('aria-describedby', /lattice-context-tooltip/);
    await page.keyboard.press('Control+,');
    const settings = page.getByRole('dialog', { name: 'User settings' });
    await settings.getByRole('button', { name: 'Tooltips', exact: true }).click();
    await expect(settings.getByLabel('Enable graph tooltips')).not.toBeChecked();
    await settings.getByLabel('Enable graph tooltips').check();
    await settings.getByRole('button', { name: 'Apply appearance' }).click();
    await expect(graphTooltips(page)).toHaveAttribute('aria-pressed', 'true');
    await systemConnections(page).click();
    await expect(systemConnections(page)).toHaveAttribute('aria-pressed', 'true');
    const after = await page.evaluate(() => window.lattice.snapshot());
    expect(after.project).toEqual(before.project);
    expect(after.views.architecture.appearances).toEqual(before.views.architecture.appearances);
    expect(after.views.architecture.containers).toEqual(before.views.architecture.containers);
    expect(after.dirty).toBe(before.dirty);
    expect(await page.evaluate(() => window.lattice.getPreferences())).toMatchObject({
      showSystemConnections: true,
      graphTooltips: true,
    });
    await app.close();
    ({ app, page } = await launch());
    await expect(systemConnections(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(graphTooltips(page)).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
