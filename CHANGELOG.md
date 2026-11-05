# Changelog

## 0.3.1

- Source is licensed under MIT. Windows packages include Lattice's license and production dependency notices.
- Windows CI verifies source boundaries, dependency advisories, tests, archives and the extracted application without publishing releases.
- Updated the development runtime to Node.js 24.22.2 and the desktop runtime to Electron 45.2.3 for upstream fixes.
- System connection visibility can be toggled in the canvas toolbar and starts hidden.
- Graph tooltips are optional and start off, with controls in the toolbar and tooltip settings.
- Both graph preferences persist locally without changing project data or exports.
- Interface, favicon, window and Windows executable icons use the supplied `icon-on-light` and `icon-on-dark` assets.

## 0.3.0

- Application and distribution branding use Lattice.
- Theme-aware interface and window icons use the supplied light and dark assets; the Windows executable uses the dark icon.
- Light and dark palettes, local font settings, configurable snapping, contextual tooltips, and a searchable user guide.
- Synthetic development example, public documentation, and source-distribution checks.
- Export redaction also covers validation messages, embedded local paths, and additional credential fields.
- Patched the editor's DOMPurify dependency to 3.4.17.

## 0.2.0

- Presentation containers, nested views, semantic graph cues, and separate layout history.

## 0.1.0

- Shared semantic authoring across architecture, behavior, information, and validation views.
- Revision-aware commands, separate view layouts, draft recovery, associated-file ownership, and explicit reconciliation.
- Declarative type/relationship packages, pinned assemblies and selective upgrades, and traceable draft/readiness exports.
- Simulated AI proposal review. Live-provider integration remains deferred.

See README.md for supported workflows, validation commands, and current limitations.
