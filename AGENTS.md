# Agent Development Rules & Guidelines

Instructions and guidelines for AI coding agents implementing features and maintaining the `herdr_research` workspace and `herdr-launcher` plugin.

---

## 1. Feature Implementation Rules

### Rule 1: Always Run & Update Self-Tests
- **Every feature or modification MUST pass self-tests.**
- Run self-tests with:
  ```bash
  node scripts/self-test.js
  # or
  node plugins/herdr-launcher/test/self-test.js
  ```
- When adding a new tool, action, or agent capability, add corresponding assertions to `plugins/herdr-launcher/test/self-test.js` covering syntax, manifest declarations, and `--dry-run` outputs.

### Rule 2: Workspace Tools Must Use Popups (Not Split Panes)
- Workspace tools (**Symlinks**, **OpenSpec setup**, **Plane tasks**, and future workspace modal utilities) **MUST** be implemented as session-modal popups (`placement = "popup"`).
- **Do NOT** split the layout or create new panes in the split tree for modal workspace utilities.
- Popups take zero columns from the layout while closed and preserve existing split trees intact.
- Launch popups via `herdr plugin pane open --plugin herdr-launcher --entrypoint <id>-popup`.
- Ensure popup views support clean dismissal on both `esc` and `q` (`actions` footer should include `[esc close]`).

### Rule 3: Support `--dry-run` on All CLI Entrypoints
- Every command script under `plugins/herdr-launcher/bin/` (`tool-launch.js`, `agent-launch.js`, `app-open.js`, `popup-launcher.js`, `stack-mode.js`, `focus-mode.js`, `startup.js`, etc.) **MUST** support the `--dry-run` flag.
- `--dry-run` output must be machine-readable JSON printed to `stdout` containing the resolved action and command parameters without modifying session state.

### Rule 4: Zero External npm Dependencies
- The plugin must remain zero-dependency: only standard Node.js built-in modules (`node:fs`, `node:path`, `node:child_process`, `node:net`, `node:os`) are allowed.
- No `package.json` or `node_modules` build step should be introduced.

---

## 2. Platform & Windows Architecture Rules

### Windows Extended Paths (`\\?\`)
- Herdr plugin commands on Windows inherit working directories with extended `\\?\` verbatim prefixes.
- `[[panes]]` and `[[startup]]` commands in `herdr-plugin.toml` must strip `\\?\` before resolving paths:
  ```javascript
  const p = process.cwd();
  const r = p.startsWith("\\\\?\\") ? p.slice(4) : p;
  ```
- When using `node -e` inline bootstraps, properly assign `process.argv` before requiring target scripts:
  ```javascript
  process.argv = ["node", r + "/bin/tool-pane.js", "<tool-key>", "--popup"];
  require(r + "/bin/tool-pane.js");
  ```

### No `cmd.exe` Shims for Interactive TUIs
- Never wrap interactive TUI processes in `cmd.exe` shims (e.g. `cmd /c ...`). ConPTY drops keyboard input when cmd sits between the PTY and Node.
- Use direct Node execution or native executable targets.

### Native Shims for npm-Installed Agents
- npm-installed agents (`opencode`, `codex`) write `.cmd` / `.ps1` / extensionless `.sh` scripts.
- `herdr agent start` launches via `Start-Process -NoNewWindow`, which fails on script shims.
- Use `lib/exe.js` to locate the underlying native binary, create hardlink shims in `<config-dir>/shims/<kind>.exe`, and prepend them via `--env PATH=...`.

### Detached GUI Spawning
- Desktop applications (VS Code, Android Studio, Antigravity IDE, Explorer) must be spawned detached (`detached: true, stdio: 'ignore'`) without `windowsHide: true`.
- Never use `windowsHide: true` for GUI binaries as it prevents Windows from displaying the GUI window.

### Glyph & Column Calculations
- Plane-15 Nerd Font glyphs are 2 UTF-16 code units but take 1 visual column.
- Always use `displayWidth()` from `lib/tui.js` rather than `.length` for cell padding and layout arithmetic.

---

## 3. Quick Reference Commands

| Task | Command |
| :--- | :--- |
| **Run Self-Tests** | `node scripts/self-test.js` |
| **Syntax Validation** | `Get-ChildItem -Recurse -Filter *.js \| ForEach-Object { node -c $_.FullName }` |
| **Symlinks Popup (dry-run)** | `node plugins/herdr-launcher/bin/tool-launch.js symlinks --dry-run` |
| **OpenSpec Popup (dry-run)** | `node plugins/herdr-launcher/bin/tool-launch.js openspec --dry-run` |
| **Plane Popup (dry-run)** | `node plugins/herdr-launcher/bin/tool-launch.js plane --dry-run` |
| **Launcher Popup (dry-run)** | `node plugins/herdr-launcher/bin/popup-launcher.js --dry-run` |
| **Link Plugin to Herdr** | `herdr plugin link D:\Quest\herdr_research\plugins\herdr-launcher` |
| **Reload Herdr Config** | `herdr server reload-config` |
