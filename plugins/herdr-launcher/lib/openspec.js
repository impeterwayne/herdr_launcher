'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeRm, copyTree, addExcludes, removeExcludes, hasExcludes } = require('./gitx');
const { readConfig } = require('./context');

const COMPONENTS = [
  {
    id: 'openspec_core',
    name: 'OpenSpec Core Infrastructure',
    folders: ['openspec'],
    excludes: ['openspec/'],
    description: 'Core OpenSpec configuration and specs folder.',
  },
  {
    id: 'openspec_claude',
    name: 'Claude OpenSpec Skills',
    folders: [path.join('.claude', 'skills')],
    excludes: ['.claude/skills/openspec-*/'],
    description: 'Claude-specific skills and agent instructions.',
  },
  {
    id: 'openspec_codex',
    name: 'Codex OpenSpec Skills',
    folders: [path.join('.codex', 'skills')],
    excludes: ['.codex/skills/openspec-*/'],
    description: 'Codex-specific skills and custom Codex settings.',
  },
  {
    id: 'openspec_opencode',
    name: 'OpenCode OpenSpec Skills',
    folders: [path.join('.opencode', 'skills'), path.join('.opencode', 'commands')],
    excludes: ['.opencode/skills/openspec-*/', '.opencode/commands/openspec-*/'],
    description: 'OpenCode-specific skills and command definitions.',
  },
  {
    id: 'openspec_antigravity',
    name: 'Antigravity OpenSpec Workflows',
    folders: [path.join('.agents', 'skills'), path.join('.agents', 'workflows')],
    excludes: ['.agents/skills/openspec-*/', '.agents/workflows/opsx-*'],
    description: 'Shared OpenSpec skills and slash-command workflows.',
  },
];

const DEFAULT_ROOTS = [
  process.env.HERDR_LAUNCHER_OPENSPEC_ROOT,
  path.join(__dirname, '..', 'toolkits', 'OpenSpec'),
  path.join(__dirname, '..', 'toolkits', 'openspec'),
  'D:\\Quest\\CodingSpace\\toolkits\\OpenSpec',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Coding Space', 'resources', 'toolkits', 'OpenSpec'),
].filter(Boolean);

function toolkitRoot() {
  const configured = (readConfig('openspec.json') || {}).root;
  for (const root of [configured, ...DEFAULT_ROOTS].filter(Boolean)) {
    if (fs.existsSync(root)) return root;
  }
  return null;
}

function status(worktreePath, root = toolkitRoot()) {
  return COMPONENTS.map((component) => {
    const missing = [];
    let available = Boolean(root);
    for (const folder of component.folders) {
      const src = root ? path.join(root, folder) : null;
      const dest = path.join(worktreePath, folder);
      if (!src || !fs.existsSync(src)) {
        available = false;
        continue;
      }
      const items = fs.readdirSync(src);
      const absent = items.filter((item) => !fs.existsSync(path.join(dest, item)));
      if (absent.length) missing.push(...absent.map((item) => path.join(folder, item)));
    }
    return {
      ...component,
      available,
      deployed: available && missing.length === 0,
      missing,
      excluded: hasExcludes(worktreePath, component.excludes),
    };
  });
}

function deploy(worktreePath, component, root = toolkitRoot()) {
  if (!root) return { ok: false, error: 'OpenSpec toolkit source not found — set it in openspec.json.' };
  const copied = [];
  for (const folder of component.folders) {
    const src = path.join(root, folder);
    const dest = path.join(worktreePath, folder);
    if (!fs.existsSync(src)) return { ok: false, error: `Source missing: ${src}` };
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const item of fs.readdirSync(src)) {
        const itemDest = path.join(dest, item);
        if (fs.existsSync(itemDest)) safeRm(itemDest);
        copyTree(path.join(src, item), itemDest);
        copied.push(path.join(folder, item));
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  const excluded = addExcludes(worktreePath, component.excludes);
  return { ok: true, copied, excluded };
}

function remove(worktreePath, component, root = toolkitRoot()) {
  const removed = [];
  for (const folder of component.folders) {
    const src = root ? path.join(root, folder) : null;
    const dest = path.join(worktreePath, folder);
    if (!fs.existsSync(dest)) continue;
    try {

      const owned = src && fs.existsSync(src) ? fs.readdirSync(src) : fs.readdirSync(dest);
      for (const item of owned) {
        const itemDest = path.join(dest, item);
        if (fs.existsSync(itemDest)) {
          safeRm(itemDest);
          removed.push(path.join(folder, item));
        }
      }
      if (fs.readdirSync(dest).length === 0) safeRm(dest);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  removeExcludes(worktreePath, component.excludes);
  return { ok: true, removed };
}

module.exports = { COMPONENTS, toolkitRoot, status, deploy, remove };
