# Changelog

All notable changes to Workspace Portal are documented here.

## [0.1.0] - 2026-08-12

### Added

- Curated navigation across configured workspace roots.
- Safe rendering for Markdown, MDX, source files and allowed PDFs.
- Git-aware project catalog with local branch snapshots that never run
  `checkout`.
- Bounded full-text search across visible files.
- Markdown and MDX export through the browser's PDF print flow.
- Public product overview and hardened container deployment.

### Security

- Positive root and file-type allowlists, traversal and symlink escape checks,
  sensitive filename filtering and bounded input sizes.
- Read-only workspace mount, non-root container, dropped capabilities and
  strict response headers.
- CI quality gate with frozen dependencies, typecheck, tests, build and audit.
