'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { safeRm, removeExcludes } = require('./gitx');
const { allOnPath } = require('./exe');

const COMPONENTS = [
  {
    id: 'openspec_core',
    name: 'OpenSpec Core Infrastructure',
    toolId: 'none',
    folders: ['openspec'],
    expectedFiles: [path.join('openspec', 'config.yaml')],
    description: 'Core OpenSpec configuration and specs folder.',
  },
  {
    id: 'openspec_antigravity',
    name: 'Antigravity OpenSpec Workflows',
    toolId: 'antigravity',
    folders: [path.join('.agent', 'skills'), path.join('.agent', 'workflows')],
    expectedFiles: [
      path.join('.agent', 'skills', 'openspec-propose', 'SKILL.md'),
      path.join('.agent', 'workflows', 'opsx-propose.md'),
    ],
    cleanPatterns: [
      path.join('.agent', 'skills', 'openspec-*'),
      path.join('.agent', 'workflows', 'opsx-*'),
      path.join('.agents', 'skills', 'openspec-*'),
      path.join('.agents', 'workflows', 'opsx-*'),
    ],
    description: 'Shared OpenSpec skills and slash-command workflows.',
  },
  {
    id: 'openspec_claude',
    name: 'Claude OpenSpec Skills',
    toolId: 'claude',
    folders: [path.join('.claude', 'commands', 'opsx'), path.join('.claude', 'skills')],
    expectedFiles: [
      path.join('.claude', 'commands', 'opsx', 'propose.md'),
      path.join('.claude', 'skills', 'openspec-propose', 'SKILL.md'),
    ],
    cleanPatterns: [
      path.join('.claude', 'commands', 'opsx'),
      path.join('.claude', 'skills', 'openspec-*'),
    ],
    description: 'Claude-specific slash commands and skills.',
  },
  {
    id: 'openspec_codex',
    name: 'Codex OpenSpec Skills',
    toolId: 'codex',
    folders: [path.join('.codex', 'skills'), path.join('.agents', 'skills')],
    expectedFiles: [
      path.join('.codex', 'skills', 'openspec-propose', 'SKILL.md'),
    ],
    cleanPatterns: [
      path.join('.codex', 'skills', 'openspec-*'),
      path.join('.agents', 'skills', 'openspec-*'),
    ],
    description: 'Codex-specific agent skills ($openspec-*).',
  },
  {
    id: 'openspec_opencode',
    name: 'OpenCode OpenSpec Skills',
    toolId: 'opencode',
    folders: [path.join('.opencode', 'commands'), path.join('.opencode', 'skills')],
    expectedFiles: [
      path.join('.opencode', 'commands', 'opsx-propose.md'),
      path.join('.opencode', 'skills', 'openspec-propose', 'SKILL.md'),
    ],
    cleanPatterns: [
      path.join('.opencode', 'commands', 'opsx-*'),
      path.join('.opencode', 'skills', 'openspec-*'),
    ],
    description: 'OpenCode-specific slash commands and skills.',
  },
];

function cliPath() {
  const hits = allOnPath('openspec');
  if (!hits.length) return null;
  if (process.platform === 'win32') {
    return hits.find((h) => /\.cmd$/i.test(h)) || hits[0];
  }
  return hits[0];
}

function isAvailable() {
  return Boolean(cliPath());
}

// Kept for backward compatibility with callers/tests expecting toolkitRoot()
function toolkitRoot() {
  return cliPath();
}

function isComponentDeployed(worktreePath, component) {
  if (component.id === 'openspec_core') {
    const configPath = path.join(worktreePath, 'openspec', 'config.yaml');
    if (fs.existsSync(configPath)) return true;
    const dir = path.join(worktreePath, 'openspec');
    try {
      return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    } catch (_) {
      return false;
    }
  }

  if (component.expectedFiles && component.expectedFiles.length) {
    if (component.expectedFiles.some((rel) => fs.existsSync(path.join(worktreePath, rel)))) {
      return true;
    }
  }

  // Check folders for any openspec- or opsx- entries
  for (const folder of component.folders) {
    const target = path.join(worktreePath, folder);
    try {
      if (fs.existsSync(target)) {
        const entries = fs.readdirSync(target);
        if (entries.some((e) => e.startsWith('openspec') || e.startsWith('opsx'))) {
          return true;
        }
      }
    } catch (_) {}
  }
  return false;
}

function status(worktreePath) {
  const available = isAvailable();
  return COMPONENTS.map((component) => {
    const deployed = available && isComponentDeployed(worktreePath, component);
    return {
      ...component,
      available,
      deployed,
      missing: deployed ? [] : [component.name],
      excluded: false,
    };
  });
}

function deploy(worktreePath, component) {
  if (!isAvailable()) {
    return {
      ok: false,
      error: 'OpenSpec CLI not found — install with: npm install -g @fission-ai/openspec',
    };
  }

  const tool = component.toolId || 'none';
  const args = ['init', '--tools', tool, '--force', '--no-animation'];
  try {
    const res = spawnSync('openspec', args, {
      cwd: worktreePath,
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
      timeout: 30000,
    });
    if (res.status !== 0) {
      return { ok: false, error: (res.stderr || res.stdout || 'openspec init failed').trim() };
    }
    // Ensure openspec/ is not in .git/info/exclude
    removeExcludes(worktreePath, ['openspec/', 'openspec/*', '.claude/skills/openspec-*/']);
    return { ok: true, output: res.stdout };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function remove(worktreePath, component) {
  const removed = [];
  try {
    if (component.id === 'openspec_core') {
      const dir = path.join(worktreePath, 'openspec');
      if (fs.existsSync(dir)) {
        safeRm(dir);
        removed.push('openspec');
      }
    } else {
      const patterns = component.cleanPatterns || [];
      for (const relPattern of patterns) {
        const fullPattern = path.join(worktreePath, relPattern);
        const parentDir = path.dirname(fullPattern);
        const basePattern = path.basename(fullPattern);
        if (!fs.existsSync(parentDir)) continue;

        if (basePattern.includes('*')) {
          const prefix = basePattern.replace('*', '');
          for (const item of fs.readdirSync(parentDir)) {
            if (item.startsWith(prefix)) {
              const itemPath = path.join(parentDir, item);
              safeRm(itemPath);
              removed.push(path.join(path.dirname(relPattern), item));
            }
          }
        } else {
          if (fs.existsSync(fullPattern)) {
            safeRm(fullPattern);
            removed.push(relPattern);
          }
        }

        // Clean up empty directories recursively up to worktree
        try {
          let cur = parentDir;
          while (cur && cur !== worktreePath && cur !== path.dirname(cur)) {
            if (fs.existsSync(cur) && fs.readdirSync(cur).length === 0) {
              safeRm(cur);
              cur = path.dirname(cur);
            } else {
              break;
            }
          }
        } catch (_) {}
      }
    }
    removeExcludes(worktreePath, ['openspec/', 'openspec/*']);
    return { ok: true, removed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function update(worktreePath) {
  if (!isAvailable()) {
    return {
      ok: false,
      error: 'OpenSpec CLI not found — install with: npm install -g @fission-ai/openspec',
    };
  }
  try {
    const res = spawnSync('openspec', ['update', '--force', '--no-animation'], {
      cwd: worktreePath,
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
      timeout: 30000,
    });
    if (res.status !== 0) {
      return { ok: false, error: (res.stderr || res.stdout || 'openspec update failed').trim() };
    }
    return { ok: true, output: res.stdout };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  COMPONENTS,
  cliPath,
  isAvailable,
  toolkitRoot,
  status,
  deploy,
  remove,
  update,
};
