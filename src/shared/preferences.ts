import { DEFAULT_COLORS, type ThemeColors } from './style';
export interface UserPreferences {
  theme: 'light' | 'dark';
  uiFont: string;
  uiFontSize: number;
  editorFont: string;
  editorFontSize: number;
  snapToGrid: boolean;
  snapToObjects: boolean;
  gridSize: number;
  snapDistance: number;
  showSystemConnections: boolean;
  graphTooltips: boolean;
  tooltipDelay: number;
  tooltipFontSize: number;
  colors: { light: ThemeColors; dark: ThemeColors };
}
export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  uiFont: 'Segoe UI',
  uiFontSize: 12,
  editorFont: 'Consolas',
  editorFontSize: 12,
  snapToGrid: false,
  snapToObjects: false,
  gridSize: 24,
  snapDistance: 8,
  showSystemConnections: false,
  graphTooltips: false,
  tooltipDelay: 420,
  tooltipFontSize: 12,
  colors: structuredClone(DEFAULT_COLORS),
};
export function parsePreferences(value: unknown): UserPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid appearance settings');
  const p = value as Record<string, unknown>;
  if (
    !['light', 'dark'].includes(String(p.theme)) ||
    !Number.isInteger(p.uiFontSize) ||
    Number(p.uiFontSize) < 11 ||
    Number(p.uiFontSize) > 16 ||
    !Number.isInteger(p.editorFontSize) ||
    Number(p.editorFontSize) < 11 ||
    Number(p.editorFontSize) > 20
  )
    throw new Error('Choose a supported theme and font size');
  for (const key of ['uiFont', 'editorFont'])
    if (
      typeof p[key] !== 'string' ||
      !p[key].trim() ||
      p[key].length > 128 ||
      /[\x00-\x1f]/.test(p[key])
    )
      throw new Error('Invalid font family');
  const integer = (key: string, min: number, max: number) => {
    const value = p[key] === undefined ? DEFAULT_PREFERENCES[key as keyof UserPreferences] : p[key];
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
      throw new Error(`Invalid ${key}: choose an integer from ${min} to ${max}`);
    return Number(value);
  };
  const boolean = (
    key: 'snapToGrid' | 'snapToObjects' | 'showSystemConnections' | 'graphTooltips',
  ) => {
    const value = p[key] === undefined ? DEFAULT_PREFERENCES[key] : p[key];
    if (typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
    return value;
  };
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (p.colors !== undefined && !object(p.colors)) throw new Error('Invalid theme colors');
  const colors = structuredClone(DEFAULT_COLORS);
  for (const mode of ['light', 'dark'] as const) {
    const source = (p.colors as Record<string, unknown> | undefined)?.[mode];
    if (source === undefined) continue;
    if (!object(source)) throw new Error('Invalid theme palette');
    for (const key of Object.keys(colors[mode]) as (keyof ThemeColors)[]) {
      const color = source[key];
      if (color === undefined) continue;
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
        throw new Error(`Invalid ${mode} ${key}: use #RRGGBB`);
      colors[mode][key] = color.toUpperCase();
    }
  }
  return {
    theme: p.theme as UserPreferences['theme'],
    uiFont: p.uiFont as string,
    uiFontSize: p.uiFontSize as number,
    editorFont: p.editorFont as string,
    editorFontSize: p.editorFontSize as number,
    snapToGrid: boolean('snapToGrid'),
    snapToObjects: boolean('snapToObjects'),
    gridSize: integer('gridSize', 8, 100),
    snapDistance: integer('snapDistance', 2, 24),
    showSystemConnections: boolean('showSystemConnections'),
    graphTooltips: boolean('graphTooltips'),
    tooltipDelay: integer('tooltipDelay', 0, 3000),
    tooltipFontSize: integer('tooltipFontSize', 10, 24),
    colors,
  };
}
