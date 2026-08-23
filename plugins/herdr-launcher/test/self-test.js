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
  return { panes, actions };
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
  assert(paneIds.has('launcher-popup'), 'launcher-popup pane defined');
  assert(paneIds.get('launcher-popup')?.placement === 'popup', 'launcher-popup has placement = popup');

  assert(paneIds.has('symlinks-popup'), 'symlinks-popup pane defined');
  assert(paneIds.get('symlinks-popup')?.placement === 'popup', 'symlinks-popup has placement = popup');
  assert(paneIds.get('symlinks-popup')?.width === 52, 'symlinks-popup has width = 52');

  assert(paneIds.has('openspec-popup'), 'openspec-popup pane defined');
  assert(paneIds.get('openspec-popup')?.placement === 'popup', 'openspec-popup has placement = popup');
  assert(paneIds.get('openspec-popup')?.width === 44, 'openspec-popup has width = 44');

  assert(paneIds.has('plane-popup'), 'plane-popup pane defined');
  assert(paneIds.get('plane-popup')?.placement === 'popup', 'plane-popup has placement = popup');
  assert(paneIds.get('plane-popup')?.width === 64, 'plane-popup has width = 64');

  const actionIds = new Set(actions.map((a) => a.id));
  assert(actionIds.has('tool-symlinks'), 'action tool-symlinks defined');
  assert(actionIds.has('tool-openspec'), 'action tool-openspec defined');
  assert(actionIds.has('tool-plane'), 'action tool-plane defined');
  assert(actionIds.has('agent-terminal'), 'action agent-terminal defined');
}

function testToolPopupsDryRun() {
  group('3. Workspace Tool Popups (Dry Run)');
  const toolLaunchJs = path.join(BIN_DIR, 'tool-launch.js');

  const symlinkRes = runJson(toolLaunchJs, ['symlinks', '--dry-run']);
  assert(symlinkRes.action === 'open', 'symlinks launch reports action = open');
  assert(symlinkRes.tool === 'symlinks', 'symlinks launch specifies tool = symlinks');
  assert(symlinkRes.entrypoint === 'symlinks-popup', 'symlinks launch targets entrypoint symlinks-popup');
  assert(Array.isArray(symlinkRes.command) && symlinkRes.command.includes('--entrypoint'), 'symlinks invokes herdr plugin pane open');

  const openspecRes = runJson(toolLaunchJs, ['openspec', '--dry-run']);
  assert(openspecRes.action === 'open', 'openspec launch reports action = open');
  assert(openspecRes.tool === 'openspec', 'openspec launch specifies tool = openspec');
  assert(openspecRes.entrypoint === 'openspec-popup', 'openspec launch targets entrypoint openspec-popup');

  const planeRes = runJson(toolLaunchJs, ['plane', '--dry-run']);
  assert(planeRes.action === 'open', 'plane launch reports action = open');
  assert(planeRes.tool === 'plane', 'plane launch specifies tool = plane');
  assert(planeRes.entrypoint === 'plane-popup', 'plane launch targets entrypoint plane-popup');

  const popupLauncherJs = path.join(BIN_DIR, 'popup-launcher.js');
  const popupRes = runJson(popupLauncherJs, ['--dry-run']);
  assert(popupRes.action === 'open', 'launcher popup reports action = open');
  assert(popupRes.command.includes('launcher-popup'), 'launcher popup targets launcher-popup');
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
  group('5. App Launchers & Focus Mode (Dry Run)');
  const appOpenJs = path.join(BIN_DIR, 'app-open.js');

  for (const appKey of ['vscode', 'explorer', 'antigravity', 'android-studio']) {
    const res = runJson(appOpenJs, [appKey, '--dry-run']);
    assert(res.app === appKey && Boolean(res.cwd), `app-open ${appKey} dry-run resolves successfully`);
  }

  const focusModeJs = path.join(BIN_DIR, 'focus-mode.js');
  const focusRes = runJson(focusModeJs, ['--dry-run']);
  assert(focusRes.action === 'enter' || focusRes.action === 'exit', 'focus-mode toggle dry-run works');
}

function testViewComponents() {
  group('6. View Registry & Action Footers');
  const views = require('../lib/views');

  assert(Array.isArray(views.TOOLS) && views.TOOLS.length === 3, 'views.TOOLS contains 3 workspace tools');

  const symlinkDef = views.byKey('symlinks');
  assert(symlinkDef?.popupEntrypoint === 'symlinks-popup', 'symlinks has popupEntrypoint symlinks-popup');
  const symlinkView = symlinkDef.view();
  assert(symlinkView.actions.some((a) => a.key === 'escape' && a.label === 'close'), 'symlinkView action footer includes [esc close]');

  const openspecDef = views.byKey('openspec');
  assert(openspecDef?.popupEntrypoint === 'openspec-popup', 'openspec has popupEntrypoint openspec-popup');
  const openspecView = openspecDef.view();
  assert(openspecView.actions.some((a) => a.key === 'escape' && a.label === 'close'), 'openspecView action footer includes [esc close]');

  const planeDef = views.byKey('plane');
  assert(planeDef?.popupEntrypoint === 'plane-popup', 'plane has popupEntrypoint plane-popup');
  const planeView = planeDef.view();
  assert(planeView.actions.some((a) => a.key === 'escape' && a.label === 'close'), 'planeView action footer includes [esc close]');
}

function testPlaneConfig() {
  group('7. Plane Integration & Defaults');
  const plane = require('../lib/plane');

  assert(plane.DEFAULT_PLANE_CONFIG.baseUrl === 'https://plane.itgproduct.com', 'plane default baseUrl matches CodingSpace');
  assert(plane.DEFAULT_PLANE_CONFIG.workspaceSlug === 'product', 'plane default workspaceSlug is product');
  assert(plane.DEFAULT_PLANE_CONFIG.apiKey === 'plane_api_68b11fbeb14c431cad3a1f87455b622a', 'plane default apiKey matches user key');

  const cfg = plane.config('D:/unknown/path');
  assert(cfg.baseUrl === 'https://plane.itgproduct.com', 'resolved cfg baseUrl falls back to default');
  assert(cfg.workspaceSlug === 'product', 'resolved cfg workspaceSlug falls back to default');
  assert(cfg.apiKey === 'plane_api_68b11fbeb14c431cad3a1f87455b622a', 'resolved cfg apiKey falls back to default');

  const mapping = {
    'D:/Quest/CodingSpace.worktrees/CodingSpace-Plane': '72f1bdd9-8420-469f-93f7-fe27b6658b9c',
  };
  const exact = plane.resolveProjectId(mapping, 'D:\\Quest\\CodingSpace.worktrees\\CodingSpace-Plane');
  assert(exact === '72f1bdd9-8420-469f-93f7-fe27b6658b9c', 'resolveProjectId matches exact normalized path');

  const baseMatch = plane.resolveProjectId(mapping, 'C:\\other\\CodingSpace-Plane');
  assert(baseMatch === '72f1bdd9-8420-469f-93f7-fe27b6658b9c', 'resolveProjectId matches by basename');
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
