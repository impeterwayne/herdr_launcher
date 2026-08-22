'use strict';

const { spawn } = require('node:child_process');

const { List } = require('./tui');
const { icon, sgr } = require('./icons');
const { findRepoRoot, configDir, readConfig } = require('./context');
const symlinks = require('./symlinks');
const openspec = require('./openspec');
const plane = require('./plane');

const shorten = (p, max = 28) => (p && p.length > max ? `…${p.slice(-(max - 1))}` : p || '');

function openBrowser(url) {
  if (!url) return;
  const isWin = process.platform === 'win32';
  const file = isWin ? process.env.ComSpec || 'cmd.exe' : 'xdg-open';
  const args = isWin ? ['/d', '/c', 'start', '', url] : [url];
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function symlinkView() {
  return {
    title: 'Symlinks',
    actions: [
      { key: 'enter', label: 'toggle' },
      { key: 'd', label: 'delete' },
      { key: 'r', label: 'reload' },
      { key: 'q', label: 'close' },
    ],
    list: new List([]),
    refresh(app) {
      const worktree = findRepoRoot(app.ctx.cwd) || app.ctx.cwd;
      this.worktree = worktree;
      const existing = symlinks.scan(worktree);
      const existingNames = new Set(existing.map((l) => l.name.toLowerCase()));
      const items = [];

      items.push({ type: 'group', label: `LINKED (${existing.length})` });
      if (!existing.length)
        items.push({ type: 'item', icon: icon('empty'), label: '(none)', disabled: true });
      for (const link of existing) {
        items.push({
          type: 'item',
          label: link.name,
          icon: icon(link.broken ? 'link-broken' : 'link'),
          iconColor: sgr(link.broken ? 'link-broken' : 'link'),
          danger: link.broken,
          hint: link.broken ? 'broken' : shorten(link.targetPath),
          run: (a) => {
            a.confirm(`unlink ${link.name}?`, () => {
              const result = symlinks.remove(worktree, link.name);
              a.setStatus(
                result.ok ? `unlinked ${link.name}` : result.error,
                result.ok ? 'ok' : 'error'
              );
              this.refresh(a);
            });
          },
        });
      }

      const managed = (readConfig('symlinks.json') || {}).targets || [];
      const suggestions = symlinks
        .suggestTargets(worktree, managed)
        .filter((s) => !existingNames.has(s.name.toLowerCase()));
      items.push({ type: 'blank' });
      items.push({ type: 'group', label: 'AVAILABLE TO LINK' });
      if (!suggestions.length)
        items.push({
          type: 'item',
          icon: icon('empty'),
          label: '(nothing to link)',
          disabled: true,
        });
      for (const suggestion of suggestions) {
        items.push({
          type: 'item',
          label: `${suggestion.name}`,
          icon: icon('add'),
          iconColor: sgr('add'),
          hint: `← ${suggestion.from}`,
          run: (a) => {
            const result = symlinks.create(worktree, suggestion.name, suggestion.targetPath);
            a.setStatus(
              result.ok ? `linked ${suggestion.name} → ${suggestion.from}` : result.error,
              result.ok ? 'ok' : 'error'
            );
            this.refresh(a);
          },
        });
      }
      this.list.setItems(items);
    },
    onKey(key, app) {
      if (key === 'd') {
        app.activate(this.list.current());
        app.render();
        return true;
      }
      return false;
    },
    render(height, width) {
      return this.list.render(height, width);
    },
  };
}

function openspecView() {
  return {
    title: 'OpenSpec',
    actions: [
      { key: 'enter', label: 'deploy' },
      { key: 'r', label: 'reload' },
      { key: 'q', label: 'close' },
    ],
    list: new List([]),
    refresh(app) {
      const worktree = findRepoRoot(app.ctx.cwd) || app.ctx.cwd;
      this.worktree = worktree;
      const root = openspec.toolkitRoot();
      const items = [];
      if (!root) {
        items.push({ type: 'group', label: 'SOURCE NOT FOUND' });
        items.push({
          type: 'item',
          icon: icon('empty'),
          label: 'set root in openspec.json',
          disabled: true,
          hint: shorten(configDir()),
        });
      } else {
        items.push({ type: 'group', label: 'COMPONENTS' });
        for (const component of openspec.status(worktree, root)) {
          items.push({
            type: 'item',
            label: component.name.replace(/^OpenSpec /, '').replace(/ OpenSpec/, ''),
            icon: icon(component.deployed ? 'done' : 'add'),
            iconColor: sgr(component.deployed ? 'done' : 'add'),
            hint: component.deployed ? 'deployed' : component.available ? 'missing' : 'no source',
            disabled: !component.available,
            run: (a) => {
              const apply = () => {
                const action = component.deployed ? openspec.remove : openspec.deploy;
                const result = action(worktree, component, root);
                a.setStatus(
                  result.ok
                    ? `${component.deployed ? 'removed' : 'deployed'} ${component.id}`
                    : result.error,
                  result.ok ? 'ok' : 'error'
                );
                this.refresh(a);
              };

              if (component.deployed) a.confirm(`remove ${component.id}?`, apply);
              else apply();
            },
          });
        }
      }
      this.list.setItems(items);
    },
    render(height, width) {
      return this.list.render(height, width);
    },
  };
}

function planeView() {
  return {
    title: 'Plane',
    actions: [
      { key: 'enter', label: 'open' },
      { key: 'r', label: 'reload' },
      { key: 'q', label: 'close' },
    ],
    list: new List([{ type: 'item', icon: icon('empty'), label: 'loading…', disabled: true }]),
    refresh(app) {
      if (!plane.isConfigured()) {
        this.list.setItems([
          { type: 'group', label: 'NOT CONFIGURED' },
          {
            type: 'item',
            icon: icon('empty'),
            label: 'create plane.json',
            disabled: true,
            hint: shorten(plane.configPath()),
          },
          {
            type: 'item',
            icon: icon('empty'),
            label: 'keys: baseUrl, workspaceSlug,',
            disabled: true,
          },
          { type: 'item', icon: icon('empty'), label: '      projectId, apiKey', disabled: true },
        ]);
        return;
      }
      this.list.setItems([{ type: 'item', icon: icon('empty'), label: 'loading…', disabled: true }]);
      plane
        .issues()
        .then((issues) => {
          const items = [{ type: 'group', label: `ISSUES (${issues.length})` }];
          for (const issue of issues.slice(0, 100)) {
            items.push({
              type: 'item',
              label: `${issue.identifier ? `${issue.identifier}-` : ''}${issue.sequence} ${issue.name}`,
              icon: icon('issue'),
              iconColor: sgr('issue'),
              hint: issue.stateName,
              danger: issue.priority === 'urgent',
              run: (a) => {
                openBrowser(plane.webUrl(issue));
                a.setStatus(`opened ${issue.sequence} in browser`, 'ok');
              },
            });
          }
          if (issues.length === 0)
            items.push({ type: 'item', icon: icon('empty'), label: '(no issues)', disabled: true });
          this.list.setItems(items);
          app.render();
        })
        .catch((err) => {
          this.list.setItems([
            { type: 'group', label: 'ERROR' },
            {
              type: 'item',
              icon: icon('alert'),
              label: err.message.split('\n')[0],
              disabled: true,
            },
          ]);
          app.render();
        });
    },
    render(height, width) {
      return this.list.render(height, width);
    },
  };
}

const TOOLS = [
  {
    key: 'symlinks',
    label: 'Symlinks',
    menuLabel: 'Symlinks',
    iconKey: 'symlinks',
    view: symlinkView,
    cols: 52,
  },
  {
    key: 'openspec',
    label: 'OpenSpec',
    menuLabel: 'OpenSpec setup',
    iconKey: 'openspec',
    view: openspecView,
    cols: 44,
  },
  {
    key: 'plane',
    label: 'Plane',
    menuLabel: 'Plane tasks',
    iconKey: 'plane',
    view: planeView,
    cols: 64,
  },
];

const byKey = (key) => TOOLS.find((t) => t.key === key) || null;

module.exports = { TOOLS, byKey, symlinkView, openspecView, planeView, shorten, openBrowser };
