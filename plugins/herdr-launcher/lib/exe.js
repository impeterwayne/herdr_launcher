'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NATIVE_RE = /\.(exe|com)$/i;

function allOnPath(name) {
  const res = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return [];
  return (res.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function findFile(root, leaf, depth = 6) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const dirs = [];
  for (const entry of entries) {
    if (entry.isDirectory()) dirs.push(path.join(root, entry.name));
    else if (entry.name.toLowerCase() === leaf.toLowerCase()) return path.join(root, entry.name);
  }
  if (depth <= 0) return null;
  for (const dir of dirs) {
    const hit = findFile(dir, leaf, depth - 1);
    if (hit) return hit;
  }
  return null;
}

function targetOfCmdShim(cmdPath, name) {
  let text;
  try {
    text = fs.readFileSync(cmdPath, 'utf8');
  } catch (_) {
    return null;
  }
  const dir = path.dirname(cmdPath);
  const expand = (p) => path.normalize(p.replace(/%~?dp0%?\\?/gi, dir + path.sep));

  for (const [, quoted] of text.matchAll(/"([^"]*\.exe)"/gi)) {
    if (/(^|[\\/])node\.exe$/i.test(quoted)) continue;
    const exe = expand(quoted);
    if (fs.existsSync(exe)) return { exe, wrapperRoot: null };
  }

  for (const [, quoted] of text.matchAll(/"([^"]*\.js)"/gi)) {
    const js = expand(quoted);
    if (!fs.existsSync(js)) continue;
    const root = path.dirname(path.dirname(js));
    const exe = findFile(root, `${name}.exe`);
    if (exe) return { exe, wrapperRoot: root };
  }
  return null;
}

function ensureShim(dir, name, target) {
  const link = path.join(dir, `${name}.exe`);
  const want = fs.statSync(target);
  let have = null;
  try {
    have = fs.statSync(link);
  } catch (_) {

  }
  if (have && have.size === want.size && have.mtimeMs === want.mtimeMs) return link;

  fs.mkdirSync(dir, { recursive: true });
  if (have) fs.rmSync(link, { force: true });
  try {
    fs.linkSync(target, link);
  } catch (err) {
    throw new Error(`could not link ${target} -> ${link}: ${err.message}`);
  }
  return link;
}

function resolveLaunch(kind, shimDir) {
  const matches = allOnPath(kind);
  if (!matches.length) throw new Error(`${kind} is not on PATH — install it first`);
  if (NATIVE_RE.test(matches[0])) return { exe: matches[0], native: true, shim: null, env: {} };

  const cmd = matches.find((m) => /\.cmd$/i.test(m));
  if (!cmd) throw new Error(`${kind} resolves to ${matches[0]}, which Start-Process cannot run`);

  const found = targetOfCmdShim(cmd, kind);
  if (!found) throw new Error(`no native ${kind}.exe found behind ${cmd}`);

  const shim = ensureShim(shimDir, kind, found.exe);
  const env = { PATH: `${shimDir};${process.env.PATH || ''}` };

  if (kind === 'codex' && found.wrapperRoot) {
    env.CODEX_MANAGED_PACKAGE_ROOT = found.wrapperRoot;
    env.CODEX_MANAGED_BY_NPM = '1';
  }

  return { exe: found.exe, native: false, shim, env };
}

module.exports = { allOnPath, resolveLaunch };
