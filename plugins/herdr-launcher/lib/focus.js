'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'focus-window.ps1');

function powershellExe() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const builtin = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(builtin) ? builtin : 'powershell.exe';
}

const baseArgs = (args) => [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  SCRIPT,
  ...args,
];

function focusApp({ exe, nameHint, titleHint, timeoutMs = 8000 }) {
  if (process.platform !== 'win32') return false;

  const args = ['-TimeoutMs', String(timeoutMs)];
  if (exe && path.isAbsolute(exe)) args.push('-ExePath', exe);
  if (nameHint) args.push('-NameHint', nameHint);
  if (titleHint) args.push('-TitleHint', titleHint);

  try {
    const child = spawn(powershellExe(), baseArgs(args), {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    return true;
  } catch (_) {
    return false;
  }
}

function activateExplorerAt(dir) {
  if (process.platform !== 'win32' || !dir) return false;
  try {
    const res = spawnSync(powershellExe(), baseArgs(['-ExplorerPath', dir]), {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 6000,
    });
    return res.status === 0;
  } catch (_) {
    return false;
  }
}

module.exports = { focusApp, activateExplorerAt };
