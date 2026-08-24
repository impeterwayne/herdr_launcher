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
const h = require('../lib/herdr');
const stash = require('../lib/stash');
const { TOOLS, byKey } = require('../lib/views');
const { icon, sgr } = require('../lib/icons');

const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(configDir(), 'launcher.log');

const DEFAULT_ACTIONS = [
  { key: 'enter', label: 'run' },
  { key: 'r', label: 'reload' },
  { key: 'q', label: 'quit' },
];

const argv = process.argv.slice(2);

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

function buildMenuItems(app) {
  const items = [];

  items.push({ type: 'group', label: 'AGENTS · YOLO' });
  for (const agent of AGENTS) {
    items.push({
      type: 'item',
      label: agent.menuLabel || agent.label,
      icon: icon(agent.iconKey),
      iconColor: sgr(agent.iconKey),
      closeAfter: true,
      run: (a) => {
        runHelper('agent-launch.js', [agent.key], paneEnv(a));
        a.setStatus(`launching ${agent.menuLabel || agent.label}…`, 'ok');
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

  const inStackMode = () => (stash.isStackModeOn ? stash.isStackModeOn() : stash.isFocusModeOn());
  const stacked = inStackMode();
  items.push({
    type: 'item',
    label: 'Stack mode',
    icon: icon('stack-mode'),
    iconColor: sgr('stack-mode'),
    closeAfter: false,
    hint: stacked ? 'on' : 'off',
    run: (a) => {
      stash.toggle();
      const nowOn = stash.isStackModeOn ? stash.isStackModeOn() : stash.isFocusModeOn();
      a.setStatus(nowOn ? 'Stack mode: ON (new agents open in new tab)' : 'Stack mode: OFF (in-tab Fibonacci)', 'ok');
      if (a.view && a.view.refresh) a.view.refresh(a);
      a.render();
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
        runHelper('tool-launch.js', [tool.key], paneEnv(a));
        a.setStatus(`opening ${tool.label} popup…`, 'ok');
      },
    });
  }

  return items;
}

function menuView() {
  const view = {
    title: 'Launcher',
    list: new List([]),
    refresh(app) {
      this.list.setItems(buildMenuItems(app));
    },
    render(height, width) {
      return this.list.render(height, width);
    },
  };
  return view;
}

requireTTY('launcher.js');

new App({
  view: menuView,
  actions: DEFAULT_ACTIONS,
  paneId: selfPaneId(),
  stamp: { name: OWNER_TOKEN, value: String(Math.floor(Date.now() / 1000)) },
  closesPane: true,
}).start();
