# herdr-launcher

CodingSpace's launcher, rebuilt for herdr: one keystroke opens a coding agent in
permission-skipping mode, and a right-docked sidebar launches the apps and
workspace tools you actually use.

Built and verified against **herdr 0.8.2** on Windows 11. Zero npm dependencies —
plain CommonJS run by the system `node`, so there is no build step.

## Install

```
herdr plugin link D:\Quest\herdr_research\plugins\herdr-launcher
```

Link (not install) is the dev loop: edits take effect on the next invocation.

Then copy `config.example.toml` into `%APPDATA%\herdr\config.toml` and apply it:

```
herdr server reload-config
```

If a binding ever locks you out: `herdr config reset-keys`.

## Keys

| Key | Does |
| :--- | :--- |
| `prefix+a` | open the launcher popup (recommended) |
| `prefix+shift+a` | toggle the docked sidebar (right edge) |
| `prefix+z` | focus mode: one work pane, launcher still visible |
| `prefix+alt+l` | Symlinks, in a pane of its own |
| `prefix+alt+s` | OpenSpec setup, in a pane of its own |
| `prefix+alt+p` | Plane tasks, in a pane of its own |
| `prefix+alt+o` | OpenCode `--auto` |
| `prefix+alt+g` | Antigravity CLI `--dangerously-skip-permissions` |
| `prefix+alt+x` | Codex `--dangerously-bypass-approvals-and-sandbox` |
| `prefix+alt+c` | Claude `--dangerously-skip-permissions` |
| `prefix+alt+v` | open VS Code here |
| `prefix+alt+e` | open File Explorer here |

`prefix` is `ctrl+b` unless you changed it. Everything is a prefix binding, so
nothing can intercept normal typing in a pane.

**`prefix+z` needs herdr's built-in zoom moved out of the way first.** `zoom` in
the `[keys]` table defaults to `prefix+z`, and a built-in binding **wins over a
`[[keys.command]]` one for the same chord** — silently: the config reloads with
no diagnostics, the press zooms as it always did, and `herdr plugin log` shows
the action was never invoked. `config.example.toml` therefore ships

```toml
[keys]
zoom = "prefix+shift+z"
```

which frees the chord for focus mode and keeps raw zoom one key away. `[keys]`
has to come **before** the `[[keys.command]]` entries: TOML will not accept a
table defined after its own sub-table array.

## Agent launchers

Every press starts another instance. herdr agent names are unique, so the second
`codex-yolo` in a workspace registers as `codex-yolo-wa-2` (pane label
`codex #2`), the third as `-3`, and so on — they run side by side, each
with its own herdr name, state and resume.

Pass `--reuse` for jump-back behaviour instead: it focuses the base instance if
it is already running and only launches when nothing is there.

| Launcher | kind | flags | verified against |
| :--- | :--- | :--- | :--- |
| opencode | `opencode` | `--auto` | `opencode --help` |
| antigravity | `agy` | `--dangerously-skip-permissions` | `agy --help` |
| codex | `codex` | `--dangerously-bypass-approvals-and-sandbox` | `codex --help` |
| claude | `claude` | `--dangerously-skip-permissions` | `claude --help` |

These are the only launchers, by design — there are no prompts-intact variants in
the menu or the manifest. Run the agent CLI directly if you want approvals back.
That is also why a row is just the agent's name in lowercase and its mark: with
one entry per agent there is nothing to tell apart, so the flag lives in this
table and the group header (`AGENTS · YOLO`) carries the warning for all four
instead of a badge on every row.
Flags live in one table, `lib/agents.js` — re-check them after upgrading an agent
CLI.

Notes worth knowing:

* `opencode --auto` auto-approves only what is **not explicitly denied**, so deny
  rules in your opencode config still apply.
* `agy --sandbox` is the *inverse* flag (opt-in terminal restrictions); plain
  `agy` is already unsandboxed, and the YOLO flag only removes the prompts.
* If Claude ever refuses the flag, try `--allow-dangerously-skip-permissions` or
  `--permission-mode bypassPermissions`.

Launching goes through `herdr agent start`, not `pane run`, so you get herdr's
readiness wait, `working`/`blocked`/`done` state in the built-in sidebar,
`agent focus`/`prompt`/`wait` by name, and session resume after a server restart.
Install the integrations once to get that resume:

```
herdr integration install claude
herdr integration install codex
herdr integration install opencode
herdr integration install antigravity-cli
```

### npm-installed agents need a native shim

`agent start` launches an agent by typing
`Start-Process -FilePath <kind> -NoNewWindow` into the pane, which goes through
CreateProcess — and CreateProcess only runs native images. `claude` and `agy` are
single `.exe` files, so they were never a problem.

`codex` and `opencode` are npm packages, and `npm i -g` writes three files into
`%APPDATA%\npm`: an **extensionless sh script** (for git-bash / WSL), a `.cmd`,
and a `.ps1`. Start-Process matches the literal name first, finds the sh script,
and fails with `%1 is not a valid Win32 application` — twice, once per retry,
after which the old code fell back to `pane run` and left an unnamed, untracked
agent. Putting the `.cmd` first on PATH is not the fix either: that parks
cmd.exe between the ConPTY and the agent, and the TUI then ignores every
keypress (see the gotcha below).

`lib/exe.js` fixes it at the source. For any kind whose first `where.exe` hit is
not native, it reads the `.cmd` shim to find the real binary behind it —

| kind | shim shape | native binary |
| :--- | :--- | :--- |
| `opencode` | `.cmd` execs the exe directly | `node_modules/opencode-ai/bin/opencode.exe` |
| `codex` | `.cmd` runs a Node wrapper | `@openai/codex-win32-x64/vendor/<triple>/bin/codex.exe` |

— **hardlinks** it into `<config-dir>/shims/<kind>.exe`, and creates the pane
with `pane split --env PATH=<shims>;<inherited>`. Start-Process then resolves a
real image on the first try, and codex/opencode get herdr names, sidebar state
and resume exactly like claude and agy do.

Details worth keeping in mind:

* A hardlink, not a copy (codex.exe is ~300MB) and not a symlink (which wants
  Developer Mode). It shares the target's inode, so an agent upgrade shows up as
  a size/mtime mismatch and the link is rebuilt on the next launch.
* Going straight to the vendored binary skips codex's Node wrapper, whose only
  other job is exporting `CODEX_MANAGED_PACKAGE_ROOT` and `CODEX_MANAGED_BY_NPM`
  — the launcher passes both via `--env` so `codex` behaves as it does in a
  shell.
* `--env` on `pane split` / `tab create` is the only hook for this: herdr
  launches the shell immediately, so there is no later moment to fix PATH in.

## Popup

The launcher's zero-width presentation, and the one to reach for first:

```
node bin/popup-launcher.js          # or the launcher-popup-open action
```

A popup is **not part of the split tree**, so herdr's ratio clamp never gets a
say: it opens at exact cell dimensions (46 × 70% here, from the `[[panes]]`
entry), takes nothing from the layout while it is closed, and is wide enough that
icons sit next to full labels and hints. It is a session-modal singleton, so
`esc` dismisses it, and launching an agent or an app closes it on the way out —
leaving it up would only hide the thing it just started.

```
 AGENTS · YOLO ────────────────────────
  opencode
  antigravity
 󰆍 codex
  claude
```

**Why the command in the manifest is a `node -e` bootstrap.** herdr runs a plugin
pane with the plugin root as its cwd but hands it as a `\\?\`-prefixed extended
path, and node cannot resolve a RELATIVE script against that — it throws inside
`node:fs` and exits 1. That, and not the program lookup, is what this README used
to record as "herdr cannot spawn a relative `[[panes]]` command on Windows". An
absolute script path works; the bootstrap strips the prefix instead, so the
manifest stays machine-independent.

## Sidebar

The docked alternative, for a launcher that sits there. `prefix+shift+a` docks it
on the right edge of the focused tab as a 36-column list (`--cols` to change
that). Press the key again while it is focused to close it; press it from
elsewhere to focus it.

One presentation, no modes: the pane is sized once by the split that creates it
and never resizes itself afterwards.

```
↑↓ / jk    move            ⏎          run selected
click      focus a row     wheel      scroll the list
click ×2   run it          r          reload
q          close the pane  y / n      answer a confirmation
```

`q` (and `[q quit]`, and `ctrl-c`) **closes the pane**, not just the process —
the same end state as pressing `prefix+shift+a` in it. A launcher that only
exited left its pane standing with a bare shell in it, holding a column of
screen and an ownership token that lapses a minute later, so the next toggle
docked a second sidebar beside the corpse. The close is fired
detached, because `pane close` kills the pane that would be waiting for its
reply. Two exceptions: the popup is closed by herdr itself when the process
exits, and a sidebar that is **alone in its tab** only exits — closing the last
pane in a tab is more than `q` was asked to do.

The footer is that key table made clickable. Every view ends in a row of chips —
`[⏎ run]  [r reload]  [q quit]` here, `[⏎ toggle]  [d delete]  [r reload]
[q close]` in a symlinks pane — and clicking one feeds exactly that key back
through the same handler, so the mouse can never reach an action the keyboard
cannot. Chips are the one place where a single click acts: a chip is already a
named action, so it does not need the two-beat rule the list rows have. The bar
is two rows tall whatever it holds (chips wrap, and in a very narrow pane the
last one is dropped — its key still works), which is what keeps a chip on the
same screen row between renders.

### Icons

Nerd Font glyphs leading each row, from `lib/icons.js`. The agent and app marks
follow CodingSpace's own icon set (`src/renderer/icons/*.svg`) as closely as one
monochrome cell can — its `opencode.svg` is a two-tone block, `antigravity.svg` a
coloured arch, `codex.svg` a rounded blob around a `>_` prompt:

| row | glyph | row | glyph |
| --- | --- | --- | --- |
| OpenCode | `cod-primitive_square` | Antigravity IDE | `md-application_brackets` |
| Antigravity CLI | `fa-mountain` | Android Studio | `md-android_studio` |
| Codex | `md-console` | VS Code | `dev-vscode` |
| Claude | `fa-asterisk` | File Explorer | `fa-folder` |
| Symlinks | `cod-file_symlink_directory` | a link | `cod-link` |
| OpenSpec | `md-file_document` | a broken link | `md-link_off` |
| Plane | `cod-checklist` | a Plane issue | `cod-issues` |

Every codepoint in that file was checked twice before it went in, because both
failure modes are silent from inside the plugin:

* **present in the installed font's cmap** — read straight out of
  `JetBrainsMonoNerdFont-Regular.ttf` with fontTools. A guessed private-use
  codepoint renders as a tofu box and nothing in the plugin can tell.
* **one grid column wide** - measured inside a real herdr pane by writing the
  glyph and asking the terminal where the cursor landed (`CSI 6n`). This is the
  one that bites: `md-*` glyphs live in plane 15, so they are **two UTF-16 units
  and one column**, and any padding done with `.length` puts those rows a column
  out. Hence `displayWidth()` in `lib/tui.js`, which counts cells by code point,
  and an icon column sized from the widest icon actually in the list - the ASCII
  fallback below is two columns wide, so that width is measured, not assumed.

Colour is the other half of the icon. A single cell cannot carry a logo's
shape, but it carries its colour exactly — and CodingSpace renders these marks in
full colour too (`filter: none` on the logo images) — so each glyph is painted in
truecolour from the same palette: OpenCode `#CFCECD`, Antigravity CLI `#3186FF`,
Codex `#FFFFFF`, Claude `#D97757`, Antigravity IDE `#FBBC04`, Android Studio
`#3DDC84`, VS Code `#0098FF`, Explorer `#FFD65C`.

No patched font? `--ascii-icons`, or `icons.json` in the plugin config dir:

```json
{ "style": "ascii" }
```

That swaps every glyph for a two-letter mnemonic (`oc` `ag` `cx` `cl`, `AG` `AS`
`VS` `EX`, `LN` `SP` `PL`) - no font or width assumptions at all.

### How wide the sidebar is

36 columns, or `--cols`. herdr clamps every split ratio to [0.1, 0.9], so on a
narrow tab you get less than you asked for and there is nothing to be done about
it: see the Windows notes for what that clamp is and every way of not getting
round it. A launcher that must not cost columns at all is the popup above.

### A sidebar in every new tab

`bin/watch-tabs.js` holds one `tab.created` subscription open on the socket API
and docks a sidebar into each tab as it appears, without taking focus. Opening a
sidebar starts it (`--no-watch` to skip); `watch-tabs.js --stop` ends it,
`--status` reports it, and `--once` docks every currently open tab that has no
sidebar.

It is one long-lived process rather than an `[[events]]` hook precisely because a
hook spawns a process per event, and on Windows 11 a console-subsystem process in
a hook chain flashes a Windows Terminal window each time.

Only one watcher may run, and the lock is worth describing because getting it
wrong is how a sidebar ends up in a tab nobody asked about:

* `watch-tabs.pid` in the config dir is taken with an **exclusive create**, not a
  check-then-write. Two `--start` calls in the same breath — a keybinding and a
  sidebar opening — would otherwise both see an empty slot, both spawn, and the
  second would overwrite the first's pid and orphan it. `--start` waits for the
  lock to settle before reporting, so it says *already running* rather than
  claiming a start that stood straight back down.
* A watcher **re-reads the lock every 30s** and exits if it no longer names it.
  A kill on Windows does not run the victim's exit handler, so a stale pid file
  is normal; this is what stops an orphan from outliving a `--stop`.
* Docking is idempotent per tab (one carrying our token is skipped), and the
  event path additionally refuses any tab that **already holds more than its root
  pane** - checked live, not from the event. Subscribing replays the last
  `tab.created`, so that check is what keeps a replay from splitting a layout
  somebody has already built. `--once` deliberately skips it: docking into tabs
  that are already laid out is the whole point of asking for it.
* The ownership token carries a **90s TTL** against a 30s refresh. Without one, a
  pane that had merely hosted a launcher once kept the token for good, and every
  later `ensure()` read that tab as already having a sidebar and refused to dock.

**Mouse.** The pane turns on SGR mouse tracking (modes 1002 + 1006), which herdr
re-encodes and forwards to the PTY with pane-relative coordinates. A left click
moves the selection to the row under the pointer; a second click on that row —
the one that already holds the selection — is what runs it. A mis-click in a
launcher would otherwise spawn something, so the click pair mirrors ↑↓ then ⏎,
and anything destructive is still confirm-gated. The wheel moves the viewport
**independently** of the selection; the next keyboard move or click snaps back to
the selected row. Right-click is left alone so herdr's own right-click handling
still works.

**Layout.** Every row is padded to exactly the pane width, so nothing jitters
between renders. One column of gutter on each side, hints right-aligned to a
single column (labels ellipsise first, hints drop only when there is no room),
group headers carry a rule out to the right gutter, and the selection is a solid
full-width reversed bar rather than a marker glyph. Header and footer are
fixed-height so the body never shifts under the pointer — which is also what
makes click-to-row mapping reliable.

* **Agents** — the four YOLO launchers above, name and mark only: the group
  header says they all skip prompts, so no row carries a `!` badge. A list with
  nothing dangerous in it spends no columns on the badge column at all, which is
  how those rows get two columns of label back
* **Apps** — Antigravity IDE, Android Studio, VS Code, File Explorer; each opens
  at the active pane's directory, detached, and is then raised to the front. An
  app that is already running keeps its instance (VS Code and the JetBrains
  family reuse the window for a folder they already have open); File Explorer,
  which reuses nothing on its own, gets its existing window for that folder
  activated instead of a duplicate
* **Workspace** — Symlinks, OpenSpec setup, Plane tasks. Each opens a **pane of
  its own** beside the pane you are working in, rather than a view inside the
  sidebar; see below

If an app is detected at the wrong path, override it in `apps.json` in the plugin
config dir (`herdr plugin config-dir herdr-launcher`) — the equivalent of
CodingSpace's settings fields:

```json
{ "android-studio": "C:\\Program Files\\Android\\Android Studio1\\bin\\studio64.exe" }
```

## Focus mode

`prefix+z`, where you would otherwise bind `pane zoom`: one work pane fills the
tab and the launcher is still there. Press it again and the layout comes back
exactly as it was.

```
  before                     focus mode
  +------+------+------+     +---------------+------+
  | work | a    |  SB  |     |     work      |  SB  |
  +------+------+      | ->  |               |      |
  | x    | b    |      |     |               |      |
  +------+------+------+     +---------------+------+
                              a, b, x -> "launcher stash" tab
```

**Why it cannot just zoom.** herdr's zoom is decided *above* the split tree:
while `Tab.zoomed` is set the layout engine ignores the tree and returns one
`PaneInfo` covering the whole tab area for the focused pane, so nothing else in
that tab is rendered - a docked launcher included. No plugin flag changes that.
herdr's own Spaces/Agents sidebar survives zoom because it is **chrome**:
`compute_view` splits the frame into sidebar and tab surface and draws them
separately, and its width lives in `session.json` as a top-level `sidebar_width`
rather than in any tab layout. A plugin can only put a PTY inside the tab
surface, so the only way to a full-width work pane with the launcher still
visible is to *empty the tab* instead of zooming it.

So `bin/focus-mode.js` records the tab's split tree, moves every other pane to a
stash tab, and moves them back on the way out. The panes keep running throughout
- a move re-parents a pane and the reply carries the same `terminal_id`, so
agents and builds never notice.

The parts worth knowing:

* **The tree is recorded, not guessed.** `pane layout` returns `panes[]` with
  rects *and* `splits[]` with a rect, a direction and a ratio each, and a split's
  rect is the region it divides - so `lib/layout.js` rebuilds the tree by
  matching rects. The dividing line is the ratio applied to the region and
  rounded (234 columns at 0.9 renders 211 + 23, and `Math.round` agrees with
  Rust's `round` on every case measured), with every other edge in the region
  tried in order of nearness as a fallback. Reading the boundary off the pane
  edges alone does not work: a pane edge can belong to a divider several levels
  deeper, so the outermost split gets handed the innermost boundary. A tree that
  will not resolve returns `null` and focus mode refuses.
* **A same-tab `pane move` toward an adjacent target is a no-op.** This is the
  one that shaped the whole design. herdr sees the arrangement it was asked for
  and changes nothing - `--ratio` included: a two-pane tab at 0.5 asked to move
  to 0.9 stayed at 0.5, measured. So a pane already in the tab cannot be
  re-placed or re-sized by moving it; it has to change parents first. The
  launcher therefore **leaves first and comes back last** on the way in, and is
  **parked in the stash tab before the replay** on the way out. Its ratio then
  lands exactly (0.9 of 108 columns, launcher 11).
* **`--ratio` is the TARGET pane's share**, the same convention as `pane split`,
  and `--split right|down` is *required* whenever `--tab` is given. There is no
  "insert to the left", so a replay that needs the anchor on the far side inserts
  the pair the wrong way round and then `pane swap`s them - the slots keep their
  ratios, so the recorded number still applies.
* **The stash tab is made by `pane move --new-tab`**, not `tab create`: a created
  tab comes with a shell of its own that would have to be cleaned up, while a
  moved-into tab holds only the moved pane and herdr closes it by itself when the
  last pane leaves. Nothing to tear down. `bin/watch-tabs.js` skips any tab
  labelled `launcher stash`, so the watcher never docks a sidebar into
  scaffolding.
* **`focus-mode.json` in the config dir is the toggle**, since every action runs
  in a fresh process - which also means focus mode survives a herdr restart:
  public pane and tab ids are stable across a snapshot restore.
* **Panes that exit while stashed are skipped** and their region collapses, the
  same as if they had been closed in place. If the work pane itself exits, the
  replay picks another leaf of the recorded tree as its anchor.
* **It always falls back to `pane zoom --toggle`** - a tab with no launcher in
  it, or a layout that would not record. The key never feels broken, and the JSON
  report says which path it took.

**A zoom the plugin did not do cannot be caught.** The obvious alternative — let
the tab watcher notice any zoom and convert it into focus mode — has no event to
hang off. Zoom emits nothing: subscribing to `layout.updated` and zooming a pane
produced zero events for that tab (measured), because zoom changes what is
rendered, not the tree, and the topic list holds no zoom event at all
(`workspace.*`, `worktree.*`, `tab.*`, `pane.*`, `layout.updated`). Short of
polling `pane layout` per tab, the key binding is the only entry point — which is
why the built-in `zoom` binding has to be moved rather than left to race.

Costs, honestly: the stash tab is visible in the tab bar while focus mode is on,
and a tab is put back one pane at a time, so a deep layout is several moves
rather than one flag.

## Surviving a herdr restart

The `[[startup]]` entry runs `bin/startup.js` when the server starts.

What a restart actually loses is narrower than it looks. `session.json` keeps
every pane's cwd and label, the whole split tree, and it resumes agent panes
properly - a pane started through `herdr agent start` carries
`managed_agent_kind` and an `agent_session`, and herdr re-invokes it as
`claude --resume <id>`. So the agents this plugin launches come back by
themselves, conversation included.

What it does not keep is the **command in an ordinary pane**: restore spawns a
plain shell in the recorded cwd. The sidebar therefore comes back as an empty
shell in the right slot, at the right width, still labelled `Launcher` - and
since metadata tokens are not persisted either, the tab reads as having no
launcher at all, so the next toggle would dock a *second* one beside the corpse.

`bin/startup.js` closes that:

* **It adopts rather than docks.** A pane with our label, no tokens, sitting at a
  shell prompt with nothing running on top of it (`pane process-info`), on the
  right edge of its tab, gets the launcher run in it and a fresh token stamped.
  Docking would have left the restored shell standing.
* **It waits for the restore first.** There is no "restore finished" event and a
  startup command can run while panes are still being respawned, so it polls
  `pane list` until the set stops changing (15s cap). Adopting too early would
  dock a spare launcher into a tab whose sidebar had not come back yet.
* **It never invents a sidebar.** A tab with no restored launcher pane is left
  alone: docking one would be inventing a layout the user never had.
* **It restarts the tab watcher** if `watch.json` says it was running.
  `watch-tabs.js --start` / `--stop` record that intent, because the pid file
  cannot: after a reboot a stale pid is indistinguishable from a watcher somebody
  stopped on purpose.
* **It prunes `focus-mode.json`** of entries whose tab or stashed panes did not
  come back.

Manifest details, verified against 0.8.2 by linking a probe manifest:
`[[startup]]` takes `command` and `platforms` and nothing else - no id, no title.
There is no `app.startup` **event** to use instead; herdr's hook allowlist is the
workspace/worktree/tab/pane set, and `on = "app.startup"` links with an
`unknown event` warning and never fires. The entry uses the same `node -e`
bootstrap as the popup pane, for the same extended-path reason.

## Workspace tool panes

Symlinks, OpenSpec and Plane each open in a **pane of their own**:

```
node bin/tool-launch.js <symlinks|openspec|plane> [--cols N] [--ratio N] [--dry-run]
```

They used to run inside the sidebar as a view stack, and 36 columns is not a
width at which any of the three is readable: a symlink's target path, an
OpenSpec component's state and a Plane issue's title-next-to-its-state all
ellipsised down to nothing. A pane asks for the width the content needs — 52,
44 and 64 columns — and costs the layout nothing while it is closed. Override
with `--cols`, or per tool in `tools.json` in the plugin config dir:

```json
{ "cols": { "plane": 72 } }
```

Three things about the pane are worth knowing:

* **It is split off the pane you are working in, never off the sidebar.**
  `resolveContext()` refuses to hand back a plugin-owned pane, so the tool lands
  beside the work and the sidebar keeps its columns. The ratio arithmetic is
  `dock.open()`'s, clamp included — a narrow work pane yields less than asked.
* **The row is a toggle: a second press closes the pane it opened.** Not a
  second instance, and not a re-focus — the press that took the columns gives
  them back. This is the opposite of the agent launchers, where another instance
  is the point: there is one worktree to link and one issue list to read. The
  pane carries a `herdr-launcher-tool` token whose value is the tool key, which
  is what `tool-launch.js` looks for — so pressing Plane closes the Plane pane
  and not the Symlinks one beside it. It is a **different token name** from the
  sidebar's `herdr-launcher`, because `isOurs()` is what `toggle-launcher.js`
  reads and a tool pane answering to it would be the pane `prefix+shift+a`
  closes. One exception, and it is `lib/app.js`'s `quit()` rule: a tool pane
  alone in its tab is focused rather than closed, since closing the last pane
  closes the tab.
* **It resolves its worktree from the pane it was opened from**, passed in as
  `HERDR_ACTIVE_PANE_ID` / `HERDR_ACTIVE_PANE_CWD` at split time, so the answer
  does not drift if you `cd` inside the tool pane afterwards.

`q` and `esc` both close the pane — the tool is finished with, and lib/app.js's
quit() rules apply: the close is fired detached, and a pane alone in its tab only
exits.

### Symlinks

Lists every link in the current worktree and offers new ones: shareable folders
(`node_modules`, `build`, `dist`, `.gradle`, `vendor`, `target`, `.venv`) that
exist in a **sibling git worktree** of the same repo. Windows gets directory
junctions, which need neither elevation nor Developer Mode.

Deleting always asks first — the list includes whatever links are really there,
including Windows' own legacy junctions when the pane sits in a home folder.

Add arbitrary targets via `symlinks.json` in the plugin config dir
(`herdr plugin config-dir herdr-launcher`):

```json
{ "targets": [ { "name": "assets", "targetPath": "D:\\shared\\assets" } ] }
```

### OpenSpec

Deploys the OpenSpec toolkit per platform (core, Claude, Codex, OpenCode,
Antigravity) and maintains the matching `.git/info/exclude` patterns. The
component table mirrors CodingSpace's `TOOLKIT_COMPONENTS` exactly, so a worktree
set up by either tool looks the same.

Source defaults to `D:\Quest\CodingSpace\toolkits\OpenSpec`. Override it with
`openspec.json` in the config dir: `{ "root": "..." }`.

### Plane

Read-only issue list, opening in the browser on Enter. Needs `plane.json` in the
config dir — the API key never lives in this repo:

```json
{
  "baseUrl": "https://app.plane.so",
  "workspaceSlug": "your-workspace",
  "projectId": "uuid",
  "apiKey": "plane_api_..."
}
```

Same endpoints and `X-API-Key` header as CodingSpace's `planeService.ts`, so one
key works for both.

## Running the pieces by hand

Every helper works standalone, and each takes `--dry-run`:

```
node bin/popup-launcher.js [--no-focus] [--dry-run]
node bin/toggle-launcher.js [--cols 36] [--open|--close] [--no-watch] [--dry-run]
node bin/watch-tabs.js [--start|--stop|--status|--once] [--cols 36]
node bin/agent-launch.js <agent-key> [--tab] [--ratio 0.5] [--direction right|down] [--dry-run]
node bin/tool-launch.js <tool-key> [--cols N] [--ratio N] [--dry-run]
node bin/app-open.js <app-key> [path] [--no-focus] [--dry-run]
node bin/focus-mode.js [--enter|--exit] [--dry-run]
node bin/startup.js [--no-watch] [--timeout 15000] [--dry-run]
```

`--no-focus` skips the window-raising pass (and, for Explorer, the reuse check),
leaving a plain detached launch.

`focus-mode.js --dry-run` prints the tree it recorded and the moves it would
make, which is the quickest way to see why a tab fell through to zoom.
`startup.js --dry-run` lists what it would adopt and what it is skipping, per
tab, without touching anything — the server does not have to be freshly started
for that to be worth reading.

Debugging: `herdr plugin log` has stdout/stderr and exit codes per invocation
(the `[[startup]]` run included, tagged `event: startup`); the sidebar's own
detached child processes log to `launcher.log` in the config dir, the tab watcher
to `watch-tabs.log`, and the startup pass to `startup.log` beside them.

## Windows notes

Every one of these cost real debugging time:

* **`pane report-metadata` needs the pane id BEFORE its flags.** With the id last,
  herdr answers `unknown option: <value>` and silently stamps nothing.
* **`pane run` does not set `HERDR_PANE_ID`** — the sidebar is told its own pane
  id via `--pane`, which it needs to keep its ownership token fresh.
* **Never launch the TUI through a `cmd.exe` shim.** It renders fine and then
  ignores every keypress, because cmd sits between the ConPTY and node.
  `bin/launcher.cmd` is kept as a `--shim` diagnostic only.
* **Injected input only reaches a focused pane.** `pane send-keys` against an
  unfocused pane is silently dropped, which makes scripted testing look broken.
* **`pane read` defaults to `--source recent`** (scrollback). For a TUI on the
  alternate screen you want `--source visible`.
* **Mouse events arrive pane-relative**, already translated from screen
  coordinates, so row maths needs no pane-origin offset. herdr supports mouse
  modes 1000/1002/1003/1006 and re-encodes them for PTY children.
* A list that follows its selection on **every** render makes the wheel look
  dead: the viewport gets yanked back each frame. Follow the selection only when
  the selection is what moved.
* **Agent names must be lowercase** (`^[a-z][a-z0-9_-]{0,31}$`), and workspace ids
  like `wC` carry uppercase — hence the sanitizer in `agent-launch.js`.
* **`agent start` can exit non-zero having actually launched the agent** (it waits
  for a readiness state, and an agent opening on a trust prompt reports
  `Blocked`). Always re-check `agent list` before retrying or falling back —
  retrying blindly earns `agent_name_taken`, and falling back blindly stacks a
  second agent in the same pane.
* **A plugin pane's cwd is a `\\?\`-prefixed extended path, and node cannot
  resolve a relative script against it.** This is the corrected version of a note
  that used to live here claiming herdr could not spawn a relative `[[panes]]`
  command on Windows at all. The program resolves fine — `node` off PATH works —
  but `["node", "bin/launcher.js"]` dies inside `node:fs` with exit 1 because the
  cwd it inherits is `\\?\D:\...\herdr-launcher\`. Measured all four ways: plain
  cwd + relative script works, `\\?\` cwd + relative script fails, `\\?\` cwd +
  absolute script works, and a `node -e` bootstrap that strips the prefix off
  `process.cwd()` works and keeps the manifest machine-independent.
* **Only popups take a size.** `width`/`height` on any other placement is
  rejected at link time ("pane width and height are only supported when placement
  is popup"), and a numeric width must be a TOML number — `width = "46"` earns
  "string sizes must be percentages like 80%; use a number for cells". Overlay,
  split, tab and zoomed placements all become normal panes in the split tree,
  ratio clamp included; the popup is the only one that does not.
* **Popups are session-modal singletons with no pane id.** They never appear in
  `pane list`, so there is nothing to stamp or track: herdr keeps at most one, and
  it closes when its process exits.
* **CLI output is JSON by default** in 0.8.2 for `pane`/`agent` commands; there is
  no `--json` flag (passing one errors). `plugin list` prints human text.
* **`pane resize --amount` is a ratio delta, not a column count**, and the
  direction carries the sign: `left` grows a right-docked pane, `right` shrinks
  it, and a negative amount is read as its absolute value. So a column target
  has to be divided by the width of the split being moved — which is the
  innermost split whose rect still contains the pane, not the tab.
* **A pane's rect is two columns wider than the program inside it.** With
  `pane_borders = true` (the default) a 36-column pane hands the PTY 34, and the
  sidebar's own gutters take two more. Column budgets have to start from what
  `stty size` reports, not from what `pane layout` does — 34 looked fine in the
  layout and clipped `claude` to `clau…` on screen, which is why the expanded
  default is 36.
* **Private-use glyphs measure one column; plane-15 ones are two UTF-16 units.**
  Verified with `CSI 6n` inside a pane for every glyph in `lib/icons.js`:
  `U+EA85` and friends come back as one column, and so does `U+F14DE` — which is
  a surrogate pair, so `String.length` says two. Pad by cells, never by length.
* **Split ratios are hard-clamped to [0.1, 0.9]**, so no docked pane can be
  narrower than a tenth of its container. Measured on all three paths that could
  plausibly bypass it: `pane resize`, `layout.set_split_ratio` and
  `layout.apply` all landed on 0.9 when asked for 0.97, and `pane split --ratio
  0.95` came out clamped too. The container is the **split box, not the tab**,
  which is the lever that is left: splitting a nested pane nests the new pane
  inside that pane's box, so a sidebar beside a 140-column pane can be 15 columns
  where the same sidebar on the root split is 23.
* **A pane's floor is a tenth of its own split box, and the box can be moved.**
  Shrinking the box shrinks the floor with it, which is the only way to a
  six-column pane on a wide tab - at the price of the pane next to it, which then
  cannot exceed nine times the width. The boundary to push is asymmetric: it is
  the outside pane's nearest boundary to the RIGHT and the in-box neighbour's
  nearest boundary to the LEFT. Verified both ways on the same layout - box
  154 → 59 and back, pane 15 → 6 → 15. Nothing in the plugin does this any
  more; it is recorded because it is not obvious and it took measuring.
* **`pane move` does not move panes within a tab.** It is for moving a pane to
  another tab or workspace; same-tab it answers `{ changed: false, reason:
  "same_tab" }` and does nothing. Re-parenting inside a tab means `pane split` to
  make the slot, `pane swap` to get into it, `pane close` to give the borrowed
  pane back - and the swap keeps the process alive, since pane ids stay with
  their processes.
* **`pane report-metadata --ttl-ms` works, and tokens without it never expire.**
  Verified directly: a token stamped with `--ttl-ms 2000` was in `pane list`
  immediately and gone four seconds later.
* **`layout.apply` REPLACES the tab it is given** — new tab id, new pane ids,
  fresh shells — rather than re-ratioing the one that is there. It is not a
  resize primitive; do not reach for it to nudge a layout.
* **The socket API is reachable from node, but not the way the path suggests.**
  `herdr status server` prints `socket: %APPDATA%\herdr\herdr.sock`; on Windows
  that name is a NAMED PIPE (`\\.\pipe\C:\Users\...\herdr.sock`), which node
  can open, while the AF_UNIX path it looks like cannot be opened by node at all.
  There is also a real 25-byte file at that path holding `<pid>:<nonce>` — that
  is not a TCP endpoint, and connecting to the number as a localhost port earns
  ECONNREFUSED. No handshake or token is needed once connected.
* **Event subscriptions have no CLI surface** (`herdr api` only prints a snapshot
  or the schema), so `lib/api.js` speaks the line-delimited JSON protocol
  directly. `events.subscribe` answers `subscription_started` and then streams
  envelopes on the same connection.
* **`windowsHide: true` suppresses a GUI app's window entirely.** It puts
  SW_HIDE in the STARTUPINFO the child inherits: Explorer spawns a process that
  never shows a window, and Android Studio dies with "Cannot start the IDE".
  Measured across four spawn variants — with the flag, nothing opens; without
  it, the window appears. Never pass it when spawning a GUI image. Keep it for
  console children like the herdr CLI.
* **`cmd /c start "" <exe>` does nothing when the parent is detached.** This was
  the previous workaround for the flag above, and it silently fails: `detached`
  sets DETACHED_PROCESS, the cmd.exe it spawns therefore has no console at all,
  and `start` needs one to hand the new process. No error, no window, exit code
  0 — VS Code simply never opened. Verified across detached × windowsHide with a
  `.cmd`, a `.exe` and cmd.exe as the target: every `start` variant failed, and
  the same command run with a console attached worked. GUI apps are spawned
  directly now (`spawn(exe, args, { detached, stdio: 'ignore' })`), which is
  also why `.cmd` shims get unwrapped — see the next bullet.
* **Prefer the app's `.exe` over its `bin/*.cmd` shim.** PATH only carries the
  shim for VS Code and its forks, and Windows cannot exec a `.cmd` at all. The
  shim is just a CLI front end whose payload line names the real image
  (`"%~dp0..\Code.exe" … cli.js %*`), so `lib/apps.js` reads it out and spawns
  that. The `cmd /d /s /c call "<shim>"` route still exists as the fallback and
  works fine — DETACHED_PROCESS means no console is created, so nothing flashes.
* **Launching an app does not put it in front.** These apps are normally already
  running, so a second launch just hands its argv to the live instance, and
  Windows then refuses `SetForegroundWindow` for any process that does not
  already own the foreground — the taskbar button flashes instead. Measured:
  plain `SetForegroundWindow` fails with last error 203 even with the
  `AttachThreadInput` trick; tapping ALT first (which clears the foreground lock
  timeout) makes the very next call succeed. `bin/focus-window.ps1` does that,
  fired detached after each launch.
* **File Explorer has no instance reuse.** Every launch is another window, so
  the reuse has to happen before spawning: the launcher asks
  `Shell.Application` whether a window is already showing that folder and raises
  it instead. This is the one launch that pays a synchronous PowerShell start
  (~0.5s), because the answer decides whether to spawn at all.
* **An Android Studio update can leave a gutted install at the old path.** Here
  `Android Studioinstudio64.exe` still existed and still ran, but the
  directory had no `product-info.json`/`build.txt` — the live install was the
  sibling `Android Studio1`. Existence checks are not enough: discover siblings
  and validate the product metadata. CodingSpace has the same candidate list and
  therefore the same blind spot; its settings override is what papers over it.
* GUI apps are spawned **detached** — a child of the sidebar's PTY dies with the
  pane. `.cmd` shims cannot be exec'd directly by Windows at all.

## Not built yet

* **Remembering a width.** `--cols` and `sidebar.json` set it per launch; a
  border you drag is not remembered anywhere.
* **Images instead of glyphs.** herdr's VT answers the Kitty graphics query with
  `OK` (and reports no sixel), so a pane can in principle place real image data —
  CodingSpace's SVGs rasterised, in colour, at any width. Whether that survives to
  the screen depends on the host terminal underneath herdr, and Windows Terminal
  renders neither Kitty graphics nor, through herdr, sixel. Untested end to end;
  the colour palette above is the cheap half of the same idea.
* **Detecting a patched font.** There is no way to ask the terminal whether a
  glyph will render rather than tofu, so the icon style is a setting
  (`--ascii-icons` / `icons.json`) rather than something the plugin works out.
* **Text entry in the TUI** — new symlink targets come from `symlinks.json` rather
  than an in-pane prompt.
* **Plane writes** — the list is read-only; no status changes or comments.
* **A `redeploy` action** to close every launcher pane across workspaces at once.
