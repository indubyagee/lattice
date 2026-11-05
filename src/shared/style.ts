export type ThemeMode = 'light' | 'dark';
export interface ThemeColors {
  accent: string;
  background: string;
  border: string;
  graphBackground: string;
  grid: string;
  nodeBackground: string;
  font: string;
  tooltipFont: string;
  tooltipBackground: string;
  tooltipBorder: string;
}
export const COLOR_LABELS: Record<keyof ThemeColors, string> = {
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
export const DEFAULT_COLORS: Record<ThemeMode, ThemeColors> = {
  dark: {
    accent: '#50A0A0',
    background: '#0A0A0A',
    border: '#202020',
    graphBackground: '#151515',
    grid: '#505050',
    nodeBackground: '#151515',
    font: '#FAFAFA',
    tooltipFont: '#FAFAFA',
    tooltipBackground: '#202020',
    tooltipBorder: '#505050',
  },
  light: {
    accent: '#50A0A0',
    background: '#FAFAFA',
    border: '#E1E1E1',
    graphBackground: '#F0F0F0',
    grid: '#C5C5C5',
    nodeBackground: '#FAFAFA',
    font: '#0A0A0A',
    tooltipFont: '#FAFAFA',
    tooltipBackground: '#202020',
    tooltipBorder: '#505050',
  },
};
export const GROUP_COLORS: Record<ThemeMode, Record<string, string>> = {
  dark: {
    structure: '#2D4646',
    purpose: '#32411E',
    capability: '#501E1E',
    behavior: '#5A3250',
    information: '#6E5A28',
    boundary: '#46375A',
  },
  light: {
    structure: '#608F94BB',
    purpose: '#69823CBB',
    capability: '#B24C4CBB',
    behavior: '#915082BB',
    information: '#DAB352BB',
    boundary: '#886FADBB',
  },
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function mixColor(a: string, b: string, amount: number): string {
  return (
    '#' +
    rgb(a)
      .map((v, i) =>
        Math.round(v + (rgb(b)[i]! - v) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const luminance = (hex: string) =>
  rgb(hex)
    .map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function readableText(background: string, surface = '#FFFFFF'): string {
  const opaque =
    background.length === 9
      ? mixColor(surface, background, parseInt(background.slice(7, 9), 16) / 255)
      : background;
  return contrastRatio('#FAFAFA', opaque) > contrastRatio('#0A0A0A', opaque)
    ? '#FAFAFA'
    : '#0A0A0A';
}
/** Derive readable links from the requested accent without changing its button/swatch color. */
export function accentText(accent: string, background: string): string {
  const target = readableText(background);
  for (let i = 0; i <= 20; i++) {
    const color = mixColor(accent, target, i / 20);
    if (contrastRatio(color, background) >= 5.5) return color;
  }
  return target;
}
