#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { List } = require('../lib/tui');
const { App, selfPaneId, requireTTY } = require('../lib/app');
const { AGENTS } = require('../lib/agents');
const { APPS, resolveApp, openApp } = require('../lib/apps');
const { configDir, OWNER_TOKEN, toolOf } = require('../lib/context');
const stash = require('../lib/stash');
const { TOOLS } = require('../lib/views');
const { icon, sgr } = require('../lib/icons');

const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(configDir(), 'launcher.log');

const DEFAULT_ACTIONS = [
  { key: 'enter', label: 'run' },
  { key: 'r', label: 'reload' },
  { key: 'q', label: 'quit' },
];

const argv = process.argv.slice(2);

const POPUP = argv.includes('--popup');
const POPUP_ACTIONS = [
  { key: 'enter', label: 'run' },
  { key: 'r', label: 'reload' },
  { key: 'escape', label: 'close' },
];

function runHelper(script, args, env = {}) {
  let fd = 'ignore';
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fd = fs.openSync(LOG, 'a');
  } catch (_) {

  }
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', script), ...args], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...env },
  });
  child.unref();
}

function paneEnv(app) {
  const env = {};
  if (app.ctx.pane) {
    env.HERDR_ACTIVE_PANE_ID = app.ctx.pane.pane_id;
    env.HERDR_ACTIVE_PANE_CWD = app.ctx.cwd;
  }
  return env;
}

function menuView() {
  const items = [];

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

  items.push({ type: 'blank' });
  items.push({ type: 'group', label: 'WORKSPACE' });

  const inFocusMode = () => {
    try {
      const ctx = require('../lib/context').resolveContext();
      return Boolean(ctx.pane && stash.entryFor(ctx.pane.tab_id));
    } catch (_) {
      return false;
    }
  };
  const focused = inFocusMode();
  items.push({
    type: 'item',
    label: 'Focus mode',
    icon: icon('focus-mode'),
    iconColor: sgr('focus-mode'),
    closeAfter: true,
    hint: focused ? 'on' : '',
    run: (a) => {
      a.refreshContext();
      const on = a.ctx.pane ? Boolean(stash.entryFor(a.ctx.pane.tab_id)) : false;
      runHelper('focus-mode.js', [], paneEnv(a));
      a.setStatus(on ? 'restoring the layout…' : 'focusing the work pane…', 'ok');
    },
  });

  for (const tool of TOOLS) {
    items.push({
      type: 'item',
      label: `${tool.menuLabel}…`,
      icon: icon(tool.iconKey),
      iconColor: sgr(tool.iconKey),
      closeAfter: true,
      run: (a) => {

        a.refreshContext();
        const tabId = a.ctx.pane && a.ctx.pane.tab_id;
        const open = (a.ctx.panes || []).find(
          (p) => p.tab_id === tabId && toolOf(p) === tool.key
        );
        runHelper('tool-launch.js', [tool.key], paneEnv(a));
        a.setStatus(`${open ? 'closing' : 'opening'} ${tool.label} pane…`, 'ok');
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

  stamp: { name: OWNER_TOKEN, value: String(Math.floor(Date.now() / 1000)) },
  closesPane: true,
}).start();
