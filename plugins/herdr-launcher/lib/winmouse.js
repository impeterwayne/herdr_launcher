'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'win-mouse-input.ps1');

function powershellExe() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const builtin = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(builtin) ? builtin : 'powershell.exe';
}

const baseArgs = () => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT];

// setRawMode(true) clears ENABLE_MOUSE_INPUT, and ConPTY only emits SGR mouse bytes while that
// flag is set -- so a raw-mode Node TUI on Windows never receives mouse without this. Console
// input mode is owned by the console, not the process, so a child can restore it for us.
// Fire-and-forget: mouse goes live once the child lands (~300ms), first paint is not blocked.
function restoreMouseInput() {
  if (process.platform !== 'win32') return false;
  if (!process.stdin.isTTY) return false;

  try {
    const child = spawn(powershellExe(), baseArgs(), {
      stdio: ['inherit', 'ignore', 'ignore'], // stdin must be inherited: it is the console handle
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { restoreMouseInput, SCRIPT };
