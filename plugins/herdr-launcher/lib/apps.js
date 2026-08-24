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

function findFromDesktopFiles(pattern) {
  if (process.platform === 'win32') return [];
  const appDirs = [
    path.join(HOME, '.local', 'share', 'applications'),
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    path.join(HOME, '.local', 'share', 'flatpak', 'exports', 'share', 'applications'),
    '/var/lib/snapd/desktop/applications',
  ];
  const found = [];
  for (const dir of appDirs) {
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.desktop') || !pattern.test(file)) continue;
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        const match = content.match(/^Exec=(.*)$/m);
        if (match) {
          let execLine = match[1].trim();
          execLine = execLine.replace(/%[a-zA-Z]/g, '').trim();
          let exe = execLine;
          if (exe.startsWith('"')) {
            const end = exe.indexOf('"', 1);
            if (end !== -1) exe = exe.slice(1, end);
          } else {
            exe = exe.split(' ')[0];
          }
          if (exe && fs.existsSync(exe)) {
            found.push(exe);
          }
        }
      } catch (_) {}
    }
  }
  return found;
}

function findAntigravityInstalls() {
  const dirs = [
    path.join(HOME, 'Tools'),
    path.join(HOME, 'Downloads'),
    path.join(HOME, '.local', 'share'),
    path.join(HOME, 'Applications'),
    path.join(HOME, 'opt'),
    '/opt',
    '/usr/local/share',
    '/usr/share',
    '/snap/bin',
  ];
  if (process.platform === 'win32') {
    dirs.push(
      path.join(HOME, 'AppData', 'Local', 'Programs'),
      PF,
      PF86
    );
  } else if (process.platform === 'darwin') {
    dirs.push('/Applications', path.join(HOME, 'Applications'));
  }
  const rels = process.platform === 'win32'
    ? [
        path.join('bin', 'antigravity-ide.cmd'),
        'Antigravity IDE.exe',
        'antigravity-ide.exe',
        path.join('bin', 'antigravity.cmd'),
      ]
    : process.platform === 'darwin'
    ? [
        'Contents/MacOS/Antigravity IDE',
        'Contents/Resources/app/bin/antigravity-ide',
      ]
    : [
        path.join('bin', 'antigravity-ide'),
        'antigravity-ide',
        path.join('bin', 'antigravity'),
        'antigravity',
      ];

  const found = [];
  for (const parent of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!/antigravity/i.test(entry.name)) continue;
      const root = path.join(parent, entry.name);
      for (const rel of rels) {
        const exe = path.join(root, rel);
        if (!fs.existsSync(exe)) continue;
        let mtime = 0;
        try {
          mtime = fs.statSync(root).mtimeMs;
        } catch (_) {}
        found.push({ exe, mtime });
      }
    }
  }

  const desktopHits = findFromDesktopFiles(/antigravity/i);
  for (const exe of desktopHits) {
    let mtime = 0;
    try {
      mtime = fs.statSync(exe).mtimeMs;
    } catch (_) {}
    found.push({ exe, mtime });
  }

  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.exe);
}

const APPS = [
  {
    key: 'antigravity',
    iconKey: 'app-antigravity',
    label: 'Antigravity IDE',
    fallback: ['antigravity-ide', 'antigravity', 'agy-ide'],
    procName: 'Antigravity IDE',
    candidates: [
      path.join(HOME, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
      path.join(HOME, 'AppData', 'Local', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
      path.join(PF, 'Antigravity IDE', 'Antigravity IDE.exe'),
      '/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE',
      '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide',
      path.join(HOME, 'Applications', 'Antigravity IDE.app', 'Contents', 'MacOS', 'Antigravity IDE'),
      path.join(HOME, 'Applications', 'Antigravity IDE.app', 'Contents', 'Resources', 'app', 'bin', 'antigravity-ide'),
      path.join(HOME, 'Tools', 'Antigravity IDE', 'bin', 'antigravity-ide'),
      path.join(HOME, 'Tools', 'Antigravity IDE', 'antigravity-ide'),
      path.join(HOME, 'Downloads', 'Antigravity IDE', 'bin', 'antigravity-ide'),
      path.join(HOME, 'Downloads', 'Antigravity IDE', 'antigravity-ide'),
      path.join(HOME, '.local', 'share', 'antigravity-ide', 'bin', 'antigravity-ide'),
      path.join(HOME, '.local', 'share', 'antigravity-ide', 'antigravity-ide'),
      path.join(HOME, '.local', 'share', 'Antigravity IDE', 'bin', 'antigravity-ide'),
      path.join(HOME, '.local', 'share', 'Antigravity IDE', 'antigravity-ide'),
      path.join(HOME, 'Applications', 'Antigravity IDE', 'bin', 'antigravity-ide'),
      path.join(HOME, 'Applications', 'Antigravity IDE', 'antigravity-ide'),
      path.join(HOME, 'Applications', 'antigravity-ide', 'bin', 'antigravity-ide'),
      path.join(HOME, 'Applications', 'antigravity-ide', 'antigravity-ide'),
      path.join(HOME, '.antigravity-ide', 'antigravity-ide', 'bin', 'antigravity-ide'),
      path.join(HOME, '.antigravity-ide', 'bin', 'antigravity-ide'),
      path.join(HOME, '.antigravity-ide', 'antigravity-ide'),
      path.join(HOME, '.antigravity', 'antigravity', 'bin', 'antigravity'),
      path.join(HOME, '.antigravity', 'bin', 'antigravity'),
      path.join(HOME, '.local', 'bin', 'antigravity-ide'),
      path.join(HOME, '.local', 'bin', 'antigravity'),
      '/opt/Antigravity IDE/bin/antigravity-ide',
      '/opt/Antigravity IDE/antigravity-ide',
      '/opt/antigravity-ide/bin/antigravity-ide',
      '/opt/antigravity-ide/antigravity-ide',
      '/usr/share/antigravity-ide/bin/antigravity-ide',
      '/usr/share/antigravity-ide/antigravity-ide',
      '/usr/local/bin/antigravity-ide',
      '/usr/bin/antigravity-ide',
    ],
    discover: findAntigravityInstalls,
    argsFor: (cwd) => [cwd],
  },
  {
    key: 'android-studio',
    iconKey: 'app-android-studio',
    label: 'Android Studio',
    fallback: ['studio64', 'studio', 'studio.sh'],
    procName: 'studio64',
    candidates: [
      path.join(PF, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      path.join(PF86, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      path.join(HOME, 'AppData', 'Local', 'Android', 'Android Studio', 'bin', 'studio64.exe'),
      '/Applications/Android Studio.app/Contents/MacOS/studio',
      path.join(HOME, 'Applications', 'Android Studio.app', 'Contents', 'MacOS', 'studio'),
      '/Applications/Android Studio Preview.app/Contents/MacOS/studio',
      path.join(HOME, 'Applications', 'Android Studio Preview.app', 'Contents', 'MacOS', 'studio'),
      path.join(HOME, 'Tools', 'android-studio', 'bin', 'studio.sh'),
      path.join(HOME, 'Tools', 'Android Studio', 'bin', 'studio.sh'),
      path.join(HOME, 'Downloads', 'android-studio', 'bin', 'studio.sh'),
      path.join(HOME, 'Downloads', 'Android Studio', 'bin', 'studio.sh'),
      path.join(HOME, 'android-studio', 'bin', 'studio.sh'),
      path.join(HOME, 'Android', 'android-studio', 'bin', 'studio.sh'),
      path.join(HOME, '.local', 'share', 'android-studio', 'bin', 'studio.sh'),
      '/opt/android-studio/bin/studio.sh',
      '/opt/android-studio-preview/bin/studio.sh',
      '/usr/local/android-studio/bin/studio.sh',
      '/usr/share/android-studio/bin/studio.sh',
      path.join(HOME, '.local', 'bin', 'studio'),
      path.join(HOME, '.local', 'bin', 'studio.sh'),
      '/usr/local/bin/studio',
      '/usr/bin/studio',
    ],

    discover: () =>
      jetbrainsInstalls(
        [
          path.join(PF, 'Android'),
          path.join(PF86, 'Android'),
          path.join(HOME, 'AppData', 'Local', 'Android'),
          path.join(HOME, 'Tools'),
          path.join(HOME, 'Downloads'),
          path.join(HOME, '.local', 'share'),
          path.join(HOME, 'Android'),
          path.join(HOME, 'Applications'),
          path.join(HOME, 'opt'),
          '/opt',
          '/usr/local/share',
          '/usr/share',
        ],
        /^(android-studio|Android Studio)/i,
        process.platform === 'win32' ? path.join('bin', 'studio64.exe') : path.join('bin', 'studio.sh')
      ),
    validate: hasProductMetadata,
    argsFor: (cwd) => [cwd],
  },
  {
    key: 'vscode',
    iconKey: 'app-vscode',
    label: 'VS Code',
    fallback: ['code', 'code-insiders', 'cursor'],
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
      '/usr/share/code/bin/code',
      '/usr/share/code/code',
      '/usr/bin/code',
      '/usr/local/bin/code',
      path.join(HOME, '.local', 'bin', 'code'),
      path.join(HOME, '.local', 'share', 'code', 'bin', 'code'),
      path.join(HOME, 'Tools', 'VSCode', 'bin', 'code'),
      path.join(HOME, 'Tools', 'VSCode', 'code'),
      path.join(HOME, 'Applications', 'VSCode', 'bin', 'code'),
      '/opt/visual-studio-code/bin/code',
      '/opt/vscode/bin/code',
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

  const fallbacks = Array.isArray(app.fallback)
    ? app.fallback
    : app.fallback
    ? [app.fallback]
    : [];
  for (const fb of fallbacks) {
    const onPath = whichPreferShim(fb);
    if (ok(onPath)) return unwrap(onPath);
  }
  return null;
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
