# Security and privacy

Lattice stores project data and preferences locally. The renderer is sandboxed and context-isolated, with Node integration disabled. Main-process methods validate IPC senders. Workspace file access checks relative paths and resolved filesystem boundaries.

There is no live AI provider, hosted backend, telemetry service, cloud sync, or automatic updater in this version. The AI panel uses a simulated provider. Dependencies and the desktop runtime are downloaded during development setup.

Project descriptions, instructions, skill bodies, and explicitly included supporting files can contain sensitive text. Export filters remove recognized credential fields and machine paths; they are a safeguard, not a guarantee that arbitrary prose is safe to publish. Inspect previews and resulting files before sharing them.

`npm run release:check` scans the source candidate list for excluded paths, common credential patterns, machine-specific paths, unsafe links, and unexpected public assets. It reports locations without printing matching values. `npm run release:history` also checks reachable Git history and commit metadata. These are heuristic checks, not a comprehensive security audit.

The source archive command uses a reviewed file list and includes no `.git` directory, local agent instructions, task records, conversation logs, recovery data, dependencies, build artifacts, or generated evidence. Desktop packaging includes compiled application files, production dependencies, supplied PNG icons, Lattice's MIT license, and [third-party notices](docs/third-party.md).

Do not put credentials or private projects in public issues, screenshots, test traces, or attachments. Use a maintainer-approved private reporting channel for sensitive findings. GitHub private reporting can be configured when a repository is created; it is not configured by this checkout.

If a real credential has been shared, revoke or rotate it through the issuing service. Removing a file from the working tree does not remove it from Git history.

## Dependency review — 2026-11-05

The development runtime is pinned to Node.js 24.22.2, after the [October Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). The desktop runtime is pinned to [Electron 45.2.3](https://github.com/electron/electron/releases/tag/v45.2.3), which incorporates additional upstream Chromium and related fixes. These are runtime version checks, not a complete vulnerability assessment.

DOMPurify is pinned to 3.4.17 through the editor override. A fresh `npm audit --omit=dev` reports no known production dependency vulnerabilities at this review. An npm audit does not cover every issue in the bundled Electron/Chromium runtime or application code.

The full audit reports 14 moderate affected-package entries from [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) in transitive minimatch dependencies used by lint and packaging tools. The advisory concerns attacker-controlled glob patterns with `optimizationLevel >= 2`; the inspected direct tool callers do not set that option. These tools are development dependencies, outside the production dependency tree. This limits exposure but does not prove that every transitive call is unreachable. Use trusted build inputs. A cross-major minimatch override has been deferred to avoid changing several tools' dependency contracts; review upstream fixes by **2026-11-18** and before a subsequent release.
