'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { readConfig } = require('./context');
const { focusApp, activateExplorerAt } = require('./focus');

const HOME = os.homedir();
const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

const SHIM_RE = /\.(cmd|bat)$/i;

function guiExeBehindShim(shim) {
  let text;
  try {
    text = fs.readFileSync(shim, 'utf8');
  } catch (_) {
    return null;
  }
  const dir = path.dirname(shim);
  for (const [, quoted] of text.matchAll(/"([^"]*\.exe)"/gi)) {
    if (/(^|[\\/])node\.exe$/i.test(quoted)) continue;
    const exe = path.normalize(quoted.replace(/%~?dp0%?\\?/gi, `${dir}${path.sep}`));
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function hasProductMetadata(exe) {
  if (process.platform === 'darwin') {
    const dir = path.dirname(exe);
    const contents = path.dirname(dir);
    if (fs.existsSync(path.join(contents, 'Info.plist'))) return true;
    if (fs.existsSync(path.join(contents, 'Resources', 'product-info.json'))) return true;
  }
  const root = path.dirname(path.dirname(exe));
  return fs.existsSync(path.join(root, 'product-info.json')) || fs.existsSync(path.join(root, 'build.txt'));
}

function jetbrainsInstalls(parents, dirRe, relExe) {
  const found = [];
  for (const parent of parents) {
    let entries = [];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!dirRe.test(entry.name)) continue;
      const root = path.join(parent, entry.name);
      const exe = path.join(root, relExe);
      if (!fs.existsSync(exe)) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(root).mtimeMs;
      } catch (_) {

      }
      found.push({ exe, mtime });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.exe);
}

const APPS = [
  {
    key: 'antigravity',
    iconKey: 'app-antigravity',
    label: 'Antigravity IDE',
    fallback: 'antigravity-ide',
    procName: 'Antigravity IDE',
    candidates: [
      path.join(HOME, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
      path.join(HOME, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
      path.join(PF, 'Antigravity IDE', 'Antigravity IDE.exe'),
      '/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE',
      '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide',
      path.join(HOME, '.antigravity-ide', 'antigravity-ide', 'bin', 'antigravity-ide'),
      path.join(HOME, '.antigravity', 'antigravity', 'bin', 'antigravity'),
    ],
    argsFor: (cwd) => [cwd],
  },
  {
    key: 'android-studio',
    iconKey: 'app-android-studio',
    label: 'Android Studio',
    fallback: 'studio64',
    procName: 'studio64',
    candidates: [
      path.join(PF, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      path.join(PF86, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      path.join(HOME, 'AppData', 'Local', 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      '/Applications/Android Studio.app/Contents/MacOS/studio',
      path.join(HOME, 'Applications', 'Android Studio.app', 'Contents', 'MacOS', 'studio'),
      '/Applications/Android Studio Preview.app/Contents/MacOS/studio',
      path.join(HOME, 'Applications', 'Android Studio Preview.app', 'Contents', 'MacOS', 'studio'),
    ],

    discover: () =>
      jetbrainsInstalls(
        [
          path.join(PF, 'Android'),
          path.join(PF86, 'Android'),
          path.join(HOME, 'AppData', 'Local', 'Android'),
        ],
        /^Android Studio/i,
        path.join('bin', 'studio64.exe')
      ),
    validate: hasProductMetadata,
    argsFor: (cwd) => [cwd],
  },
  {
    key: 'vscode',
    iconKey: 'app-vscode',
    label: 'VS Code',
    fallback: 'code',
    procName: 'Code',

    candidates: [
      path.join(HOME, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(PF, 'Microsoft VS Code', 'Code.exe'),
      path.join(PF86, 'Microsoft VS Code', 'Code.exe'),
      path.join(HOME, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(PF, 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(PF86, 'Microsoft VS Code', 'bin', 'code.cmd'),
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
      path.join(HOME, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
      '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
      '/Applications/Cursor.app/Contents/Resources/app/bin/code',
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      path.join(HOME, 'Applications', 'Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
    ],
    argsFor: (cwd) => [cwd],
  },
  {
    key: 'explorer',
    iconKey: 'app-explorer',
    label: 'File Explorer',

    explorer: true,
    argsFor: (cwd) => [cwd],
  },
];

function whichPreferShim(command) {
  if (process.platform !== 'win32') {
    const res = spawnSync('which', [command], { encoding: 'utf8' });
    const hit = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean)[0];
    return hit || null;
  }
  const res = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return null;
  const matches = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  return (
    matches.find((m) => /\.(cmd|bat)$/i.test(m)) ||
    matches.find((m) => /\.exe$/i.test(m)) ||
    matches[0] ||
    null
  );
}

function resolveApp(app) {
  if (app.explorer) {
    if (process.platform === 'win32') return 'explorer.exe';
    if (process.platform === 'darwin') return 'open';
    return 'xdg-open';
  }

  const ok = (exe) => exe && fs.existsSync(exe) && (!app.validate || app.validate(exe));
  const unwrap = (exe) =>
    exe && SHIM_RE.test(exe) && process.platform === 'win32' ? guiExeBehindShim(exe) || exe : exe;

  const override = (readConfig('apps.json') || {})[app.key];
  if (override && fs.existsSync(override)) return unwrap(override);

  if (app.discover) {
    for (const exe of app.discover()) {
      if (ok(exe)) return unwrap(exe);
    }
  }
  for (const candidate of app.candidates || []) {
    if (ok(candidate)) return unwrap(candidate);
  }

  const onPath = app.fallback ? whichPreferShim(app.fallback) : null;
  return ok(onPath) ? unwrap(onPath) : null;
}

function spawnDetached(exe, args, workdir) {
  if (process.platform === 'win32' && SHIM_RE.test(exe)) {
    const quote = (value) => `"${String(value).replace(/"/g, '')}"`;
    const command = `call ${[exe, ...args].map(quote).join(' ')}`;
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
      cwd: workdir,
    });
    child.unref();
    return;
  }

  const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: workdir });
  child.unref();
}

function openApp(app, cwd, { focus = true } = {}) {
  const exe = resolveApp(app);
  if (!exe) throw new Error(`${app.label} not found. Install it or add it to PATH.`);

  const args = (app.argsFor ? app.argsFor(cwd) : [cwd]).filter(Boolean);
  const workdir = cwd && fs.existsSync(cwd) ? cwd : undefined;

  if (focus && app.explorer && activateExplorerAt(cwd)) return exe;

  spawnDetached(exe, args, workdir);

  if (focus && !app.explorer) {
    focusApp({ exe, nameHint: app.procName, titleHint: cwd ? path.basename(cwd) : null });
  }
  return exe;
}

const byKey = (key) => APPS.find((a) => a.key === key) || null;

module.exports = { APPS, byKey, resolveApp, openApp, whichPreferShim };
