# Security policy

Workspace Portal is a read-only viewer, but confidentiality remains its primary
security boundary. A read-only leak is still a serious incident.

## Deployment baseline

- Keep the service behind a private network or authenticated reverse proxy.
- Mount the source workspace read-only.
- Run the container as a non-root user with all Linux capabilities dropped.
- Use a positive root allowlist; do not mount a home directory as a shortcut.
- Never expose secret stores, environment files, private keys or Git internals.
- Keep `.git`, caches and generated directories in `excludeSegments`; useful
  dot-directories may be visible only through the existing file-type and
  sensitive-name allowlists.
- Keep image preview restricted to PNG, JPEG and WebP, validate magic bytes and
  maintain a bounded `maxImageBytes`; do not add SVG to the raster allowlist.
- Keep the lockfile committed and require a clean `pnpm audit` before releases.

## Reporting

Do not open a public issue containing real paths, file contents or credentials.
Provide a minimal synthetic reproduction and the affected version.
