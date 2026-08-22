#!/usr/bin/env node
'use strict';
// The launcher menu — the right-docked sidebar, and the popup.
//
// One pane, one view: the menu. Every row LAUNCHES something and then gets out
// of the way — an agent in a pane of its own, a GUI app, or one of the three
// workspace tools, which are panes of their own too now (bin/tool-launch.js).
// Nothing opens inside this pane, which is why there is no view stack to walk
// back up and why `q` means the same thing wherever you press it.
//
// The pane is sized once, when it is docked (or by the popup's own manifest
// dimensions), and never resizes itself afterwards.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { List } = require('../lib/tui');
const { App, selfPaneId, requireTTY } = require('../lib/app');
const { AGENTS } = require('../lib/agents');
const { APPS, resolveApp, openApp } = require('../lib/apps');
const { configDir, OWNER_TOKEN } = require('../lib/context');
const { TOOLS } = require('../lib/views');
const { icon, sgr } = require('../lib/icons');

const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(configDir(), 'launcher.log');

// Footer actions for the menu.
const DEFAULT_ACTIONS = [
  { key: 'enter', label: 'run' },
  { key: 'r', label: 'reload' },
  { key: 'q', label: 'quit' },
];

// The docked width lives in lib/dock.js, not here: it is decided by the split
// that creates the pane, and this program never resizes anything.
const argv = process.argv.slice(2);

// Running as a popup instead of a docked pane. A popup sits outside the split
// tree at fixed cell dimensions, and there is no reason for it to linger once it
// has launched something.
const POPUP = argv.includes('--popup');
const POPUP_ACTIONS = [
  { key: 'enter', label: 'run' },
  { key: 'r', label: 'reload' },
  { key: 'escape', label: 'close' },
];

/** Run one of our own helper scripts detached, logging to launcher.log. */
function runHelper(script, args, env = {}) {
  let fd = 'ignore';
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fd = fs.openSync(LOG, 'a');
  } catch (_) {
    /* logging is best-effort */
  }
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', script), ...args], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...env },
  });
  child.unref();
}

/** Pass the pane we resolved down to helpers so they agree on the target. */
function paneEnv(app) {
  const env = {};
  if (app.ctx.pane) {
    env.HERDR_ACTIVE_PANE_ID = app.ctx.pane.pane_id;
    env.HERDR_ACTIVE_PANE_CWD = app.ctx.cwd;
  }
  return env;
}

// ---------------------------------------------------------------- menu view

function menuView() {
  const items = [];

  // Every launcher here skips approval prompts, and the group label is the one
  // place that says so: the rows themselves are just the agent's name and its
  // mark, with no badge and no per-row flag spelled out. There is nothing to
  // choose between on a row — every agent has exactly one entry — so a hint
  // would only repeat the label.
  items.push({ type: 'group', label: 'AGENTS · YOLO' });
  for (const agent of AGENTS) {
    items.push({
      type: 'item',
      label: agent.label,
      icon: icon(agent.iconKey),
      iconColor: sgr(agent.iconKey),
      closeAfter: true,
      run: (app) => {
        runHelper('agent-launch.js', [agent.key], paneEnv(app));
        app.setStatus(`launching ${agent.label}…`, 'ok');
      },
    });
  }

  items.push({ type: 'blank' });
  items.push({ type: 'group', label: 'APPS' });
  for (const app of APPS) {
    const found = Boolean(resolveApp(app));
    items.push({
      type: 'item',
      label: app.label,
      icon: icon(app.iconKey),
      iconColor: sgr(app.iconKey),
      closeAfter: true,
      disabled: !found,
      hint: found ? '' : 'not found',
      run: (a) => {
        try {
          const exe = openApp(app, a.ctx.cwd);
          a.setStatus(`${app.label}: ${path.basename(exe)}`, 'ok');
        } catch (err) {
          a.setStatus(err.message, 'error');
        }
      },
    });
  }

  // Each tool opens a pane beside the work pane — wide enough for a target path
  // or an issue title, and focused rather than duplicated on a second press.
  // `closeAfter` for the same reason an agent row has it: in a popup, the thing
  // that just opened is behind the popup.
  items.push({ type: 'blank' });
  items.push({ type: 'group', label: 'WORKSPACE' });
  for (const tool of TOOLS) {
    items.push({
      type: 'item',
      label: `${tool.menuLabel}…`,
      icon: icon(tool.iconKey),
      iconColor: sgr(tool.iconKey),
      closeAfter: true,
      run: (a) => {
        runHelper('tool-launch.js', [tool.key], paneEnv(a));
        a.setStatus(`opening ${tool.label} pane…`, 'ok');
      },
    });
  }

  return {
    title: 'Launcher',
    list: new List(items),
    render(height, width) {
      return this.list.render(height, width);
    },
  };
}

requireTTY('launcher.js');

new App({
  view: menuView,
  actions: POPUP ? POPUP_ACTIONS : DEFAULT_ACTIONS,
  popup: POPUP,
  paneId: selfPaneId(),
  // A timestamp, not a key: the value is never read, only its freshness.
  stamp: { name: OWNER_TOKEN, value: String(Math.floor(Date.now() / 1000)) },
  closesPane: true,
}).start();
