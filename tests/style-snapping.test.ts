import { describe, it, expect } from 'vitest';
import { alignNodes, type SnapNode, type SnapOptions } from '../src/projection/snapping';
import {
  DEFAULT_COLORS,
  GROUP_COLORS,
  contrastRatio,
  readableText,
  accentText,
} from '../src/shared/style';
import { DEFAULT_PREFERENCES, parsePreferences } from '../src/shared/preferences';
import { mixColor } from '../src/shared/style';
import { PreferencesService } from '../src/main/preferences';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const options: SnapOptions = {
  snapToGrid: false,
  snapToObjects: true,
  gridSize: 24,
  snapDistance: 8,
};
const node = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 60,
  parentId?: string,
): SnapNode => ({ id, position: { x, y }, width, height, parentId });
describe('rigid object and grid snapping', () => {
  it('aligns nearest edges and centers and emits explanatory world-space guides', () => {
    const r = alignNodes([node('a', 194, 247), node('b', 200, 400)], ['a'], options);
    expect(r.positions.get('a')).toEqual({ x: 200, y: 247 });
    expect(r.guides).toEqual([{ axis: 'x', value: 200, from: 223, to: 484 }]);
  });
  it('snaps both grid axes including negative coordinates while preserving selection spacing', () => {
    const r = alignNodes([node('a', -18, 37), node('b', 113, 87)], ['a', 'b'], {
      ...options,
      snapToGrid: true,
      snapToObjects: false,
    });
    expect(r.positions.get('a')).toEqual({ x: -24, y: 48 });
    expect(r.positions.get('b')).toEqual({ x: 107, y: 98 });
    expect(r.guides).toEqual([]);
  });
  it('uses object alignment before grid fallback independently on each axis', () => {
    const r = alignNodes([node('a', 194, 247), node('b', 200, 400)], ['a'], {
      ...options,
      snapToGrid: true,
    });
    expect(r.positions.get('a')).toEqual({ x: 200, y: 240 });
  });
  it('uses screen-pixel tolerance at different zoom levels', () => {
    const nodes = [node('a', 190, 247), node('b', 200, 400)];
    expect(alignNodes(nodes, ['a'], options, 2).positions.get('a')!.x).toBe(190);
    expect(alignNodes(nodes, ['a'], options, 0.5).positions.get('a')!.x).toBe(200);
  });
  it('excludes a moving frame, its children and ancestors as targets', () => {
    const nodes = [
      node('parent', 7, 7, 600, 400),
      node('frame', 6, 7, 200, 200, 'parent'),
      node('child', 2, 3, 50, 50, 'frame'),
    ];
    const r = alignNodes(nodes, ['frame', 'child'], options);
    expect(r.positions.get('frame')).toEqual({ x: 6, y: 7 });
    expect(r.positions.has('child')).toBe(false);
    expect(r.guides).toEqual([]);
  });
  it('converts nested alignment back to parent-relative coordinates', () => {
    const r = alignNodes(
      [
        node('parent', 101, 101, 600, 400),
        node('a', 94, 146, 100, 60, 'parent'),
        node('b', 200, 400),
      ],
      ['a'],
      options,
    );
    expect(r.positions.get('a')).toEqual({ x: 99, y: 146 });
  });
  it('has no movement when both settings are off and deterministic tie behavior', () => {
    const nodes = [node('a', 100, 247), node('c', 106, 400), node('b', 94, 400)];
    expect(alignNodes(nodes, ['a'], { ...options, snapToObjects: false }).positions.size).toBe(0);
    expect(alignNodes(nodes, ['a'], options).positions.get('a')!.x).toBe(94);
  });
});
describe('version-compatible local styles', () => {
  it('migrates the original font-only settings without losing user choices', () => {
    const p = parsePreferences({
      theme: 'dark',
      uiFont: 'Arial',
      uiFontSize: 14,
      editorFont: 'Consolas',
      editorFontSize: 15,
    });
    expect(p.uiFont).toBe('Arial');
    expect(p.colors).toEqual(DEFAULT_COLORS);
    expect(p.snapToGrid).toBe(false);
    expect(p.tooltipDelay).toBe(420);
  });
  it('rejects executable/color CSS payloads, non-booleans and invalid ranges', () => {
    for (const patch of [
      { colors: { dark: { accent: 'url(https://bad)' } } },
      { snapToGrid: 'yes' },
      { snapToObjects: null },
      { gridSize: 0 },
      { snapDistance: 99 },
      { tooltipDelay: -1 },
      { tooltipFontSize: 100 },
    ])
      expect(() => parsePreferences({ ...DEFAULT_PREFERENCES, ...patch })).toThrow();
  });
  it('persists independent mode overrides and both snap settings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-styles-')),
      service = new PreferencesService(dir),
      value = structuredClone(DEFAULT_PREFERENCES);
    value.colors.dark.background = '#111111';
    value.colors.light.accent = '#123456';
    value.snapToObjects = true;
    value.snapToGrid = true;
    value.tooltipDelay = 250;
    await service.write(value);
    expect(await new PreferencesService(dir).read()).toEqual(value);
    expect(DEFAULT_COLORS.dark.background).toBe('#0A0A0A');
  });
  it('provides legible family presets and accent text on each default surface', () => {
    for (const mode of ['dark', 'light'] as const) {
      const c = DEFAULT_COLORS[mode];
      for (const color of Object.values(GROUP_COLORS[mode])) {
        const visible =
          color.length === 9
            ? mixColor(c.background, color, parseInt(color.slice(7, 9), 16) / 255)
            : color;
        expect(contrastRatio(readableText(color, c.background), visible)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      expect(
        contrastRatio(accentText(c.accent, c.background), c.background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          accentText(c.accent, c.background),
          mixColor(c.background, c.accent, mode === 'dark' ? 0.2 : 0.12),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('chooses text against the surface showing through translucent colors', () => {
    expect(readableText('#B24C4CBB', '#FFFFFF')).toBe('#0A0A0A');
    expect(readableText('#00000000', '#FFFFFF')).toBe('#0A0A0A');
    expect(readableText('#FFFFFF00', '#000000')).toBe('#FAFAFA');
  });
});
