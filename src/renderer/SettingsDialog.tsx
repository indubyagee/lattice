import { useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../shared/preferences';
import { usePreferences, savePreferences } from './preferences';
import { run } from './store';
import { StyleSettings, TooltipSettings, SnappingSettings } from './StyleSettings';
import { parsePreferences } from '../shared/preferences';
export function SettingsDialog({ close }: { close: () => void }) {
  const current = usePreferences((s) => s.preferences),
    [draft, setDraft] = useState<UserPreferences>(current),
    [fonts, setFonts] = useState<string[]>([]),
    [fontError, setFontError] = useState(''),
    [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'fonts' | 'colors' | 'snapping' | 'tooltips'>('fonts');
  let valid = true;
  try {
    parsePreferences(draft);
  } catch {
    valid = false;
  }
  useEffect(() => {
    let active = true;
    void window.lattice
      .installedFonts()
      .then((list) => {
        if (active) setFonts(list);
      })
      .catch(() => {
        if (active)
          setFontError(
            'Windows could not list the installed fonts. Current settings remain available.',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const patch = (p: Partial<UserPreferences>) => setDraft({ ...draft, ...p });
  return (
    <div className="modal-backdrop">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="User settings"
      >
        <div className="panel-toolbar">
          <h2>User settings</h2>
          <div className="spacer" />
          <button aria-label="Close settings" onClick={close}>
            ×
          </button>
        </div>
        <div className="settings-body">
          <p>
            Choose appearance, fonts, tooltips and snapping on this computer. These settings stay
            outside your project and exports.
          </p>
          <fieldset>
            <legend>Theme</legend>
            <div className="button-row">
              {(['light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  aria-pressed={draft.theme === theme}
                  className={draft.theme === theme ? 'active' : ''}
                  onClick={() => patch({ theme })}
                >
                  {theme === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </fieldset>
          <nav className="settings-tabs" aria-label="Settings sections">
            {(['fonts', 'colors', 'snapping', 'tooltips'] as const).map((t) => (
              <button
                key={t}
                aria-pressed={t === tab}
                className={t === tab ? 'active' : ''}
                onClick={() => setTab(t)}
              >
                {t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
          {tab === 'colors' && <StyleSettings draft={draft} patch={patch} />}
          {tab === 'snapping' && <SnappingSettings draft={draft} patch={patch} />}
          {tab === 'tooltips' && <TooltipSettings draft={draft} patch={patch} />}
          {tab === 'fonts' && (
            <>
              <div className="settings-fonts">
                {(['ui', 'editor'] as const).map((kind) => (
                  <fieldset key={kind}>
                    <legend>{kind === 'ui' ? 'Interface font' : 'Editor font'}</legend>
                    <label>
                      Font family
                      <select
                        aria-label={kind === 'ui' ? 'Interface font family' : 'Editor font family'}
                        value={draft[`${kind}Font`]}
                        onChange={(e) => patch({ [`${kind}Font`]: e.target.value })}
                      >
                        {[...new Set([draft[`${kind}Font`], ...fonts])].map((font) => (
                          <option key={font}>{font}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Size
                      <select
                        aria-label={kind === 'ui' ? 'Interface font size' : 'Editor font size'}
                        value={draft[`${kind}FontSize`]}
                        onChange={(e) => patch({ [`${kind}FontSize`]: Number(e.target.value) })}
                      >
                        {Array.from({ length: kind === 'ui' ? 6 : 10 }, (_, i) => i + 11).map(
                          (size) => (
                            <option key={size} value={size}>
                              {size} px
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <div
                      className="font-preview"
                      style={{
                        fontFamily: draft[`${kind}Font`],
                        fontSize: draft[`${kind}FontSize`],
                      }}
                    >
                      {kind === 'ui'
                        ? 'Architecture → Behavior → Information → Validation'
                        : '{ "status": "planned", "revision": 12 }'}
                    </div>
                  </fieldset>
                ))}
              </div>
              <p className="muted" role="status">
                {fontError ||
                  (!fonts.length
                    ? 'Reading installed Windows font families…'
                    : `${fonts.length} local font families available. No fonts are downloaded.`)}
              </p>
            </>
          )}
          {!valid && (
            <p role="alert">
              Use six-digit hex colors and values within the displayed numeric ranges.
            </p>
          )}
          <div className="button-row">
            <button onClick={() => setDraft(structuredClone(DEFAULT_PREFERENCES))}>
              Restore defaults
            </button>
            <div className="spacer" />
            <button onClick={close}>Cancel</button>
            <button
              className="primary"
              disabled={saving || !valid}
              onClick={() => {
                setSaving(true);
                void run(async () => {
                  await savePreferences(draft);
                  close();
                }).finally(() => setSaving(false));
              }}
            >
              {saving ? 'Saving…' : 'Apply appearance'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
