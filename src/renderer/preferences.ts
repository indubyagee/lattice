import { create } from 'zustand';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../shared/preferences';
import { GROUP_COLORS, accentText, mixColor, readableText } from '../shared/style';
export const BRAND_ICONS = {
  dark: '/icons/icon-on-dark.svg',
  light: '/icons/icon-on-light.svg',
};
function apply(p: UserPreferences) {
  const family = (name: string) =>
    ['system-ui', 'monospace'].includes(name) ? name : JSON.stringify(name);
  const root = document.documentElement;
  root.dataset.theme = p.theme;
  root.style.setProperty('--ui-font', `${family(p.uiFont)},system-ui,sans-serif`);
  root.style.setProperty('--ui-font-size', `${p.uiFontSize}px`);
  root.style.setProperty('--editor-font', `${family(p.editorFont)},monospace`);
  const c = p.colors[p.theme],
    dark = p.theme === 'dark';
  const tokens: Record<string, string> = {
    surface: c.background,
    canvas: c.graphBackground,
    'node-background': c.nodeBackground,
    border: c.border,
    'border-strong': mixColor(c.border, c.font, 0.34),
    'text-strong': c.font,
    'text-muted': mixColor(c.font, c.background, 0.16),
    'surface-subtle': mixColor(c.background, c.font, dark ? 0.035 : 0.018),
    'surface-inset': mixColor(c.background, c.font, 0.055),
    'surface-selected': mixColor(c.background, c.accent, dark ? 0.2 : 0.12),
    'accent-raw': c.accent,
    accent: accentText(c.accent, c.background),
    'accent-solid': c.accent,
    'accent-hover': mixColor(c.accent, c.font, 0.12),
    'text-on-accent': readableText(c.accent),
    focus: accentText(c.accent, c.background),
    neighbor: accentText(c.accent, c.graphBackground),
    grid: c.grid,
    'minimap-mask': c.graphBackground + 'B3',
    'tooltip-text': c.tooltipFont,
    'tooltip-surface': c.tooltipBackground,
    'tooltip-border': c.tooltipBorder,
    'tooltip-font-size': `${p.tooltipFontSize}px`,
    'container-surface': mixColor(c.background, c.accent, dark ? 0.08 : 0.05) + '88',
  };
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--${key}`, value);
  for (const [family, color] of Object.entries(GROUP_COLORS[p.theme])) {
    root.style.setProperty(`--group-${family}`, color);
    root.style.setProperty(`--group-${family}-text`, readableText(color, c.background));
  }
  let icon = document.querySelector<HTMLLinkElement>('#lattice-favicon');
  if (!icon) {
    icon = document.createElement('link');
    icon.id = 'lattice-favicon';
    icon.rel = 'icon';
    document.head.append(icon);
  }
  icon.href = BRAND_ICONS[p.theme];
}
export const usePreferences = create<{
  preferences: UserPreferences;
  set: (p: UserPreferences) => void;
}>((set) => ({
  preferences: DEFAULT_PREFERENCES,
  set: (preferences) => {
    apply(preferences);
    set({ preferences });
  },
}));
export async function loadPreferences() {
  try {
    usePreferences.getState().set(await window.lattice.getPreferences());
  } catch {
    usePreferences.getState().set(DEFAULT_PREFERENCES);
  }
}
export async function savePreferences(p: UserPreferences) {
  usePreferences.getState().set(await window.lattice.setPreferences(p));
}
