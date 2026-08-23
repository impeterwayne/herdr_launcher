# Herdr-Launcher Agent Rules & Implementation Guidelines

See root [`AGENTS.md`](../../AGENTS.md) for full workspace rules.

## Core Rules Summary

1. **Self-Testing**: Run `node test/self-test.js` after every code change. All tests must pass before completing tasks.
2. **Workspace Tool Popups**: All modal tools (Symlinks, OpenSpec setup, Plane tasks) must open as session-modal popups (`placement = "popup"`) via `herdr plugin pane open --plugin herdr-launcher --entrypoint <tool>-popup`, taking zero split columns.
3. **Dry-Run**: Every script in `bin/` must implement `--dry-run` and return structured JSON.
4. **Zero Dependencies**: Vanilla Node.js CommonJS only.
5. **Windows Compatibility**: Always strip `\\?\` prefix from `process.cwd()` in `node -e` bootstraps.
