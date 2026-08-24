# Herdr-Launcher Agent Rules & Implementation Guidelines

See root [`AGENTS.md`](../../AGENTS.md) for full workspace rules.

## Core Rules Summary

1. **Self-Testing**: Run `node test/self-test.js` after every code change. All tests must pass before completing tasks.
2. **Sidebar for Launcher & Popups for Tools**: The main launcher operates in the right-docked sidebar (`launcher-sidebar`, `placement = "split"`). Workspace tools (Symlinks, OpenSpec setup, Plane tasks) open as modal popups (`placement = "popup"`).
3. **Dry-Run**: Every script in `bin/` must implement `--dry-run` and return structured JSON.
4. **Zero Dependencies**: Vanilla Node.js CommonJS only.
5. **Windows Compatibility**: Always strip `\\?\` prefix from `process.cwd()` in `node -e` bootstraps.
