# Contributing

1. Use the pnpm version declared in `package.json`.
2. Keep dependencies exact and justify new runtime packages.
3. Add tests for path policy, symlinks and newly visible file types.
4. Run `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm audit`.
5. Do not add real workspace paths, credentials or captured private content to
   fixtures, issues or pull requests.

Features that introduce writes, shell execution or unaudited HTML rendering are
outside the project scope.
