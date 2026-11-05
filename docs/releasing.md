# Preparing a release

These commands prepare local artifacts. Committing, pushing, creating GitHub releases, and uploading files are separate manual actions by the repository owner.

## Validate the checkout

Use the pinned Node and npm versions and installation commands in [README.md](../README.md).

```powershell
npm run verify
npm run format:check
npm run release:check
npm audit --omit=dev
npm audit --audit-level=high
```

Review the full audit output, including moderate findings. The current toolchain advisory and its exposure assessment are recorded in [SECURITY.md](../SECURITY.md). Avoid forced or cross-major upgrades without checking compatibility.

`release:check` inspects tracked and unignored source candidates, including tracked files that now match `.gitignore`. It also requires the MIT license and consistent package/lockfile release metadata. The allowlist is in `scripts/check-release.mjs`; update it deliberately if adding a public document or asset.

Review candidate filenames before the initial commit:

```powershell
git status --short --untracked-files=all
git add --dry-run .
```

Keep personal projects, conversation history, task records, local agent instructions, credentials, design source files, and test evidence outside the source set. Local evidence belongs in an ignored location such as `docs/evidence/` or outside the checkout. Automated checks cannot prove that arbitrary prose or artwork contains no confidential material.

## Build the artifacts

```powershell
npm run release:source
npm run package:win
```

For version 0.3.1, these produce:

- `dist/lattice-0.3.1-source.tar.gz`: reviewed source, MIT license, documentation, and lockfile; no Git metadata or installed dependencies.
- `dist/Lattice-0.3.1-win-x64.zip`: unsigned portable Windows application, project license, generated production dependency notices, and Electron/Chromium notices.

The source archive requires system `tar`. Packaging runs with `--publish never`. Preserve older artifacts if needed, but share only files for the version you have just verified.

Extract the ZIP into a new temporary directory and test the actual distribution:

```powershell
$latticeVersion = (Get-Content -Raw -LiteralPath package.json | ConvertFrom-Json).version
$latticeSmoke = Join-Path ([System.IO.Path]::GetTempPath()) ("lattice-release-smoke-" + [guid]::NewGuid())
Expand-Archive -LiteralPath "dist/Lattice-$latticeVersion-win-x64.zip" -DestinationPath $latticeSmoke
$env:LATTICE_PACKAGED_EXE = Join-Path $latticeSmoke 'Lattice.exe'
npx --no-install playwright test tests/e2e/package.spec.ts
Remove-Item Env:LATTICE_PACKAGED_EXE
```

The smoke test checks bundled notices and icons, application launch, preferences, the example project, save, layout, export, renderer errors, and navigation isolation. Keep the extracted application and test evidence local.

Generate checksums for exactly the intended release assets:

```powershell
$latticeVersion = (Get-Content -Raw -LiteralPath package.json | ConvertFrom-Json).version
$latticeFiles = @(
  "dist/lattice-$latticeVersion-source.tar.gz",
  "dist/Lattice-$latticeVersion-win-x64.zip"
)
foreach ($latticeFile in $latticeFiles) {
  $latticeHash = (Get-FileHash -LiteralPath $latticeFile -Algorithm SHA256).Hash.ToLowerInvariant()
  "$latticeHash  $([System.IO.Path]::GetFileName($latticeFile))" |
    Set-Content -LiteralPath "$latticeFile.sha256" -Encoding ascii
}
```

Checksums detect changed downloads; they do not sign or authenticate the publisher.

## Initial commit and GitHub setup

Before making your manual initial commit, choose the Git author identity you intend to publish. If you prefer email privacy, use the exact GitHub-provided `noreply` address from your account settings. The history checker flags other email domains for review.

Review the staged diff after staging files yourself, then make the initial commit. Run:

```powershell
npm run release:history
```

Before the first commit this reports zero reachable commits, so it cannot yet review the identity or contents of that future commit. It reads reachable commits, file blobs, and commit metadata; it does not certify reflogs, unreachable objects, or Git configuration as shareable. Ignore rules and file deletion do not sanitize existing history. Any history replacement needs the owner's explicit approval.

When you create the GitHub repository manually:

1. Push only the reviewed repository. Avoid uploading the entire development folder, `dist/`, local project data, or private history backups.
2. Let **Windows verification** complete on the uploaded `main` branch. The workflow has no publishing step; hosted CI still needs its first actual run before it can be described as passing.
3. Add the real repository URL and reporting channel to documentation if needed. No repository owner, remote URL, download URL, or private contact is assumed by this checkout.
4. Configure repository settings such as private vulnerability reporting and required checks as desired.

For a manual GitHub release, use a version tag matching `package.json`, describe the application as experimental and unsigned, and attach only the verified version's source archive, Windows ZIP, and matching checksum files. Keep all notices with the application. Consult [third-party licensing and source information](third-party.md) before redistributing modified dependencies.
