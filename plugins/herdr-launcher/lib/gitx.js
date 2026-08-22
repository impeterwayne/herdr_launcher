'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HEADER = '# Agent toolkit (auto-added by herdr-launcher)';

const KNOWN_HEADERS = [
  HEADER,
  '# Agent toolkit (auto-added by coding-space)',
  '# SkillHub toolkit (auto-added by coding-space)',
];

function excludePath(worktreePath) {
  try {
    const rel = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    }).trim();
    return path.resolve(worktreePath, rel);
  } catch (_) {
    return path.join(worktreePath, '.git', 'info', 'exclude');
  }
}

function readExclude(worktreePath) {
  const file = excludePath(worktreePath);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim());
}

function addExcludes(worktreePath, patterns) {
  const file = excludePath(worktreePath);
  const lines = readExclude(worktreePath);
  let changed = false;

  if (!KNOWN_HEADERS.some((h) => lines.includes(h))) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
    lines.push(HEADER);
    changed = true;
  }
  for (const pattern of patterns) {
    if (!lines.includes(pattern)) {
      lines.push(pattern);
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  }
  return changed;
}

function removeExcludes(worktreePath, patterns) {
  const file = excludePath(worktreePath);
  if (!fs.existsSync(file)) return false;
  const lines = readExclude(worktreePath);
  const kept = lines.filter((l) => !patterns.includes(l));
  if (kept.length === lines.length) return false;
  fs.writeFileSync(file, `${kept.join('\n')}\n`, 'utf8');
  return true;
}

const hasExcludes = (worktreePath, patterns) => {
  const lines = readExclude(worktreePath);
  return patterns.every((p) => lines.includes(p));
};

function safeRm(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function copyTree(src, dest) {
  const stats = fs.statSync(src);
  if (!stats.isDirectory()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    copyTree(path.join(src, entry), path.join(dest, entry));
  }
}

module.exports = { HEADER, excludePath, readExclude, addExcludes, removeExcludes, hasExcludes, safeRm, copyTree };
