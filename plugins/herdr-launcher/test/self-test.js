#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'bin');
const LIB_DIR = path.join(ROOT, 'lib');
const MANIFEST_PATH = path.join(ROOT, 'herdr-plugin.toml');

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (condition) {
    passed += 1;
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${message}\n`);
  } else {
    failed += 1;
    errors.push(message);
    process.stdout.write(`  \x1b[31m✖\x1b[0m ${message}\n`);
  }
}

function group(title) {
  process.stdout.write(`\n\x1b[1m\x1b[36m▶ ${title}\x1b[0m\n`);
}

function runScript(scriptPath, args = []) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function runJson(scriptPath, args = []) {
  const res = runScript(scriptPath, args);
  if (res.status !== 0) {
    throw new Error(`Script ${path.basename(scriptPath)} failed with status ${res.status}: ${res.stderr || res.stdout}`);
  }
  try {
    return JSON.parse(res.stdout.trim());
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${path.basename(scriptPath)}: ${res.stdout} (${err.message})`);
  }
}

function parseTomlBasic(content) {
  const panes = [];
  const actions = [];
  const keys = [];
  let currentObj = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line === '[[panes]]') {
      currentObj = {};
      panes.push(currentObj);
      continue;
    }
    if (line === '[[actions]]') {
      currentObj = {};
      actions.push(currentObj);
      continue;
    }
    if (line === '[[keys.command]]') {
      currentObj = {};
      keys.push(currentObj);
      continue;
    }
    if (line.startsWith('[[') && line.endsWith(']]')) {
      currentObj = {};
      continue;
    }

    if (currentObj && line.includes('=')) {
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      const valRaw = line.slice(idx + 1).trim();
      try {
        currentObj[key] = JSON.parse(valRaw);
      } catch (_) {
        currentObj[key] = valRaw.replace(/^"|"$/g, '');
      }
    }
  }
  return { panes, actions, keys };
}

function testSyntax() {
  group('1. JavaScript Syntax Verification');
  const jsFiles = [];

  for (const dir of [BIN_DIR, LIB_DIR, path.join(ROOT, 'test')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) jsFiles.push(path.join(dir, f));
    }
  }

  for (const file of jsFiles) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert(res.status === 0, `Syntax valid: ${path.relative(ROOT, file)}`);
  }
}

function testManifest() {
  group('2. Manifest Structure & Popup Configurations');
  assert(fs.existsSync(MANIFEST_PATH), 'herdr-plugin.toml exists');
  const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const { panes, actions } = parseTomlBasic(content);

  const paneIds = new Map(panes.map((p) => [p.id, p]));
  assert(paneIds.has('launcher-sidebar'), 'launcher-sidebar pane defined');
  assert(paneIds.get('launcher-sidebar')?.placement === 'split', 'launcher-sidebar has placement = split');
  assert(paneIds.has('symlinks-popup'), 'symlinks-popup pane defined');
  assert(paneIds.get('symlinks-popup')?.placement === 'popup', 'symlinks-popup has placement = popup');
  assert(paneIds.has('openspec-popup'), 'openspec-popup pane defined');
  assert(paneIds.get('openspec-popup')?.placement === 'popup', 'openspec-popup has placement = popup');
  assert(paneIds.has('plane-popup'), 'plane-popup pane defined');
  assert(paneIds.get('plane-popup')?.placement === 'popup', 'plane-popup has placement = popup');

  const actionIds = new Set(actions.map((a) => a.id));
  assert(actionIds.has('toggle-launcher'), 'action toggle-launcher defined');
  assert(actionIds.has('watch-tabs-start'), 'action watch-tabs-start defined');
  assert(actionIds.has('watch-tabs-stop'), 'action watch-tabs-stop defined');
  assert(actionIds.has('dock-launcher-everywhere'), 'action dock-launcher-everywhere defined');
  assert(actionIds.has('stack-mode'), 'action stack-mode defined');
  assert(actionIds.has('focus-mode'), 'action focus-mode defined');
  assert(actionIds.has('tool-symlinks'), 'action tool-symlinks defined');
  assert(actionIds.has('tool-openspec'), 'action tool-openspec defined');
  assert(actionIds.has('tool-plane'), 'action tool-plane defined');
  assert(actionIds.has('agent-terminal'), 'action agent-terminal defined');

  const configExamplePath = path.join(ROOT, 'config.example.toml');
  assert(fs.existsSync(configExamplePath), 'config.example.toml exists');
  const configContent = fs.readFileSync(configExamplePath, 'utf8');
  const { keys } = parseTomlBasic(configContent);
  const toggleKey = keys.find((k) => k.command === 'herdr-launcher.toggle-launcher');
  assert(toggleKey, 'config.example.toml defines herdr-launcher.toggle-launcher keybinding');
  assert(toggleKey.key === 'prefix+alt+space', 'config.example.toml maps toggle-launcher to prefix+alt+space (no prefix+l pane navigation conflict)');

  const stackKey = keys.find((k) => k.command === 'herdr-launcher.stack-mode');
  assert(stackKey, 'config.example.toml defines herdr-launcher.stack-mode keybinding');
  assert(stackKey.key === 'prefix+alt+m', 'config.example.toml maps stack-mode to prefix+alt+m (no prefix+z zoom conflict)');

  const symlinkKey = keys.find((k) => k.command === 'herdr-launcher.tool-symlinks');
  assert(symlinkKey, 'config.example.toml defines herdr-launcher.tool-symlinks keybinding');
  assert(symlinkKey.key === 'prefix+alt+y', 'config.example.toml maps tool-symlinks to prefix+alt+y');

  const paneNavConflict = keys.find((k) => k.key === 'prefix+l');
  assert(!paneNavConflict, 'no keybinding in config.example.toml uses prefix+l (preserves native right-pane navigation)');

  const zoomConflict = keys.find((k) => k.key === 'prefix+z');
  assert(!zoomConflict, 'no keybinding in config.example.toml uses prefix+z (preserves native zoom)');
}

function testToolPopupsDryRun() {
  group('3. Workspace Tool Popup Launchers (Dry Run)');
  const toolLaunchJs = path.join(BIN_DIR, 'tool-launch.js');

  const symlinkRes = runJson(toolLaunchJs, ['symlinks', '--dry-run']);
  assert(symlinkRes.action === 'open', 'symlinks launch reports action = open');
  assert(symlinkRes.tool === 'symlinks', 'symlinks launch specifies tool = symlinks');
  assert(symlinkRes.entrypoint === 'symlinks-popup', 'symlinks launch targets symlinks-popup');

  const openspecRes = runJson(toolLaunchJs, ['openspec', '--dry-run']);
  assert(openspecRes.action === 'open', 'openspec launch reports action = open');
  assert(openspecRes.tool === 'openspec', 'openspec launch specifies tool = openspec');
  assert(openspecRes.entrypoint === 'openspec-popup', 'openspec launch targets openspec-popup');

  const planeRes = runJson(toolLaunchJs, ['plane', '--dry-run']);
  assert(planeRes.action === 'open', 'plane launch reports action = open');
  assert(planeRes.tool === 'plane', 'plane launch specifies tool = plane');
  assert(planeRes.entrypoint === 'plane-popup', 'plane launch targets plane-popup');

  const toggleLauncherJs = path.join(BIN_DIR, 'toggle-launcher.js');
  const toggleRes = runJson(toggleLauncherJs, ['--dry-run']);
  assert(
    toggleRes.action === 'open' || toggleRes.action === 'close' || toggleRes.action === 'focus',
    'toggle-launcher dry-run works'
  );

  const watchTabsJs = path.join(BIN_DIR, 'watch-tabs.js');
  const watchDry = runJson(watchTabsJs, ['--dry-run']);
  assert(watchDry.action === 'watch' && watchDry.dryRun === true, 'watch-tabs default dry-run works');
  const watchStartDry = runJson(watchTabsJs, ['--start', '--dry-run']);
  assert(watchStartDry.action === 'start' && watchStartDry.dryRun === true, 'watch-tabs --start dry-run works');
  const watchStopDry = runJson(watchTabsJs, ['--stop', '--dry-run']);
  assert(watchStopDry.action === 'stop' && watchStopDry.dryRun === true, 'watch-tabs --stop dry-run works');
  const watchOnceDry = runJson(watchTabsJs, ['--once', '--dry-run']);
  assert(watchOnceDry.action === 'dock-once' && watchOnceDry.dryRun === true, 'watch-tabs --once dry-run works');

  const startupJs = path.join(BIN_DIR, 'startup.js');
  const startupDry = runJson(startupJs, ['--dry-run', '--timeout', '100']);
  assert(startupDry.action === 'startup' || startupDry.action === 'noop', 'startup.js dry-run works');

  const dock = require('../lib/dock');
  assert(dock.BAR_COLS === 20, 'dock.BAR_COLS is 20 columns');
  assert(dock.EXPANDED_COLS === 22, 'dock.EXPANDED_COLS is 22 columns (20 bar cols + 2 border overhead)');
  assert(dock.defaultCols() === 22, 'dock.defaultCols() defaults to 22 columns');
  assert(typeof dock.maintainSidebarSize === 'function', 'dock.maintainSidebarSize is exported');
  assert(typeof dock.fallbackTerminal === 'function', 'dock.fallbackTerminal is exported');
  assert(typeof dock.reconcileTab === 'function', 'dock.reconcileTab is exported');
}

function testAgentLaunchersDryRun() {
  group('4. Agent YOLO Launchers (Dry Run)');
  const { AGENTS } = require('../lib/agents');
  assert(AGENTS[0]?.key === 'agy-yolo', 'antigravity is first in AGENTS list');
  assert(AGENTS[1]?.key === 'claude-danger', 'claude is second in AGENTS list');
  assert(AGENTS[4]?.key === 'terminal', 'terminal is fifth in AGENTS list');

  const agentLaunchJs = path.join(BIN_DIR, 'agent-launch.js');

  const opencode = runJson(agentLaunchJs, ['opencode-auto', '--dry-run']);
  assert(opencode.kind === 'opencode' && opencode.args.includes('--auto'), 'opencode-auto uses --auto flag');

  const agy = runJson(agentLaunchJs, ['agy-yolo', '--dry-run']);
  assert(agy.kind === 'agy' && agy.args.includes('--dangerously-skip-permissions'), 'agy-yolo uses --dangerously-skip-permissions');

  const codex = runJson(agentLaunchJs, ['codex-yolo', '--dry-run']);
  assert(codex.kind === 'codex' && codex.args.includes('--dangerously-bypass-approvals-and-sandbox'), 'codex-yolo uses --dangerously-bypass-approvals-and-sandbox');

  const claude = runJson(agentLaunchJs, ['claude-danger', '--dry-run']);
  assert(claude.kind === 'claude' && claude.args.includes('--dangerously-skip-permissions'), 'claude-danger uses --dangerously-skip-permissions');

  const terminal = runJson(agentLaunchJs, ['terminal', '--dry-run']);
  assert(terminal.kind === 'terminal', 'terminal launch targets native terminal');
}

function testAppLaunchersDryRun() {
  group('5. App Launchers & Stack Mode (Dry Run)');
  const appOpenJs = path.join(BIN_DIR, 'app-open.js');

  for (const appKey of ['vscode', 'explorer', 'antigravity', 'android-studio']) {
    const res = runJson(appOpenJs, [appKey, '--dry-run']);
    assert(res.app === appKey && Boolean(res.cwd), `app-open ${appKey} dry-run resolves successfully`);
  }

  const stackModeJs = path.join(BIN_DIR, 'stack-mode.js');
  const stackRes = runJson(stackModeJs, ['--dry-run']);
  assert(stackRes.action === 'enter' || stackRes.action === 'exit', 'stack-mode toggle dry-run works');
  assert(typeof stackRes.stackMode === 'boolean', 'stack-mode reports boolean stackMode');

  const focusModeJs = path.join(BIN_DIR, 'focus-mode.js');
  const focusRes = runJson(focusModeJs, ['--dry-run']);
  assert(focusRes.action === 'enter' || focusRes.action === 'exit', 'focus-mode toggle dry-run works (compat)');

  const stash = require('../lib/stash');
  assert(typeof stash.isStackModeOn === 'function', 'stash.isStackModeOn is exported');
  assert(typeof stash.setStackMode === 'function', 'stash.setStackMode is exported');
  assert(typeof stash.isFocusModeOn === 'function', 'stash.isFocusModeOn is exported');
  assert(typeof stash.setFocusMode === 'function', 'stash.setFocusMode is exported');
  assert(typeof stash.isStashTab === 'function', 'stash.isStashTab is exported');
  assert(typeof stash.prune === 'function', 'stash.prune is exported');
}

function testViewComponents() {
  group('6. View Registry & Action Footers');
  const views = require('../lib/views');
  const { App } = require('../lib/app');

  assert(Array.isArray(views.TOOLS) && views.TOOLS.length === 3, 'views.TOOLS contains 3 workspace tools');

  const symlinkDef = views.byKey('symlinks');
  assert(symlinkDef?.popupEntrypoint === 'symlinks-popup', 'symlinks has popupEntrypoint symlinks-popup');
  const symlinkView = symlinkDef.view();
  assert(symlinkView.actions.some((a) => a.key === 'escape' && a.label === 'close'), 'symlinkView action footer includes [esc close]');
  assert(symlinkView.actions.some((a) => a.key === 'b' && a.label === 'browse'), 'symlinkView action footer includes [b browse]');
  assert(symlinkView.actions.some((a) => a.key === 'e' && a.label === 'explore'), 'symlinkView action footer includes [e explore]');
  assert(symlinkView.actions.some((a) => a.key === 'd' && a.label === 'delete'), 'symlinkView action footer includes [d delete]');

  const symlinksLib = require('../lib/symlinks');
  assert(typeof symlinksLib.browseFolder === 'function', 'symlinks.browseFolder is exported as a function');
  assert(typeof symlinksLib.addPersistentTarget === 'function', 'symlinks.addPersistentTarget is exported as a function');
  assert(typeof symlinksLib.create === 'function', 'symlinks.create is exported as a function');
  assert(typeof symlinksLib.remove === 'function', 'symlinks.remove is exported as a function');

  // Verify refresh populates browse item
  const mockApp = {
    ctx: { cwd: ROOT },
    setStatus: () => {},
    render: () => {},
  };
  symlinkView.refresh(mockApp);
  const items = symlinkView.list.items;
  assert(
    items.some((i) => i.itemData && i.itemData.type === 'browse' && i.label === 'Browse'),
    'symlinkView includes Browse item with label Browse'
  );

  const openspecLib = require('../lib/openspec');
  assert(typeof openspecLib.toolkitRoot === 'function', 'openspec.toolkitRoot is exported');
  const resolvedToolkit = openspecLib.toolkitRoot();
  assert(Boolean(resolvedToolkit && fs.existsSync(resolvedToolkit)), 'openspec.toolkitRoot resolves bundled toolkit path');
  const openspecStatus = openspecLib.status(ROOT);
  assert(openspecStatus.length === 5, 'openspec.status returns all 5 components');
  assert(openspecStatus.every((c) => c.available), 'all openspec components are available from bundled toolkit');

  const openspecDef = views.byKey('openspec');
  assert(openspecDef?.popupEntrypoint === 'openspec-popup', 'openspec has popupEntrypoint openspec-popup');
  const openspecView = openspecDef.view();
  assert(openspecView.actions.some((a) => a.key === 'escape' && a.label === 'close'), 'openspecView action footer includes [esc close]');
  openspecView.refresh(mockApp);
  assert(
    !openspecView.list.items.some((i) => i.label === 'SOURCE NOT FOUND'),
    'openspecView does not show SOURCE NOT FOUND when bundled toolkit is present'
  );
  assert(
    openspecView.list.items.some((i) => i.label && i.label.includes('Core Infrastructure')),
    'openspecView renders Core Infrastructure component'
  );

  const planeDef = views.byKey('plane');
  assert(planeDef?.popupEntrypoint === 'plane-popup', 'plane has popupEntrypoint plane-popup');
  const planeView = planeDef.view();
  assert(planeView.actions.some((a) => a.key === 'escape' && a.label === 'close'), 'planeView action footer includes [esc close]');
  assert(planeView.actions.some((a) => a.key === 's' && a.label === 'sync'), 'planeView action footer includes [s sync]');
  assert(planeView.actions.some((a) => a.key === 'p' && a.label === 'project'), 'planeView action footer includes [p project]');
  assert(planeView.actions.some((a) => a.key === 'k' && a.label === 'api key'), 'planeView action footer includes [k api key]');
  assert(planeView.actions.some((a) => a.key === 'enter' && a.label === 'open'), 'planeView action footer includes [enter open]');
  assert(typeof planeView.loadProjects === 'function', 'planeView supports loadProjects for parent workspace');
  assert(typeof planeView.loadCrawlOptions === 'function', 'planeView supports loadCrawlOptions for category selection');
  assert(typeof planeView.inputApiKey === 'function', 'planeView supports inputApiKey for entering and saving API key');

  // Test in-app prompt
  const rootMenu = { title: 'Launcher', render: () => [] };
  const subView = { title: 'SubView', render: () => [] };
  const app = new App({ view: () => rootMenu });
  app.screen = { draw: () => {} };
  app.view = rootMenu;
  app.setView(subView);
  assert(app.view === subView, 'setView switches view in-place');
  assert(app.viewHistory.length === 1 && app.viewHistory[0] === rootMenu, 'setView records view history');
  const popped = app.popView();
  assert(popped === true && app.view === rootMenu, 'popView returns to root launcher menu');
  assert(app.viewHistory.length === 0, 'viewHistory is emptied after popView');

  let promptSubmitted = null;
  app.prompt('Enter API Key', { defaultValue: 'initial_val' }, (res) => {
    promptSubmitted = res;
  });
  assert(app.promptState && app.promptState.buffer === 'initial_val', 'app.prompt initializes promptState buffer');
  app.handleKey('x');
  assert(app.promptState.buffer === 'initial_valx', 'app.handleKey appends char in prompt mode');
  app.handleKey('backspace');
  assert(app.promptState.buffer === 'initial_val', 'app.handleKey backspace removes char in prompt mode');
  app.handleKey('enter');
  assert(promptSubmitted === 'initial_val', 'app.handleKey enter submits prompt value');
  assert(app.promptState === null, 'promptState is cleared after submit');
}

function testPlaneConfig() {
  group('7. Plane Integration & Parent Workspace Resolution');
  const os = require('node:os');
  const plane = require('../lib/plane');
  const context = require('../lib/context');

  const prevConfig = context.readConfig(plane.CONFIG_FILE);

  assert(plane.DEFAULT_PLANE_CONFIG.baseUrl === 'https://plane.itgproduct.com', 'plane default baseUrl matches CodingSpace');
  assert(plane.DEFAULT_PLANE_CONFIG.workspaceSlug === 'product', 'plane default workspaceSlug is product');
  assert(plane.DEFAULT_PLANE_CONFIG.apiKey === '', 'plane default apiKey is empty and not hardcoded');
  assert(typeof plane.saveApiKey === 'function', 'plane.saveApiKey is exported');
  assert(typeof plane.promptApiKey === 'function', 'plane.promptApiKey is exported');

  const saveRes = plane.saveApiKey('plane_api_test_save_key_999');
  assert(saveRes.ok === true && saveRes.apiKey === 'plane_api_test_save_key_999', 'plane.saveApiKey successfully saves key');

  const cfg = plane.config('D:/unknown/path');
  assert(cfg.baseUrl === 'https://plane.itgproduct.com', 'resolved cfg baseUrl falls back to default');
  assert(cfg.workspaceSlug === 'product', 'resolved cfg workspaceSlug falls back to default');
  assert(cfg.apiKey === 'plane_api_test_save_key_999', 'resolved cfg apiKey retrieves saved key from plane.json');

  // Restore previous config state
  if (prevConfig) {
    context.writeConfig(plane.CONFIG_FILE, prevConfig);
  } else {
    try {
      const cur = context.readConfig(plane.CONFIG_FILE) || {};
      delete cur.apiKey;
      context.writeConfig(plane.CONFIG_FILE, cur);
    } catch (_) {}
  }

  const mapping = {
    'D:/Quest/CodingSpace.worktrees/CodingSpace-Plane': '72f1bdd9-8420-469f-93f7-fe27b6658b9c',
    'D:/Quest/ParentApp': '11111111-2222-3333-4444-555555555555',
  };
  const exact = plane.resolveProjectId(mapping, 'D:\\Quest\\CodingSpace.worktrees\\CodingSpace-Plane');
  assert(exact === '72f1bdd9-8420-469f-93f7-fe27b6658b9c', 'resolveProjectId matches exact normalized path');

  const baseMatch = plane.resolveProjectId(mapping, 'C:\\other\\CodingSpace-Plane');
  assert(baseMatch === '72f1bdd9-8420-469f-93f7-fe27b6658b9c', 'resolveProjectId matches by basename');

  // Test findParentRepoRoot and worktree resolution
  assert(typeof context.findParentRepoRoot === 'function', 'context.findParentRepoRoot is exported');
  const repoParent = context.findParentRepoRoot(__dirname);
  assert(Boolean(repoParent && fs.existsSync(repoParent)), 'findParentRepoRoot resolves repository root for current workspace');

  // Test parent workspace / herd resolution across simulated linked worktree
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-plane-test-'));
  try {
    const parentRepo = path.join(tmpDir, 'parent-workspace');
    const dotGit = path.join(parentRepo, '.git');
    const wtGitDir = path.join(dotGit, 'worktrees', 'feat-wt');
    const linkedWorktree = path.join(tmpDir, 'linked-worktree-feat');
    const subFolder = path.join(linkedWorktree, 'src', 'components');

    fs.mkdirSync(wtGitDir, { recursive: true });
    fs.mkdirSync(subFolder, { recursive: true });
    fs.writeFileSync(path.join(wtGitDir, 'commondir'), '../..\n', 'utf8');
    fs.writeFileSync(path.join(linkedWorktree, '.git'), `gitdir: ${wtGitDir}\n`, 'utf8');

    const resolvedParent = context.findParentRepoRoot(subFolder);
    assert(
      resolvedParent && path.resolve(resolvedParent).toLowerCase() === path.resolve(parentRepo).toLowerCase(),
      'findParentRepoRoot resolves main repo root from worktree subfolder'
    );

    const herdMapping = {
      [parentRepo]: 'parent-plane-id-999',
    };

    const resolvedFromWorktree = plane.resolveProjectId(herdMapping, linkedWorktree);
    assert(resolvedFromWorktree === 'parent-plane-id-999', 'resolveProjectId resolves parent workspace project ID for worktree');

    const resolvedFromSubfolder = plane.resolveProjectId(herdMapping, subFolder);
    assert(resolvedFromSubfolder === 'parent-plane-id-999', 'resolveProjectId resolves parent workspace project ID for worktree subfolder');

    // Test local .plane.json in parent repository
    fs.writeFileSync(
      path.join(parentRepo, '.plane.json'),
      JSON.stringify({ projectId: 'local-parent-id-888', workspaceSlug: 'local-slug' }),
      'utf8'
    );
    const localCfg = plane.config(subFolder);
    assert(localCfg.projectId === 'local-parent-id-888', 'plane.config picks up local .plane.json from parent workspace');
    assert(localCfg.workspaceSlug === 'local-slug', 'plane.config picks up workspaceSlug from local .plane.json');

    // Test task list markdown generator & HTML cleaner
    assert(typeof plane.generateTaskListMD === 'function', 'plane.generateTaskListMD is exported');
    assert(typeof plane.syncProject === 'function', 'plane.syncProject is exported');
    assert(plane.cleanHTML('<p>Test <b>evidence</b> link</p>') === 'Test evidence link', 'plane.cleanHTML strips HTML tags');
    assert(plane.formatPriority('urgent').includes('Urgent'), 'plane.formatPriority formats urgent with emoji');

    const sampleIssues = [
      { sequence_id: 101, name: 'Fix Login Crash', state: 's1', priority: 'urgent', description_html: 'Crash log' },
      { sequence_id: 102, name: 'Improve UI design', state: 's2', priority: 'low', description_html: 'Screenshots' },
    ];
    const sampleStateMap = new Map([
      ['s1', { id: 's1', name: 'Backlog', group: 'backlog' }],
      ['s2', { id: 's2', name: 'In Progress', group: 'started' }],
    ]);
    const md = plane.generateTaskListMD({ workspaceSlug: 'product', projectId: 'test-proj' }, sampleIssues, sampleStateMap);
    assert(md.includes('Fix Login Crash') && md.includes('Improve UI design'), 'generateTaskListMD includes all task titles');
    assert(md.includes('Backlog') && md.includes('In Progress'), 'generateTaskListMD categorizes tasks into groups');
    assert(md.includes('#101') || md.includes('101'), 'generateTaskListMD includes task sequence tags');

    const mdFiltered = plane.generateTaskListMD({ workspaceSlug: 'product', projectId: 'test-proj' }, sampleIssues, sampleStateMap, null, null, ['backlog']);
    assert(mdFiltered.includes('Fix Login Crash') && !mdFiltered.includes('Improve UI design'), 'generateTaskListMD with [backlog] filter only includes backlog tasks');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function testMouseInput() {
  group('8. Mouse Tracking & Interaction');
  const tui = require('../lib/tui');
  const { App } = require('../lib/app');

  // Test SGR mouse parsing
  const sgrClick = Buffer.from('\x1b[<0;15;8M');
  const parsedSgr = tui.parseKeys(sgrClick);
  assert(parsedSgr.length === 1 && parsedSgr[0].mouse, 'parseKeys parses SGR mouse click event');
  assert(parsedSgr[0].mouse.x === 15 && parsedSgr[0].mouse.y === 8 && parsedSgr[0].mouse.pressed, 'SGR mouse coordinates and pressed state match');

  // Windows console mouse restoration (setRawMode clears ENABLE_MOUSE_INPUT, killing SGR delivery)
  const winmouse = require('../lib/winmouse');
  assert(typeof winmouse.restoreMouseInput === 'function', 'winmouse exports restoreMouseInput');
  assert(fs.existsSync(winmouse.SCRIPT), 'win-mouse-input.ps1 is present in bin/');
  assert(
    /ENABLE_MOUSE_INPUT/.test(fs.readFileSync(winmouse.SCRIPT, 'utf8')),
    'win-mouse-input.ps1 restores ENABLE_MOUSE_INPUT'
  );
  if (process.platform !== 'win32') {
    assert(winmouse.restoreMouseInput() === false, 'restoreMouseInput is a no-op off win32');
  }
  assert(
    /restoreMouseInput\(\)/.test(fs.readFileSync(path.join(ROOT, 'lib', 'tui.js'), 'utf8')),
    'Screen.start calls restoreMouseInput'
  );

  // Test SGR mouse wheel
  const sgrWheel = Buffer.from('\x1b[<64;10;5M');
  const parsedWheel = tui.parseKeys(sgrWheel);
  assert(parsedWheel.length === 1 && parsedWheel[0].mouse.wheel === 'up', 'parseKeys parses SGR wheel up');

  // Test single click activation in App
  let activated = false;
  const dummyItem = {
    type: 'item',
    label: 'Test Item',
    run: () => { activated = true; },
  };
  const list = new tui.List([dummyItem]);
  let rendered = false;
  const dummyApp = {
    screen: { cols: 40, rows: 20, draw: () => {} },
    ctx: { cwd: process.cwd() },
    view: {
      title: 'Test',
      list,
      render: (h, w) => list.render(h, w),
    },
    chrome: () => ({ header: ['', '', '', '', ''], footer: ['', ''], hits: [] }),
    actionHits: [],
    bodyTop: 5,
    bodyHeight: 10,
    render: () => { rendered = true; },
    activate: function(item) { if (item && item.run) item.run(this); },
    handleKey: () => {},
  };
  // Render list so rowMap is populated
  list.render(10, 40);

  // Invoke handleMouse directly
  App.prototype.handleMouse.call(dummyApp, { button: 0, x: 5, y: 6, pressed: true, drag: false });
  assert(activated === true, 'handleMouse activates item on single click');
  assert(rendered === true, 'handleMouse triggers render after click');
}

function testTabWatcherAndAutoDock() {
  group('9. Tab Watcher & Auto-Dock on New Tab Creation');
  const dock = require('../lib/dock');
  const stash = require('../lib/stash');
  const context = require('../lib/context');

  // Test sidebarsIn detection
  const dummyPanes = [
    { pane_id: 'p-work-1', tab_id: 'tab-1', tokens: {} },
    { pane_id: 'p-launcher-1', tab_id: 'tab-1', tokens: { [context.OWNER_TOKEN]: 'herdr-launcher' } },
    { pane_id: 'p-work-2', tab_id: 'tab-2', tokens: {} },
  ];

  const sidebarsTab1 = dock.sidebarsIn(dummyPanes, 'tab-1');
  assert(sidebarsTab1.length === 1 && sidebarsTab1[0].pane_id === 'p-launcher-1', 'sidebarsIn identifies existing launcher in tab');

  const sidebarsTab2 = dock.sidebarsIn(dummyPanes, 'tab-2');
  assert(sidebarsTab2.length === 0, 'sidebarsIn returns empty for newly created tab without launcher');

  // Test dock.ensure noop when launcher already present
  const ensureExisting = dock.ensure({ tabId: 'tab-1', panes: dummyPanes });
  assert(ensureExisting === null, 'dock.ensure returns null when launcher already exists in tab');

  // Test stash tab exclusion for focus/stack mode
  assert(stash.isStashTab(stash.STASH_LABEL) === true, 'isStashTab correctly identifies stash tabs');
  assert(stash.isStashTab('My Work Tab') === false, 'isStashTab returns false for regular work tabs');

  // Test event envelope extraction logic used by watch-tabs.js
  function extractTabInfo(envelope) {
    const type =
      (envelope.data && envelope.data.type) ||
      envelope.event ||
      envelope.type ||
      (envelope.params && envelope.params.event) ||
      (envelope.params && envelope.params.type) ||
      '';

    if (type === 'tab_created' || type === 'tab.created') {
      const tabData =
        (envelope.data && envelope.data.tab) ||
        (envelope.params && envelope.params.data && envelope.params.data.tab) ||
        (envelope.params && envelope.params.tab) ||
        envelope.tab ||
        envelope.data ||
        envelope.params ||
        {};

      const tabId =
        tabData.tab_id ||
        envelope.tab_id ||
        (envelope.data && envelope.data.tab_id) ||
        (envelope.params && envelope.params.tab_id);

      const label = typeof tabData.label === 'string' ? tabData.label : null;
      return { tabId, label, paneCount: tabData.pane_count || 1 };
    }
    return null;
  }

  // Envelope variant 1: data.type + data.tab
  const env1 = { data: { type: 'tab.created', tab: { tab_id: 'tab-101', pane_count: 1 } } };
  const res1 = extractTabInfo(env1);
  assert(res1 && res1.tabId === 'tab-101', 'extractTabInfo parses standard tab.created event');

  // Envelope variant 2: root type + tab_id
  const env2 = { type: 'tab_created', tab_id: 'tab-102' };
  const res2 = extractTabInfo(env2);
  assert(res2 && res2.tabId === 'tab-102', 'extractTabInfo parses root tab_created event');

  // Envelope variant 3: params format
  const env3 = { method: 'events.event', event: 'tab.created', params: { tab: { tab_id: 'tab-103', label: 'Dev' } } };
  const res3 = extractTabInfo(env3);
  assert(res3 && res3.tabId === 'tab-103' && res3.label === 'Dev', 'extractTabInfo parses params tab.created event with label');

  // Verify autoDock defaults to true
  const watchCfg = context.readConfig('watch.json') || {};
  assert(watchCfg.autoDock !== false, 'autoDock configuration defaults to enabled (true)');
}

function main() {
  process.stdout.write('\x1b[1m\x1b[35m=== Herdr-Launcher Self-Test Suite ===\x1b[0m\n');
  const start = Date.now();

  try {
    testSyntax();
    testManifest();
    testToolPopupsDryRun();
    testAgentLaunchersDryRun();
    testAppLaunchersDryRun();
    testViewComponents();
    testPlaneConfig();
    testMouseInput();
    testTabWatcherAndAutoDock();
  } catch (err) {
    failed += 1;
    errors.push(`Unhandled error: ${err.message}\n${err.stack}`);
    process.stdout.write(`\n\x1b[31mFATAL: ${err.message}\x1b[0m\n`);
  }

  const duration = Date.now() - start;
  process.stdout.write(`\n\x1b[1mSummary: \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m (${duration}ms)\n`);

  if (failed > 0) {
    process.stdout.write('\n\x1b[31mErrors:\x1b[0m\n');
    for (const e of errors) process.stdout.write(`- ${e}\n`);
    process.exit(1);
  } else {
    process.stdout.write('\x1b[32mAll self-tests passed successfully!\x1b[0m\n');
    process.exit(0);
  }
}

main();
