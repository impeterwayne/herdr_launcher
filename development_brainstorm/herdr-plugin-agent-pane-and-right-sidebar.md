# Herdr: CodingSpace-style Agent Launchers + Right App Sidebar

> Brainstorm / design notes — 2026-08-21
> Verified against **herdr 0.8.2** (`C:\Users\admin\AppData\Local\Programs\Herdr\bin\herdr`),
> the DeepWiki archive in `docs/deepwiki/herdrdev_herdr/`, the installed
> `herdr-sidebar` plugin, the CodingSpace sources in `D:\Quest\CodingSpace\src`,
> and the `--help` output of the `opencode` / `agy` / `codex` / `claude` CLIs
> installed on this machine.

> **Status: implemented.** This design is built and running as
> `plugins/herdr-launcher/` — see its `README.md` for usage, the verified flag
> table, and the Windows gotchas found while building it. Some findings here were
> corrected in the process (notably: `pane report-metadata` wants the pane id
> before its flags, `pane run` does not set `HERDR_PANE_ID`, injected input only
> reaches a *focused* pane, and a `cmd.exe` shim silently breaks TUI keyboard
> input). The README is the authority where the two disagree.

## Goal

Mimic CodingSpace inside Herdr:

1. **Fast agent launchers** — one keystroke opens OpenCode / Antigravity CLI /
   Codex / Claude Code in permission-skipping (YOLO) mode.
2. **Right-hand sidebar** — a launcher for Antigravity IDE, Antigravity Agent
   Manager, Android Studio, VS Code, file manager, symlink picker, OpenSpec
   setup, and Plane task management.

---

## 1. What a Herdr plugin actually is

Not a UI SDK. Three things glued together:

1. **`herdr-plugin.toml`** — declares `[[actions]]`, `[[panes]]`, `[[events]]`,
   `[[link_handlers]]`, `[[build]]`, `[[startup]]`.
2. **External processes** in any language, spawned with a rich environment:
   - `HERDR_BIN_PATH` — the running `herdr` binary (call back into the CLI)
   - `HERDR_PLUGIN_CONTEXT_JSON` — serialized `PluginInvocationContext`
   - `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`
   - `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_ACTION_ID`, `HERDR_PLUGIN_EVENT`,
     `HERDR_PLUGIN_EVENT_JSON`, `HERDR_PLUGIN_CLICKED_URL`,
     `HERDR_PLUGIN_LINK_HANDLER_ID`
   - `HERDR_ENV=1`, `HERDR_SOCKET_PATH`
3. Those processes drive Herdr back through the **CLI / JSON-RPC socket**.

A "pane" is a PTY running *your* program. There is **no widget API** — you render
the sidebar yourself (ratatui, Ink, Textual, blessed…).

Runtime limits: plugin command stdout/stderr capped at **64 KB**, max **32**
commands in flight, last **200** results kept (`herdr plugin log`). **No sandbox** —
plugins run with full user permissions.

### Relevant CLI surface (verified on 0.8.2)

```
herdr agent list|get|read|send-keys|prompt|rename|focus|wait|attach|start|explain
herdr agent start <NAME> --kind <KIND> --pane <ID> [--timeout MS] [-- <AGENT_ARG>...]
    kinds: pi claude codex gemini cursor devin agy cline omp mastracode opencode
           copilot kimi kiro droid amp grok hermes kilo qodercli qwen maki
herdr agent focus <NAME>            # focus-by-name — panes have no focus-by-id
herdr integration install <TARGET>  # pi omp claude codex copilot devin droid kimi
                                    # opencode kilo hermes qodercli qwen cursor
                                    # mastracode antigravity-cli grok

herdr pane split [PANE_ID] --direction <right|down> --ratio <FLOAT>
    --cwd <PATH> --env KEY=VALUE --right-click <herdr|pane> --focus|--no-focus
herdr pane run <PANE_ID> <COMMAND>...
herdr pane list|get|layout|neighbor|resize|zoom|read|rename|input
herdr pane swap|move|close|send-text|send-keys|wait-output
herdr pane report-agent|report-agent-session|release-agent|report-metadata

herdr tab create [--workspace ID] [--cwd PATH] [--label TEXT] [--env K=V] [--focus]

herdr plugin install|uninstall|link|unlink|enable|disable|list|config-dir|log
herdr plugin action list|invoke
herdr plugin pane open|focus|close
herdr plugin pane open --plugin <ID> --entrypoint <ID>
    --placement <overlay|split|tab|zoomed>
    --workspace <ID> --target-pane <PANE> --direction <right|down>
    --cwd <PATH> --env KEY=VALUE --focus

herdr server reload-config      # apply config.toml without restarting
herdr config reset-keys         # escape hatch if you brick your keybindings
```

> The docs mention a `popup` placement for plugin panes, but the 0.8.2
> `plugin pane open --placement` enum only exposes `overlay|split|tab|zoomed`.
> Popups are reachable via `[[keys.command]] type = "popup"`.

---

## 2. Part A — Agent launchers (config only, no plugin needed)

CodingSpace's `TOOL_TABS` (`src/renderer/app.ts:482-537`) maps 1:1 onto
`herdr agent start`. All four agents are natively supported `--kind` values, and
everything after `--` is forwarded to the agent process.

### YOLO / permission-skip flags — verified against installed CLIs

| Launcher | `--kind` | flags after `--` | source of truth |
| :--- | :--- | :--- | :--- |
| OpenCode (auto) | `opencode` | `--auto` | `opencode --help`: "auto-approve permissions that are not explicitly denied (dangerous!)" |
| Antigravity CLI (YOLO) | `agy` | `--dangerously-skip-permissions` | `agy --help`: "Auto-approve all tool permission requests without prompting" |
| Codex (YOLO) | `codex` | `--dangerously-bypass-approvals-and-sandbox` | `codex --help`: "Skip all confirmation prompts and execute commands without sandboxing" |
| Claude Code | `claude` | `--dangerously-skip-permissions` | `claude --help`: "Bypass all permission checks." |

Notes per agent:

- **opencode `--auto`** auto-approves permissions *that are not explicitly denied* —
  deny rules in your opencode config still win. YOLO with a floor, not a total bypass.
- **agy `--sandbox`** is the *inverse* flag (opt-in terminal restrictions), so plain
  `agy` is already unsandboxed; `--dangerously-skip-permissions` only removes the
  prompts. `--mode accept-edits` is the softer middle ground.
- **claude** also exposes `--allow-dangerously-skip-permissions` ("Enable bypassing
  all permission checks") and `--permission-mode bypassPermissions` — reach for those
  if the plain flag is refused in a given environment.
- **codex** additionally has `--dangerously-bypass-hook-trust` and
  `-a/--ask-for-approval <POLICY>` / `-s/--sandbox <MODE>` for finer control.

Mirror CodingSpace's `warningBadge: 'danger'` in the sidebar labels — these
bypass approval gates, so make them visibly distinct from the safe launchers.

### Prerequisite: install the official integrations

```
herdr integration install claude
herdr integration install codex
herdr integration install opencode
herdr integration install antigravity-cli
```

This is what enables `AgentResumePlan` — after a server restart Herdr re-execs the
agent with its native session id (e.g. `claude --resume <id>`) instead of leaving a
dead pane.

### Keybinding, one per launcher

`config.toml` lives at `%APPDATA%\herdr\config.toml` on this machine.

```toml
[[keys.command]]
key = "prefix+alt+c"
type = "shell"                     # shell | pane | popup | plugin_action
command = "pwsh -NoProfile -File C:\\...\\launch-agent.ps1 claude-yolo claude -- --dangerously-skip-permissions"
description = "Claude (skip permissions)"
```

Type choice matters:

- `pane` — a **temporary zoomed** pane that closes when the command exits → wrong for a persistent agent
- `popup` — session-modal float, doesn't change tab layout; gets `HERDR_ACTIVE_PANE_ID` but **not** `HERDR_PANE_ID`
- `shell` — runs **detached in the background**; the one that can drive the CLI
- `plugin_action` — `command = "myplugin.agent-claude-yolo"` (qualified id when action ids aren't globally unique)

Custom commands receive `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`,
`HERDR_ACTIVE_WORKSPACE_ID`, `HERDR_ACTIVE_TAB_ID`, `HERDR_ACTIVE_PANE_ID`,
`HERDR_ACTIVE_PANE_CWD`.

### The shared launch script

```
1. herdr agent focus <name>          # already running? jump to it, done.
2. herdr pane split --current --direction right --ratio 0.5 --focus \
       --cwd $HERDR_ACTIVE_PANE_CWD  # -> parse pane_id
3. herdr agent start <name> --kind <kind> --pane $id -- <yolo flags>
```

Step 1 is what makes it *feel* fast — the second press focuses the live agent
instead of cold-starting a new one. That is CodingSpace's tab-reuse behaviour.

Why `agent start` instead of `pane run`:

- waits for **interactive readiness** before returning (30 s default, `--timeout`
  3 000–300 000 ms)
- registers the agent so Herdr's built-in sidebar shows `working` / `blocked` /
  `done` / `idle` with toasts and sounds
- makes the agent addressable by name: `agent focus`, `agent prompt`,
  `agent wait --until idle`, `agent attach`, `agent read`
- enables session resume via the installed integration

Constraint: the pane **must be at an interactive shell prompt** when
`agent start` runs — hence split-then-start, never split-with-command.

---

## 3. Part B — Right sidebar as an app launcher

CodingSpace's Quick Launcher, not a file explorer. Most items are **detached GUI
processes**, so the sidebar TUI is a menu that shells out.

### Plugin structure

```toml
[[panes]] id = "launcher"  placement = "split"    # right-docked persistent menu
[[panes]] id = "symlink"   placement = "overlay"  # modal picker
[[panes]] id = "openspec"  placement = "overlay"  # modal setup
[[panes]] id = "plane"     placement = "tab"      # task list needs room

[[actions]] id = "agent-opencode-auto"   # one per agent launcher
[[actions]] id = "agent-agy-yolo"
[[actions]] id = "agent-codex-yolo"
[[actions]] id = "agent-claude-danger"
[[actions]] id = "open-antigravity"      # one per GUI app
[[actions]] id = "open-antigravity-agent"
[[actions]] id = "open-android-studio"
[[actions]] id = "open-vscode"
[[actions]] id = "open-explorer"
```

The elegant bit: sidebar menu rows invoke `herdr plugin action invoke <id>` — the
**same** code path as the keybinding. One definition, two entry points, exactly
like CodingSpace's `TOOL_TABS` carrying both `key` and `action`.

### Right-docking is the easy direction

`herdr pane split` only goes `right|down`. `herdr-sidebar` docks LEFT and therefore
has to split the leftmost pane and `pane swap` the result into the left slot.
Docking **right** skips the swap entirely:

1. `herdr pane layout --pane $FOCUSED` → find the tab's **rightmost** pane
2. `herdr pane split $RIGHTMOST --direction right --ratio 0.75 --no-focus --cwd $CWD`
   - **`--ratio` is the ORIGINAL pane's share**, so `0.75` leaves a 25% column
3. `herdr pane run $NEW "<absolute path to your TUI>"`
4. `herdr pane rename $NEW 'Launcher'`
5. Focus: `herdr pane zoom $NEW --on` then `--off` (no focus-by-id for panes)

`pane split --right-click <herdr|pane>` controls right-click routing — relevant if
you want a mouse-clickable menu.

### Ownership / idempotency (for the `[[events]]` ensure script)

- mark the pane with `herdr pane report-metadata` **tokens** (token = heartbeat)
- `herdr pane rename` for the human label
- **label present but token missing = corpse** → close and replace
- hold a lock while opening and block until the spawned TUI stamps its token, so
  queued event invocations observe a **live** pane and no-op instead of
  replace-looping (reference polls `pane list --json` for `.tokens`, 30 × 200 ms)

Hook all five events. Why (from `herdr-sidebar`'s own notes):

- `tab.created` / `workspace.created` fire when a **restarted server restores a
  session** — the resumed tab is already focused, so no focus *transition* happens
  and no `tab.focused` / `workspace.focused` is ever emitted.
- `pane.focused` heals resumed corpses the moment the user interacts, because a
  **client attach emits no tab/workspace events at all**.

---

## 4. Reuse CodingSpace — extract a CLI, don't reimplement

Symlink management, OpenSpec deploy, and Plane already work in CodingSpace and the
logic is mostly Electron-agnostic TypeScript. Add `src/cli.ts`, bundle with the
existing esbuild setup → `dist/cli.js`, and expose:

```
cs launch antigravity|antigravity-agent|android-studio|vscode|explorer --path <dir>
cs symlink list|add|remove --worktree <path>
cs openspec deploy --platform claude|codex|opencode --worktree <path>
cs plane issues --json
cs resolve-launch <command> [args...]
```

The Herdr sidebar then becomes a thin menu over `cs`. One source of truth; both
apps improve together.

### What to lift, with locations

| Concern | CodingSpace source |
| :--- | :--- |
| `resolveToolLaunch` — `where.exe` → prefer `.cmd`/`.bat` → wrap in `cmd.exe /d /c` | `src/main/main.ts:38-80` |
| GUI path detection: Antigravity IDE (3 candidates incl. `bin\antigravity-ide.cmd`), Antigravity Agent (`Programs\antigravity\Antigravity.exe`), `studio64.exe` (3), `Code.exe` (3) | `src/main/main.ts:937-1024` |
| Explorer / IDE launch IPC handlers | `src/main/main.ts:872-1090`, `src/main/preload.ts:31-35` |
| Symlink manager + `.git/info/exclude` writes | `src/renderer/modals/symlinkModal.ts`, `src/application/workspaceService.ts` |
| OpenSpec platform table (`.claude\skills`, `.codex\skills`, `.opencode\skills`+`commands`, `openspec-*/` exclude patterns) | `src/renderer/app.ts:2800-2995` + `toolkits/OpenSpec` |
| Plane API client (`PlaneConfig` baseUrl / workspaceSlug / projectId / apiKey, issues, states) | `src/renderer/services/planeService.ts` |
| Configured override paths (`androidStudioPath`, `antigravityPath`, `antigravityAgentPath`) | `src/application/workspaceConfigStore.ts:17-19` |

Store the Plane API key in `herdr plugin config-dir <plugin-id>` — never in the
plugin repo.

### Worth questioning before building a TUI

For symlink-pick and OpenSpec-setup, `[[keys.command]] type = "popup"` gives a
session-modal terminal that runs an interactive picker and vanishes on exit. If
the sidebar is only ever a launch menu, popups + keybinds may cover most of it
with zero TUI code. The sidebar earns its screen space if you want the item list
**visible**, like CodingSpace's button row.

---

## 5. Windows landmines

All documented in `herdr-sidebar`'s manifest — its author hit every one.

| Problem | Fix |
| :--- | :--- |
| Herdr **cannot spawn a relative `[[panes]]` command on Windows** — resolves the program against herdr's own directory → `ERROR_PATH_NOT_FOUND` | Launch by **absolute path** via `pane split` + `pane run`. The declarative `[[panes]]` entry ends up linux/macOS-only. |
| `plugin_root` is reported as a `\\?\` **verbatim path** | Strip the leading 4 chars before joining |
| **Any console-subsystem process in an event-hook chain flashes a Windows Terminal window on every focus event** (Win 11) | `wscript //B` → GUI-subsystem sidecar → socket API. Skipping this is the one that will make you hate life. |
| PowerShell 5.1 decodes Herdr's UTF-8 JSON with the legacy console code page → corrupt JSON on non-ASCII titles/paths | Set `[Console]::OutputEncoding` and `$OutputEncoding` to `UTF8Encoding($false)` |
| `pane run` arg quoting — a bare path splits on spaces in the install path | PS **call operator** with escaped quotes: `& \"$Bin\" --view git` |
| **Action ids must be globally unique across platforms** | Suffix `-windows` and gate both variants with item-level `platforms = [...]` |
| Discovering your own plugin root from a script | `herdr plugin list --json`, filter `.result.plugins` for your `plugin_id`, read `.plugin_root`, strip `\\?\` |
| npm shims vs real exes — `opencode` is `AppData\Roaming\npm\opencode.cmd`; `agy` is `AppData\Local\agy\bin\agy.exe` | The `cmd.exe /d /c` wrapping is needed for opencode / codex / claude, **not** for agy |
| `herdr agent start --kind codex` / `--kind opencode` fails on Windows: it types `Start-Process -FilePath <kind> -NoNewWindow`, PATH hands back npm's **extensionless sh script** before the `.cmd`, and CreateProcess answers `%1 is not a valid Win32 application`. Falling back to `pane run` "works" but loses the agent's herdr name, state and resume; putting the `.cmd` first on PATH loses the keyboard (see the `cmd.exe` shim row) | Give Start-Process a real image: read the `.cmd` to find the native binary npm hid behind it, **hardlink** it to `<config-dir>/shims/<kind>.exe`, and create the pane with `pane split --env PATH=<shims>;...` (`lib/exe.js`). Add codex's `CODEX_MANAGED_*` vars via `--env` since that path skips its Node wrapper |
| GUI apps launched from the sidebar pane die or block with the PTY | Spawn **detached** (`Start-Process -WorkingDirectory $cwd`) |
| Symlink creation needs Developer Mode or elevation | Reuse whatever CodingSpace already does; junctions avoid the privilege check for directories |

---

## 6. Language choice for the pane TUI

`herdr-sidebar` is Rust + ratatui. Given CodingSpace is already TS + Node 20
(esbuild, xterm.js, node-pty), **Node + Ink** is the lower-friction path, and the
PTY-hosted pane process does **not** suffer the console-flash problem — that only
affects event hooks. Trade-off is shipping a runtime: `[[build]]` can run
`npm install`, but a packaged `.exe` keeps the absolute-path spawn simple.

---

## 7. Suggested build order

1. **Agent launchers first, config only.** Four `[[keys.command]]` entries plus the
   shared `launch-agent.ps1`. No plugin, no TUI. `herdr server reload-config` to
   apply. This alone delivers the CodingSpace new-tab menu.
2. `herdr plugin link <dir>` a skeleton with one `[[actions]]` toggle and one
   `[[panes]]` entry. **Link, don't install** — that's the dev loop.
3. Get the **right-dock split → run → zoom-focus** toggle working with a dumb
   `cmd /k` as the pane program. No TUI yet.
4. Extract `cs` CLI from CodingSpace (`launch` + `resolve-launch` first — they
   unblock the whole GUI-app half of the sidebar).
5. Swap in the real TUI menu; wire rows to `herdr plugin action invoke`.
6. Add `[[events]]` + ensure-script + metadata-token ownership **last** — that's
   where all the concurrency bugs live.
7. Add a `redeploy` action (close all owned panes in every workspace so they
   respawn on the latest build). You will want it every rebuild.

Debug loop: `herdr plugin log` for captured stdout/stderr and exit codes;
`herdr-server.log` in `%APPDATA%\herdr\` for the server side.

---

## Source references

- `docs/deepwiki/herdrdev_herdr/chapters/29_7-plugin-system.md`
- `docs/deepwiki/herdrdev_herdr/chapters/30_7.1-plugin-authoring-and-manifest.md`
- `docs/deepwiki/herdrdev_herdr/chapters/31_7.2-plugin-runtime-and-marketplace.md`
- `docs/deepwiki/herdrdev_herdr/chapters/23_5.3-sidebar-navigator-and-agent-panel.md`
- `docs/deepwiki/herdrdev_herdr/chapters/39_10.1-keybindings-configuration.md`
- `docs/deepwiki/herdrdev_herdr/chapters/28_6.3-agent-automation-api.md`
- https://herdr.dev/docs/configuration — verified `[[keys.command]]` syntax
- Reference plugin: `%APPDATA%\herdr\plugins\github\herdr-sidebar-7ff2582a7c8a\plugins\herdr-sidebar`
  (`alexarthurs/herdr-sidebar`, subdir `plugins/herdr-sidebar`) — read its
  `herdr-plugin.toml` comments and `scripts/open-git.ps1` before writing anything
- CodingSpace: `D:\Quest\CodingSpace\src` (see the reuse table in section 4)
- Agent flags: `opencode --help`, `agy --help`, `codex --help`, `claude --help`
  as installed on this machine, 2026-08-21
