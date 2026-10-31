'use strict';

const { spawn } = require('node:child_process');

const { List } = require('./tui');
const { icon, sgr } = require('./icons');
const { findRepoRoot, configDir, readConfig } = require('./context');
const symlinks = require('./symlinks');
const plane = require('./plane');
const apps = require('./apps');
const path = require('node:path');

const shorten = (p, max = 28) => (p && p.length > max ? `…${p.slice(-(max - 1))}` : p || '');

function openBrowser(url) {
  if (!url) return;
  const isWin = process.platform === 'win32';
  const file = isWin ? process.env.ComSpec || 'cmd.exe' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
  const args = isWin ? ['/d', '/c', 'start', '', url] : [url];
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function symlinkView() {
  return {
    title: 'Symlinks',
    actions: [
      { key: 'enter', label: 'link' },
      { key: 'b', label: 'browse' },
      { key: 'e', label: 'explore' },
      { key: 'd', label: 'delete' },
      { key: 'r', label: 'reload' },
      { key: 'escape', label: 'close' },
    ],
    list: new List([]),
    browse(app) {
      const worktree = this.worktree || findRepoRoot(app.ctx.cwd) || app.ctx.cwd;
      const applySelection = (rawSelected) => {
        if (!rawSelected || !String(rawSelected).trim()) {
          if (app) app.setStatus('folder selection cancelled', 'info');
          if (app && app.render) app.render();
          return;
        }
        const selected = path.resolve(worktree, String(rawSelected).trim());
        const name = path.basename(selected);
        const result = symlinks.create(worktree, name, selected);
        if (result.ok) {
          symlinks.addPersistentTarget(name, selected);
        }
        if (app) {
          app.setStatus(
            result.ok ? `linked ${name} → ${selected}` : result.error,
            result.ok ? 'ok' : 'error'
          );
        }
        this.refresh(app);
        if (app && app.render) app.render();
      };

      if (app) {
        app.setStatus('waiting for folder selection…', 'info');
        if (app.render) app.render();
      }

      const raw = symlinks.browseFolder(worktree, { withReason: true });
      const res =
        raw && typeof raw === 'object'
          ? raw
          : { selected: raw || null, cancelled: !raw, unavailable: false };

      if (res.selected) {
        applySelection(res.selected);
        return;
      }

      if (res.unavailable && app && typeof app.prompt === 'function') {
        app.prompt('Enter folder or file path to link', { defaultValue: '' }, (entered) => {
          applySelection(entered);
        });
        return;
      }

      if (app) {
        app.setStatus('folder selection cancelled', 'info');
        if (app.render) app.render();
      }
    },
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
          itemData: { type: 'linked', name: link.name, targetPath: link.targetPath, broken: link.broken },
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

      items.push({
        type: 'item',
        label: 'Browse',
        icon: icon('add'),
        iconColor: sgr('add'),
        hint: 'choose folder…',
        itemData: { type: 'browse' },
        run: (a) => this.browse(a),
      });

      for (const suggestion of suggestions) {
        items.push({
          type: 'item',
          label: `${suggestion.name}`,
          icon: icon('add'),
          iconColor: sgr('add'),
          hint: `← ${suggestion.from}`,
          itemData: { type: 'available', name: suggestion.name, targetPath: suggestion.targetPath },
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
      const current = this.list.current();
      if (key === 'b') {
        this.browse(app);
        return true;
      }
      if (key === 'e') {
        if (current && current.itemData) {
          const target =
            current.itemData.targetPath ||
            (current.itemData.name && this.worktree ? path.join(this.worktree, current.itemData.name) : null);
          if (target) {
            apps.openApp(apps.byKey('explorer'), target);
            app.setStatus(`opened explorer at ${path.basename(target)}`, 'ok');
            app.render();
            return true;
          }
        }
      }
      if (key === 'u' || key === 'd') {
        if (current && current.itemData && current.itemData.type === 'linked') {
          app.activate(current);
          return true;
        }
      }
      return false;
    },
    render(height, width) {
      return this.list.render(height, width);
    },
  };
}

function planeView() {
  let mode = 'issues'; // 'issues' | 'select-project' | 'select-crawl-scope'
  let inFlight = false;
  let lastKey = '';
  let loaded = false;
  let projectFilter = '';
  let issueFilter = '';
  let cachedProjects = [];
  let cachedIssues = [];

  const getIssueActions = () => [
    { key: 'enter', label: 'open' },
    { key: '/', label: 'search' },
    ...(issueFilter ? [{ key: 'c', label: 'clear' }] : []),
    { key: 's', label: 'sync' },
    { key: 'p', label: 'project' },
    { key: 'k', label: 'api key' },
    { key: 'r', label: 'reload' },
    { key: 'escape', label: 'close' },
  ];

  const getSelectProjectActions = () => [
    { key: 'enter', label: 'select' },
    { key: '/', label: 'search' },
    ...(projectFilter ? [{ key: 'c', label: 'clear' }] : []),
    { key: 'i', label: 'input id' },
    { key: 'k', label: 'api key' },
    { key: 'r', label: 'reload' },
    { key: 'escape', label: 'back' },
  ];

  const notConfiguredActions = [
    { key: 'enter', label: 'set key' },
    { key: 'i', label: 'input id' },
    { key: 'k', label: 'api key' },
    { key: 'r', label: 'reload' },
    { key: 'escape', label: 'close' },
  ];

  const selectCrawlActions = [
    { key: 'enter', label: 'crawl' },
    { key: 'escape', label: 'back' },
  ];

  const viewObj = {
    title: 'Plane',
    actions: getIssueActions(),
    list: new List([{ type: 'item', icon: icon('empty'), label: 'loading…', disabled: true }]),
    inputApiKey(app, cfg) {
      const currentKey = (cfg && cfg.apiKey) || '';
      const onGotKey = (entered) => {
        if (!entered || !entered.trim()) {
          if (app) app.setStatus('API key input cancelled', 'info');
          if (app && app.render) app.render();
          return;
        }
        const res = plane.saveApiKey(entered.trim());
        if (!res.ok) {
          if (app) app.setStatus(res.error || 'failed to save API key', 'error');
          if (app && app.render) app.render();
          return;
        }
        if (app) app.setStatus('saved Plane API key to plane.json', 'ok');
        const cwd = app && app.ctx ? app.ctx.cwd : process.cwd();
        const updatedCfg = plane.config(cwd);
        if (!updatedCfg.projectId) {
          this.loadProjects(app, updatedCfg);
        } else {
          this.refresh(app, { force: true });
        }
        if (app && app.render) app.render();
      };

      if (app) {
        app.setStatus('waiting for API key input…', 'info');
        if (app.render) app.render();
      }

      const guiKey = plane.promptApiKey(currentKey);
      if (guiKey !== null && guiKey !== undefined) {
        onGotKey(guiKey);
        return;
      }

      if (app && typeof app.prompt === 'function') {
        app.prompt('Enter Plane API Key', { defaultValue: currentKey }, (entered) => {
          onGotKey(entered);
        });
      }
    },
    inputProjectId(app, cfg) {
      if (!app || typeof app.prompt !== 'function') return;
      app.prompt('Enter Project ID, Slug, or Key (e.g. UUID, COD)', { defaultValue: '' }, (entered) => {
        if (!entered || !entered.trim()) {
          if (app) app.setStatus('project ID input cancelled', 'info');
          if (app && app.render) app.render();
          return;
        }
        const val = entered.trim();
        const matched = plane.findProject(cachedProjects, val);
        const chosenId = matched ? matched.id : val;
        const displayName = matched ? `${matched.name} [${matched.identifier || matched.id}]` : val;

        const target = cfg.parentRoot || (app.ctx && app.ctx.cwd) || process.cwd();
        plane.saveWorkspaceProjectId(target, chosenId);
        if (app) app.setStatus(`linked project "${displayName}" · select tasks to crawl`, 'ok');
        const updatedCfg = plane.config(target);
        this.loadCrawlOptions(app, updatedCfg);
      });
    },
    promptProjectSearch(app, cfg) {
      if (!app || typeof app.prompt !== 'function') return;
      app.prompt(
        'Search projects',
        {
          defaultValue: projectFilter,
          onChange: (q) => {
            projectFilter = (q || '').trim();
            this.actions = getSelectProjectActions();
            this.renderProjects(app, cfg);
          },
        },
        (confirmed) => {
          if (confirmed !== null) {
            projectFilter = (confirmed || '').trim();
            if (app) {
              app.setStatus(projectFilter ? `filtering projects by "${projectFilter}"` : 'all projects', 'info');
            }
          }
          this.actions = getSelectProjectActions();
          this.renderProjects(app, cfg);
        }
      );
    },
    promptIssueSearch(app, cfg) {
      if (!app || typeof app.prompt !== 'function') return;
      app.prompt(
        'Search issues',
        {
          defaultValue: issueFilter,
          onChange: (q) => {
            issueFilter = (q || '').trim();
            this.actions = getIssueActions();
            this.renderIssues(app, cfg);
          },
        },
        (confirmed) => {
          if (confirmed !== null) {
            issueFilter = (confirmed || '').trim();
            if (app) {
              app.setStatus(issueFilter ? `filtering issues by "${issueFilter}"` : 'all issues', 'info');
            }
          }
          this.actions = getIssueActions();
          this.renderIssues(app, cfg);
        }
      );
    },
    renderProjects(app, cfg) {
      const parentName = cfg.parentRoot ? path.basename(cfg.parentRoot) : 'Herd';
      const filterSuffix = projectFilter ? ` (filter: "${projectFilter}")` : '';
      const items = [{ type: 'group', label: `SELECT PROJECT${filterSuffix} · ${parentName}` }];

      items.push({
        type: 'item',
        label: 'Input Project ID / Key directly…',
        icon: icon('edit'),
        iconColor: sgr('edit'),
        hint: '[press i]',
        run: (a) => this.inputProjectId(a, cfg),
      });

      if (projectFilter) {
        items.push({
          type: 'item',
          label: `Clear search filter ("${projectFilter}")`,
          icon: icon('plane'),
          iconColor: sgr('plane'),
          hint: '[press c]',
          run: (a) => {
            projectFilter = '';
            this.actions = getSelectProjectActions();
            this.renderProjects(a, cfg);
            a.setStatus('search filter cleared', 'info');
            a.render();
          },
        });
      } else {
        items.push({
          type: 'item',
          label: 'Search projects…',
          icon: icon('search'),
          iconColor: sgr('search'),
          hint: '[press /]',
          run: (a) => this.promptProjectSearch(a, cfg),
        });
      }

      const filtered = plane.filterProjects(cachedProjects, projectFilter);
      for (const proj of filtered) {
        const isCurrent = proj.id === cfg.projectId;
        items.push({
          type: 'item',
          label: proj.name,
          icon: icon(isCurrent ? 'done' : 'plane'),
          iconColor: sgr(isCurrent ? 'done' : 'plane'),
          hint: `[${proj.identifier || ''}]`,
          itemData: { type: 'project', project: proj },
          run: (a) => {
            const target = cfg.parentRoot || (a.ctx && a.ctx.cwd) || process.cwd();
            plane.saveWorkspaceProjectId(target, proj.id);
            a.setStatus(`linked "${proj.name}" · select tasks to crawl`, 'info');
            const updatedCfg = plane.config(target);
            this.loadCrawlOptions(a, updatedCfg);
          },
        });
      }

      if (!filtered.length) {
        items.push({
          type: 'item',
          icon: icon('empty'),
          label: projectFilter ? `(no projects matching "${projectFilter}")` : '(no projects found)',
          disabled: true,
        });
      }

      items.push({
        type: 'item',
        label: 'Update API Key…',
        icon: icon('plane'),
        iconColor: sgr('plane'),
        hint: '[press k]',
        run: (a) => this.inputApiKey(a, cfg),
      });

      this.list.setItems(items);
      if (app && app.render) app.render();
    },
    renderIssues(app, cfg) {
      const filtered = plane.filterIssues(cachedIssues, issueFilter);
      const filterSuffix = issueFilter
        ? ` (${filtered.length} of ${cachedIssues.length} matching "${issueFilter}")`
        : ` (${cachedIssues.length})`;
      const items = [{ type: 'group', label: `ISSUES${filterSuffix}` }];
      if (this.crawlProgress) {
        items.push({
          type: 'item',
          icon: icon('plane'),
          iconColor: sgr('plane'),
          label: this.crawlProgress,
          disabled: true,
        });
      }

      if (issueFilter) {
        items.push({
          type: 'item',
          label: `Clear search filter ("${issueFilter}")`,
          icon: icon('plane'),
          iconColor: sgr('plane'),
          hint: '[press c]',
          run: (a) => {
            issueFilter = '';
            this.actions = getIssueActions();
            this.renderIssues(a, cfg);
            a.setStatus('search filter cleared', 'info');
            a.render();
          },
        });
      }

      for (const issue of filtered.slice(0, 100)) {
        items.push({
          type: 'item',
          label: `${issue.identifier ? `${issue.identifier}-` : ''}${issue.sequence} ${issue.name}`,
          icon: icon('issue'),
          iconColor: sgr('issue'),
          hint: issue.stateName,
          danger: issue.priority === 'urgent',
          run: (a) => {
            openBrowser(plane.webUrl(issue, cfg));
            a.setStatus(`opened ${issue.sequence} in browser`, 'ok');
          },
        });
      }

      if (filtered.length === 0) {
        items.push({
          type: 'item',
          icon: icon('empty'),
          label: issueFilter ? `(no issues matching "${issueFilter}")` : '(no issues)',
          disabled: true,
        });
      }

      this.list.setItems(items);
      if (app && app.render) app.render();
    },
    loadProjects(app, cfg) {
      mode = 'select-project';
      this.actions = getSelectProjectActions();
      this.list.setItems([
        { type: 'item', icon: icon('empty'), label: 'loading projects…', disabled: true },
        {
          type: 'item',
          label: 'Input Project ID / Key directly…',
          icon: icon('edit'),
          iconColor: sgr('edit'),
          hint: '[press i]',
          run: (a) => this.inputProjectId(a, cfg),
        },
      ]);
      if (app && app.render) app.render();

      if (!cfg.apiKey) {
        this.actions = notConfiguredActions;
        this.list.setItems([
          { type: 'group', label: 'PLANE · API KEY REQUIRED' },
          {
            type: 'item',
            label: 'Enter Plane API Key…',
            icon: icon('plane'),
            iconColor: sgr('plane'),
            hint: '[press k / enter]',
            run: (a) => this.inputApiKey(a, cfg),
          },
          {
            type: 'item',
            label: 'Input Project ID / Key directly…',
            icon: icon('edit'),
            iconColor: sgr('edit'),
            hint: '[press i]',
            run: (a) => this.inputProjectId(a, cfg),
          },
        ]);
        if (app && app.render) app.render();
        return;
      }

      plane
        .projects(cfg)
        .then((projs) => {
          cachedProjects = projs || [];
          this.renderProjects(app, cfg);
        })
        .catch((err) => {
          this.list.setItems([
            { type: 'group', label: 'ERROR LOADING PROJECTS' },
            { type: 'item', icon: icon('alert'), label: err.message.split('\n')[0], disabled: true },
            {
              type: 'item',
              label: 'Input Project ID / Key directly…',
              icon: icon('edit'),
              iconColor: sgr('edit'),
              hint: '[press i]',
              run: (a) => this.inputProjectId(a, cfg),
            },
            {
              type: 'item',
              icon: icon('plane'),
              iconColor: sgr('plane'),
              label: 'Set Plane API Key…',
              hint: '[press k / enter]',
              run: (a) => this.inputApiKey(a, cfg),
            },
            {
              type: 'item',
              icon: icon('empty'),
              label: 'set projectId in plane.json',
              disabled: true,
              hint: shorten(plane.configPath()),
            },
          ]);
          if (app && app.render) app.render();
        });
    },
    loadCrawlOptions(app, cfg) {
      mode = 'select-crawl-scope';
      this.actions = selectCrawlActions;
      const parentName = cfg.parentRoot ? path.basename(cfg.parentRoot) : 'Workspace';
      const items = [
        { type: 'group', label: `SELECT TASKS TO CRAWL · ${parentName}` },
        {
          type: 'item',
          label: 'Backlog + Todo',
          icon: icon('done'),
          iconColor: sgr('done'),
          hint: 'recommended',
          itemData: { type: 'crawl-preset', categories: ['backlog', 'todo'], label: 'Backlog + Todo' },
          run: (a) => this.executeCrawl(a, cfg, ['backlog', 'todo'], 'Backlog + Todo'),
        },
        {
          type: 'item',
          label: 'Active Tasks (Backlog, Todo, In Progress)',
          icon: icon('plane'),
          iconColor: sgr('plane'),
          hint: 'active tasks',
          itemData: { type: 'crawl-preset', categories: ['backlog', 'todo', 'in_progress'], label: 'Active Tasks' },
          run: (a) => this.executeCrawl(a, cfg, ['backlog', 'todo', 'in_progress'], 'Active Tasks'),
        },
        {
          type: 'item',
          label: 'All Tasks (All States)',
          icon: icon('plane'),
          iconColor: sgr('plane'),
          hint: 'full export',
          itemData: { type: 'crawl-preset', categories: ['all'], label: 'All Tasks' },
          run: (a) => this.executeCrawl(a, cfg, ['all'], 'All Tasks'),
        },
        {
          type: 'item',
          label: 'Backlog only',
          icon: icon('plane'),
          iconColor: sgr('plane'),
          hint: '🔴 backlog',
          itemData: { type: 'crawl-preset', categories: ['backlog'], label: 'Backlog' },
          run: (a) => this.executeCrawl(a, cfg, ['backlog'], 'Backlog'),
        },
        {
          type: 'item',
          label: 'Todo only',
          icon: icon('plane'),
          iconColor: sgr('plane'),
          hint: '🟡 todo',
          itemData: { type: 'crawl-preset', categories: ['todo'], label: 'Todo' },
          run: (a) => this.executeCrawl(a, cfg, ['todo'], 'Todo'),
        },
        {
          type: 'item',
          label: 'In Progress only',
          icon: icon('plane'),
          iconColor: sgr('plane'),
          hint: '🔵 in progress',
          itemData: { type: 'crawl-preset', categories: ['in_progress'], label: 'In Progress' },
          run: (a) => this.executeCrawl(a, cfg, ['in_progress'], 'In Progress'),
        },
        {
          type: 'item',
          label: 'Done only',
          icon: icon('plane'),
          iconColor: sgr('plane'),
          hint: '🟢 completed',
          itemData: { type: 'crawl-preset', categories: ['done'], label: 'Done' },
          run: (a) => this.executeCrawl(a, cfg, ['done'], 'Done'),
        },
      ];
      this.list.setItems(items);
      if (app && app.render) app.render();
    },
    executeCrawl(app, cfg, categories, label) {
      const cwd = app && app.ctx ? app.ctx.cwd : process.cwd();
      const target = cfg.parentRoot || cwd;
      this.crawlProgress = `[0%] crawling ${label} tasks & evidence…`;
      app.setStatus(this.crawlProgress, 'info');
      mode = 'issues';
      this.actions = getIssueActions();
      this.refresh(app, { force: true });
      plane
        .syncProject(target, cfg, { categories }, (msg) => {
          this.crawlProgress = msg;
          app.setStatus(msg, 'info');
          this.renderIssues(app, cfg);
          if (app.render) app.render();
        })
        .then((res) => {
          const wtCount = res.worktrees && res.worktrees.length ? ` (${res.worktrees.length} worktrees)` : '';
          this.crawlProgress = '';
          app.setStatus(`[100%] synced ${res.taskCount} tasks (${label}) → plane/TASK_LIST.md${wtCount}`, 'ok');
          this.refresh(app, { force: true });
        })
        .catch((err) => {
          this.crawlProgress = '';
          app.setStatus(`crawl failed: ${err.message.split('\n')[0]}`, 'error');
          this.renderIssues(app, cfg);
          if (app.render) app.render();
        });
    },
    onKey(key, app) {
      const cwd = app && app.ctx ? app.ctx.cwd : process.cwd();
      const cfg = plane.config(cwd);

      if (key === 'k') {
        this.inputApiKey(app, cfg);
        return true;
      }
      if (key === 'i') {
        this.inputProjectId(app, cfg);
        return true;
      }
      if (key === '/') {
        if (mode === 'select-project') {
          this.promptProjectSearch(app, cfg);
          return true;
        }
        if (mode === 'issues') {
          this.promptIssueSearch(app, cfg);
          return true;
        }
      }
      if (key === 'c') {
        if (mode === 'select-project' && projectFilter) {
          projectFilter = '';
          this.actions = getSelectProjectActions();
          this.renderProjects(app, cfg);
          app.setStatus('search filter cleared', 'info');
          app.render();
          return true;
        }
        if (mode === 'issues' && issueFilter) {
          issueFilter = '';
          this.actions = getIssueActions();
          this.renderIssues(app, cfg);
          app.setStatus('search filter cleared', 'info');
          app.render();
          return true;
        }
      }
      if (mode === 'select-project' || mode === 'select-crawl-scope') {
        if (key === 'escape' || key === 'q') {
          if (mode === 'select-project' && projectFilter) {
            projectFilter = '';
            this.actions = getSelectProjectActions();
            this.renderProjects(app, cfg);
            app.setStatus('search filter cleared', 'info');
            app.render();
            return true;
          }
          if (plane.isConfigured(cfg)) {
            mode = 'issues';
            this.actions = getIssueActions();
            this.refresh(app);
            app.render();
            return true;
          }
          return false;
        }
        return false;
      }
      if (key === 'escape') {
        if (mode === 'issues' && issueFilter) {
          issueFilter = '';
          this.actions = getIssueActions();
          this.renderIssues(app, cfg);
          app.setStatus('search filter cleared', 'info');
          app.render();
          return true;
        }
        return false;
      }
      if (key === 's') {
        if (!plane.isConfigured(cfg)) {
          if (!cfg.apiKey) {
            this.inputApiKey(app, cfg);
          } else {
            app.setStatus('select a project first to sync tasks', 'error');
            app.render();
          }
          return true;
        }
        this.loadCrawlOptions(app, cfg);
        return true;
      }
      if (key === 'p') {
        this.loadProjects(app, cfg);
        return true;
      }
      return false;
    },
    refresh(app, options = {}) {
      const cwd = app && app.ctx ? app.ctx.cwd : process.cwd();
      const cfg = plane.config(cwd);

      if (cfg && cfg.parentRoot) {
        try {
          plane.ensureWorktreePlane(cwd, cfg.parentRoot);
        } catch (_) {}
      }

      if (mode === 'select-project') {
        this.loadProjects(app, cfg);
        return;
      }

      if (!plane.isConfigured(cfg)) {
        lastKey = '';
        inFlight = false;
        loaded = false;
        if (!cfg.apiKey) {
          this.actions = notConfiguredActions;
          this.list.setItems([
            { type: 'group', label: 'PLANE · API KEY REQUIRED' },
            {
              type: 'item',
              icon: icon('plane'),
              iconColor: sgr('plane'),
              label: 'Enter Plane API Key…',
              hint: '[press k / enter]',
              run: (a) => this.inputApiKey(a, cfg),
            },
            {
              type: 'item',
              label: 'Input Project ID / Key directly…',
              icon: icon('edit'),
              iconColor: sgr('edit'),
              hint: '[press i]',
              run: (a) => this.inputProjectId(a, cfg),
            },
            {
              type: 'item',
              icon: icon('empty'),
              label: `Base: ${cfg.baseUrl} (${cfg.workspaceSlug})`,
              disabled: true,
            },
            {
              type: 'item',
              icon: icon('empty'),
              label: 'plane.json',
              disabled: true,
              hint: shorten(plane.configPath()),
            },
          ]);
          return;
        }

        const missingProjectOnly = Boolean(cfg && cfg.baseUrl && cfg.workspaceSlug && cfg.apiKey && !cfg.projectId);
        if (missingProjectOnly) {
          this.loadProjects(app, cfg);
          return;
        }
        this.actions = notConfiguredActions;
        this.list.setItems([
          { type: 'group', label: 'NOT CONFIGURED' },
          {
            type: 'item',
            label: 'Input Project ID / Key directly…',
            icon: icon('edit'),
            iconColor: sgr('edit'),
            hint: '[press i]',
            run: (a) => this.inputProjectId(a, cfg),
          },
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

      this.actions = getIssueActions();
      const cfgKey = `${cfg.baseUrl}|${cfg.workspaceSlug}|${cfg.projectId}|${cfg.apiKey}`;
      const isForced = Boolean(options.force || cfgKey !== lastKey);

      if (options.periodic && loaded && !isForced) {
        return;
      }

      if (loaded && !isForced) {
        return;
      }

      if (inFlight) {
        return;
      }

      inFlight = true;
      lastKey = cfgKey;

      if (this.list.items.length === 0 || (isForced && this.list.items[0]?.label === 'loading…')) {
        this.list.setItems([{ type: 'item', icon: icon('empty'), label: 'loading…', disabled: true }]);
      }

      plane
        .issues(cfg)
        .then((issues) => {
          inFlight = false;
          loaded = true;
          cachedIssues = issues || [];
          this.renderIssues(app, cfg);
        })
        .catch((err) => {
          inFlight = false;
          loaded = true;
          cachedIssues = [];
          this.list.setItems([
            { type: 'group', label: 'ERROR' },
            {
              type: 'item',
              icon: icon('alert'),
              label: err.message.split('\n')[0],
              disabled: true,
            },
            {
              type: 'item',
              label: 'Input Project ID / Key directly…',
              icon: icon('edit'),
              iconColor: sgr('edit'),
              hint: '[press i]',
              run: (a) => this.inputProjectId(a, cfg),
            },
            {
              type: 'item',
              icon: icon('plane'),
              iconColor: sgr('plane'),
              label: 'Update Plane API Key…',
              hint: '[press k / enter]',
              run: (a) => this.inputApiKey(a, cfg),
            },
          ]);
          if (app && app.render) app.render();
        });
    },
    render(height, width) {
      return this.list.render(height, width);
    },
  };

  return viewObj;
}

const TOOLS = [
  {
    key: 'symlinks',
    label: 'Symlinks',
    menuLabel: 'Symlinks',
    iconKey: 'symlinks',
    popupEntrypoint: 'symlinks-popup',
    view: symlinkView,
    cols: 52,
  },
  {
    key: 'plane',
    label: 'Plane',
    menuLabel: 'Plane tasks',
    iconKey: 'plane',
    popupEntrypoint: 'plane-popup',
    view: planeView,
    cols: 64,
  },
];

const byKey = (key) => TOOLS.find((t) => t.key === key) || null;

module.exports = { TOOLS, byKey, symlinkView, planeView, shorten, openBrowser };
