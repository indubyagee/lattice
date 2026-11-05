import { COLOR_LABELS, DEFAULT_COLORS, contrastRatio, type ThemeColors } from '../shared/style';
import type { UserPreferences } from '../shared/preferences';
const colorKeys = Object.keys(COLOR_LABELS) as (keyof ThemeColors)[];
export function ColorControls({
  draft,
  patch,
  tooltip = false,
}: {
  draft: UserPreferences;
  patch: (p: Partial<UserPreferences>) => void;
  tooltip?: boolean;
}) {
  const c = draft.colors[draft.theme],
    update = (key: keyof ThemeColors, value: string) =>
      patch({ colors: { ...draft.colors, [draft.theme]: { ...c, [key]: value } } });
  return (
    <div className="color-controls">
      {colorKeys
        .filter((key) => key.startsWith('tooltip') === tooltip)
        .map((key) => (
          <div className="color-control" key={key}>
            <label htmlFor={`color-${key}`}>{COLOR_LABELS[key]}</label>
            <input
              id={`color-${key}`}
              type="color"
              aria-label={`${COLOR_LABELS[key]} picker`}
              value={/^#[0-9a-f]{6}$/i.test(c[key]) ? c[key] : '#000000'}
              onChange={(e) => update(key, e.target.value)}
            />
            <input
              aria-label={`${COLOR_LABELS[key]} hex`}
              className="color-hex"
              value={c[key]}
              spellCheck={false}
              maxLength={7}
              aria-invalid={!/^#[0-9a-f]{6}$/i.test(c[key])}
              onChange={(e) => update(key, e.target.value)}
            />
          </div>
        ))}
    </div>
  );
}
export function StyleSettings({
  draft,
  patch,
}: {
  draft: UserPreferences;
  patch: (p: Partial<UserPreferences>) => void;
}) {
  const c = draft.colors[draft.theme],
    ratio = contrastRatio(c.font, c.background);
  return (
    <>
      <p className="muted">
        Editing the {draft.theme} palette. Each mode keeps its own colors. Node group accents use
        the supplied family presets.
      </p>
      <ColorControls draft={draft} patch={patch} />
      <button
        onClick={() =>
          patch({ colors: { ...draft.colors, [draft.theme]: { ...DEFAULT_COLORS[draft.theme] } } })
        }
      >
        Reset {draft.theme} palette
      </button>
      <div
        className="style-preview"
        aria-label="Palette preview"
        style={{ backgroundColor: c.background, color: c.font, borderColor: c.border }}
      >
        <strong>Interface text and controls</strong>
        <div
          className="style-preview-graph"
          style={{
            backgroundColor: c.graphBackground,
            backgroundImage: `radial-gradient(${c.grid} 1px,transparent 1px)`,
          }}
        >
          <div style={{ backgroundColor: c.nodeBackground, borderColor: c.border, color: c.font }}>
            Node background <span style={{ backgroundColor: c.accent }} aria-hidden="true" />
          </div>
        </div>
      </div>
      <p className="muted">
        Text/background contrast: {Number.isFinite(ratio) ? ratio.toFixed(2) : '—'}:1. Small text
        normally needs at least 4.5:1. Custom colors are kept as chosen.
      </p>
    </>
  );
}
export function TooltipSettings({
  draft,
  patch,
}: {
  draft: UserPreferences;
  patch: (p: Partial<UserPreferences>) => void;
}) {
  const c = draft.colors[draft.theme];
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={draft.graphTooltips}
          onChange={(e) => patch({ graphTooltips: e.target.checked })}
        />
        Enable graph tooltips
      </label>
      <p className="muted">
        Delay applies to hover and keyboard focus. Tooltip colors are saved for the selected{' '}
        {draft.theme} mode.
      </p>
      <div className="settings-numbers">
        <label>
          Tooltip delay (ms)
          <input
            type="number"
            aria-label="Tooltip delay (ms)"
            min={0}
            max={3000}
            step={50}
            value={draft.tooltipDelay}
            onChange={(e) => patch({ tooltipDelay: Number(e.target.value) })}
          />
        </label>
        <label>
          Tooltip font size (px)
          <input
            type="number"
            aria-label="Tooltip font size (px)"
            min={10}
            max={24}
            value={draft.tooltipFontSize}
            onChange={(e) => patch({ tooltipFontSize: Number(e.target.value) })}
          />
        </label>
      </div>
      <ColorControls draft={draft} patch={patch} tooltip />
      <div
        className="tooltip-preview"
        style={{
          fontSize: draft.tooltipFontSize,
          color: c.tooltipFont,
          backgroundColor: c.tooltipBackground,
          borderColor: c.tooltipBorder,
        }}
      >
        A concise explanation of a component, node, field or control.
      </div>
    </>
  );
}
export function SnappingSettings({
  draft,
  patch,
}: {
  draft: UserPreferences;
  patch: (p: Partial<UserPreferences>) => void;
}) {
  return (
    <>
      <label className="setting-toggle">
        <input
          type="checkbox"
          checked={draft.snapToGrid}
          onChange={(e) => patch({ snapToGrid: e.target.checked })}
        />
        Snap to grid
      </label>
      <p className="muted">
        Align dragged nodes and frames to the canvas grid. Existing layouts stay in place until
        moved. The grid size also controls keyboard movement when enabled.
      </p>
      <label>
        Grid size (canvas units)
        <input
          type="number"
          aria-label="Grid size (canvas units)"
          min={8}
          max={100}
          value={draft.gridSize}
          onChange={(e) => patch({ gridSize: Number(e.target.value) })}
        />
      </label>
      <label className="setting-toggle">
        <input
          type="checkbox"
          checked={draft.snapToObjects}
          onChange={(e) => patch({ snapToObjects: e.target.checked })}
        />
        Snap to objects
      </label>
      <p className="muted">
        During pointer dragging, align edges or centers with other visible items. Guides show the
        matching axis. A moving group and its ancestors/descendants are excluded as targets. Object
        alignment takes priority near a match; grid snapping applies on the other axes. Arrow keys
        remain available for precise movement.
      </p>
      <label>
        Object snap distance (screen pixels)
        <input
          type="number"
          aria-label="Object snap distance (screen pixels)"
          min={2}
          max={24}
          value={draft.snapDistance}
          onChange={(e) => patch({ snapDistance: Number(e.target.value) })}
        />
      </label>
    </>
  );
}
