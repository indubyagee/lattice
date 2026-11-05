# Third-party software

Lattice's original source is licensed under [MIT](../LICENSE). Its dependencies retain their own licenses; the MIT license does not replace those terms.

`npm run build` generates `out/THIRD_PARTY_NOTICES.txt` from the installed production dependencies and the lockfile. It includes their supplied license texts and additional notice files, including Monaco's `ThirdPartyNotices.txt`. Packaging places this file and Lattice's `LICENSE` beside `Lattice.exe`. Keep them with the distribution, together with Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html`.

## Layout engine source

Lattice uses the published, unmodified `elkjs` 0.12.1 package under **EPL-2.0**, one of its offered licenses. The JavaScript is bundled into the application; Lattice does not change the layout engine's source.

- [elkjs corresponding source and build instructions](https://github.com/kieler/elkjs/tree/624ae90aa37110033a8af59c5ccbb292708b4317). This is the `gitHead` reported by the npm registry for `elkjs@0.12.1`.
- [Eclipse Layout Kernel source](https://github.com/eclipse-elk/elk), used by the elkjs build. Consult the matching elkjs release's build configuration and upstream release documentation when rebuilding the engine.
- [EPL-2.0 license](https://www.eclipse.org/legal/epl-2.0/).

DOMPurify offers MPL-2.0 or Apache-2.0; this distribution uses **Apache-2.0** and retains the license file supplied by that package. Electron, Chromium, Monaco, and their incorporated components have additional notices in the files listed above.

Before changing dependencies or redistributing modified versions, review the actual license texts and source availability for the new versions. The generated inventory preserves upstream notices; it is not a legal certification or an inventory of development-only tools.
