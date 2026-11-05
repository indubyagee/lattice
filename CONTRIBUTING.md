# Contributing

Use the pinned Node and npm versions and the setup commands in [README.md](README.md). Keep changes focused and include the validation relevant to their behavior.

The domain, projections, validation, artifact comparison, exports, and provider contracts must remain independent of Electron, React, and host services. Electron main owns semantic transactions. Preserve revision checks, typed preload methods, sender validation, context isolation, and sandboxing.

File writes require hash preconditions and recoverable staging. Preserve external file changes and unknown definition data. Keep Git inspection read-only. Simulated AI proposals cannot record human approval or deterministic validation passes.

Run `npm run typecheck`, `npm run lint`, and `npm test` for code changes. Use the Electron and packaging tests when changing interface behavior or distribution. Do not describe an execution path as verified unless it was run.

Keep personal projects, private source documents, task checklists, conversations, local agent instructions, credentials, and generated evidence outside version control. Use synthetic fixtures. Run `npm run release:check` before committing and `npm run release:history` before sharing Git history.

Do not enable publishing or add a remote as part of routine build or test work. Lattice is licensed under [MIT](LICENSE). Contributions must be compatible with that license. Preserve dependency licenses and notices; see [third-party software](docs/third-party.md).
