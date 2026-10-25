'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { readConfig, writeConfig } = require('./context');

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

function readLink(linkPath) {
  try {
    const stats = fs.lstatSync(linkPath);
    if (stats.isSymbolicLink()) return { isLink: true, target: fs.readlinkSync(linkPath) };
    if (stats.isDirectory()) {
      try {
        return { isLink: true, target: fs.readlinkSync(linkPath) };
      } catch (_) {
        return { isLink: false, isRealDirectory: true, target: null };
      }
    }
    return { isLink: false, isRealDirectory: false, target: null };
  } catch (_) {
    return { isLink: false, missing: true, target: null };
  }
}

function scan(worktreePath) {
  let entries;
  try {
    entries = fs.readdirSync(worktreePath);
  } catch (_) {
    return [];
  }
  const found = [];
  for (const name of entries) {
    const linkPath = path.join(worktreePath, name);
    const info = readLink(linkPath);
    if (info.isLink && info.target) {
      const targetPath = path.resolve(worktreePath, info.target);
      found.push({ name, targetPath, broken: !fs.existsSync(targetPath) });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function status(worktreePath, name, targetPath) {
  const info = readLink(path.join(worktreePath, name));
  if (info.missing) return { exists: false, pointsToTarget: false };
  if (info.isLink && info.target) {
    const current = path.resolve(worktreePath, info.target).toLowerCase();
    const wanted = path.resolve(targetPath).toLowerCase();
    return { exists: true, pointsToTarget: current === wanted, currentTarget: current };
  }
  return { exists: true, isRealDirectory: Boolean(info.isRealDirectory), pointsToTarget: false };
}

function create(worktreePath, name, targetPath) {
  const linkPath = path.join(worktreePath, name);
  if (!fs.existsSync(targetPath)) {
    return { ok: false, error: `Target does not exist: ${targetPath}` };
  }
  const info = readLink(linkPath);
  if (!info.missing) {
    if (!info.isLink) {
      return {
        ok: false,
        error: `A real file or folder already exists at "${name}". Delete or rename it first.`,
      };
    }
    try {
      fs.unlinkSync(linkPath);
    } catch (err) {
      return { ok: false, error: `Could not replace existing link: ${err.message}` };
    }
  }
  try {
    let linkType = LINK_TYPE;
    if (process.platform === 'win32') {
      try {
        if (fs.statSync(targetPath).isFile()) linkType = 'file';
      } catch (_) {}
    }
    fs.symlinkSync(targetPath, linkPath, linkType);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function remove(worktreePath, name) {
  const linkPath = path.join(worktreePath, name);
  const info = readLink(linkPath);
  if (info.missing) return { ok: true, alreadyGone: true };
  if (!info.isLink) {
    return { ok: false, error: `Refusing to delete: "${name}" is a real file or folder, not a link.` };
  }
  try {
    fs.unlinkSync(linkPath);
    return { ok: true };
  } catch (err) {
    try {
      fs.rmdirSync(linkPath);
      return { ok: true };
    } catch (_) {
      try {
        fs.rmSync(linkPath, { recursive: false, force: true });
        return { ok: true };
      } catch (_) {
        return { ok: false, error: err.message };
      }
    }
  }
}

const SHAREABLE = ['node_modules', 'build', 'dist', '.gradle', 'vendor', 'target', '.venv', 'plane'];

function siblingWorktrees(worktreePath) {
  let porcelain;
  try {
    porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    });
  } catch (_) {
    return [];
  }
  const self = path.resolve(worktreePath).toLowerCase();
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length).trim()))
    .filter((dir) => dir.toLowerCase() !== self);
}

function suggestTargets(worktreePath, managed = []) {
  const suggestions = [];
  const seen = new Set();

  const push = (name, targetPath, from) => {
    const key = `${name}|${targetPath}`.toLowerCase();
    if (seen.has(key)) return;
    try {
      if (!fs.existsSync(targetPath)) return;
      const st = fs.statSync(targetPath);
      if (!st.isDirectory() && !st.isFile()) return;
      if (readLink(targetPath).isLink) return;
    } catch (_) {
      return;
    }
    seen.add(key);
    suggestions.push({ name, targetPath, from });
  };

  for (const target of managed) {
    if (target && target.targetPath) {
      push(target.name || path.basename(target.targetPath), path.resolve(target.targetPath), 'configured');
    }
  }
  for (const sibling of siblingWorktrees(worktreePath)) {
    for (const name of SHAREABLE) {
      push(name, path.join(sibling, name), path.basename(sibling));
    }
  }
  return suggestions;
}

const PORTAL_FOLDER_PICKER_PY = `
import os
import sys

EXIT_NOTHING_PICKED = 1
EXIT_CHOOSER_FAILED = 2

try:
    import gi
    gi.require_version("Gio", "2.0")
    from gi.repository import Gio, GLib
except Exception:
    sys.exit(EXIT_CHOOSER_FAILED)

def main():
    title = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else "Select folder to link"
    initial_dir = sys.argv[2] if len(sys.argv) > 2 else ""

    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    loop = GLib.MainLoop()
    uris = []
    response_code = None

    def on_response(connection, sender, path, interface, signal, params):
        nonlocal response_code
        code, results = params.unpack()
        response_code = code
        if code == 0:
            uris.extend(results.get("uris", []))
        loop.quit()

    def subscribe(path):
        bus.signal_subscribe(
            "org.freedesktop.portal.Desktop",
            "org.freedesktop.portal.Request",
            "Response",
            path,
            None,
            Gio.DBusSignalFlags.NONE,
            on_response,
        )

    token = "herdr%d" % os.getpid()
    unique = bus.get_unique_name()
    if not unique:
        return EXIT_CHOOSER_FAILED
    sender = unique[1:].replace(".", "_")
    predicted = "/org/freedesktop/portal/desktop/request/%s/%s" % (sender, token)
    subscribe(predicted)

    options = {
        "handle_token": GLib.Variant("s", token),
        "multiple": GLib.Variant("b", False),
        "directory": GLib.Variant("b", True),
        "modal": GLib.Variant("b", True),
    }
    if initial_dir and os.path.isdir(initial_dir):
        options["current_folder"] = GLib.Variant.new_bytestring(os.fsencode(initial_dir))

    try:
        res = bus.call_sync(
            "org.freedesktop.portal.Desktop",
            "/org/freedesktop/portal/desktop",
            "org.freedesktop.portal.FileChooser",
            "OpenFile",
            GLib.Variant("(ssa{sv})", ("", title, options)),
            None,
            Gio.DBusCallFlags.NONE,
            -1,
            None,
        )
    except GLib.Error:
        if "current_folder" in options:
            options.pop("current_folder", None)
            res = bus.call_sync(
                "org.freedesktop.portal.Desktop",
                "/org/freedesktop/portal/desktop",
                "org.freedesktop.portal.FileChooser",
                "OpenFile",
                GLib.Variant("(ssa{sv})", ("", title, options)),
                None,
                Gio.DBusCallFlags.NONE,
                -1,
                None,
            )
        else:
            raise

    handle = res.unpack()[0]
    if handle != predicted:
        subscribe(handle)

    GLib.timeout_add_seconds(120, loop.quit)
    loop.run()

    if response_code is None or response_code == 2:
        return EXIT_CHOOSER_FAILED

    for uri in uris:
        selected, _ = GLib.filename_from_uri(uri)
        if selected:
            print(selected)

    return 0 if uris else EXIT_NOTHING_PICKED

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(EXIT_CHOOSER_FAILED)
`;

function linuxGuiEnv(baseEnv = process.env, existsFn = fs.existsSync) {
  const env = { ...baseEnv };
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!env.XDG_RUNTIME_DIR && uid !== null) {
    const runDir = `/run/user/${uid}`;
    if (existsFn(runDir)) env.XDG_RUNTIME_DIR = runDir;
  }
  if (!env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR) {
    const busPath = path.join(env.XDG_RUNTIME_DIR, 'bus');
    if (existsFn(busPath)) {
      env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busPath}`;
    }
  }
  if (!env.WAYLAND_DISPLAY && env.XDG_RUNTIME_DIR) {
    try {
      const sock = fs.readdirSync(env.XDG_RUNTIME_DIR).find((f) => /^wayland-\d+$/.test(f));
      if (sock) env.WAYLAND_DISPLAY = sock;
    } catch (_) {}
  }
  return env;
}

function browseFolder(initialDir, options = {}) {
  const withReason = Boolean(options && options.withReason);
  const platform = (options && options.platform) || process.platform;
  const runSpawn = (options && options.spawnSync) || spawnSync;
  const existsFn = (options && options.existsSync) || fs.existsSync;

  const finish = (selected, { cancelled = false, unavailable = false } = {}) =>
    withReason ? { selected, cancelled, unavailable } : selected;

  const cleanDir =
    initialDir && typeof initialDir === 'string'
      ? initialDir.startsWith('\\\\?\\')
        ? initialDir.slice(4)
        : initialDir
      : initialDir;

  if (platform === 'win32') {
    const target =
      cleanDir && existsFn(cleanDir)
        ? cleanDir
        : existsFn('D:\\')
          ? 'D:\\'
          : '';
    const initial = target ? target.replace(/'/g, "''") : '';
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      $target = '${initial}'
      $top = New-Object System.Windows.Forms.Form
      $top.TopMost = $true
      $top.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
      $top.Size = New-Object System.Drawing.Size(1, 1)
      $top.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
      $top.Opacity = 0.01
      $top.Show()
      $top.BringToFront()
      $top.Activate()
      $selected = $null
      try {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class FolderBrowserExpanded {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHBrowseForFolderW(ref BROWSEINFO lpbi);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool SHGetPathFromIDListW(IntPtr pidl, StringBuilder pszPath);

    [DllImport("user32.dll", EntryPoint = "SendMessageW", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, [MarshalAs(UnmanagedType.LPWStr)] string lParam);

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(IntPtr pv);

    private delegate int BrowseCallbackProc(IntPtr hwnd, uint uMsg, IntPtr lParam, IntPtr lpData);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct BROWSEINFO {
        public IntPtr hwndOwner;
        public IntPtr pidlRoot;
        public string pszDisplayName;
        public string lpszTitle;
        public uint ulFlags;
        public BrowseCallbackProc lpfn;
        public IntPtr lParam;
        public int iImage;
    }

    private const uint BIF_RETURNONLYFSDIRS = 0x0001;
    private const uint BIF_NEWDIALOGSTYLE = 0x0040;
    private const uint BIF_USENEWUI = 0x0040 | 0x0010;

    private const uint BFFM_INITIALIZED = 1;
    private const uint BFFM_SETSELECTIONW = 0x0400 + 103;
    private const uint BFFM_SETEXPANDED = 0x0400 + 106;

    private static string _initialPath;

    private static int Callback(IntPtr hwnd, uint uMsg, IntPtr lParam, IntPtr lpData) {
        if (uMsg == BFFM_INITIALIZED) {
            try {
                string root = null;
                if (!string.IsNullOrEmpty(_initialPath) && System.IO.Directory.Exists(_initialPath)) {
                    root = System.IO.Path.GetPathRoot(_initialPath);
                } else if (System.IO.Directory.Exists("D:\\\\")) {
                    root = "D:\\\\";
                }
                if (!string.IsNullOrEmpty(root) && System.IO.Directory.Exists(root)) {
                    SendMessage(hwnd, BFFM_SETEXPANDED, (IntPtr)1, root);
                }
                if (!string.IsNullOrEmpty(_initialPath) && System.IO.Directory.Exists(_initialPath)) {
                    SendMessage(hwnd, BFFM_SETEXPANDED, (IntPtr)1, _initialPath);
                    SendMessage(hwnd, BFFM_SETSELECTIONW, (IntPtr)1, _initialPath);
                } else if (!string.IsNullOrEmpty(root) && System.IO.Directory.Exists(root)) {
                    SendMessage(hwnd, BFFM_SETSELECTIONW, (IntPtr)1, root);
                }
            } catch {}
        }
        return 0;
    }

    public static string ShowDialog(IntPtr owner, string title, string initialPath) {
        _initialPath = initialPath;
        BROWSEINFO bi = new BROWSEINFO();
        bi.hwndOwner = owner;
        bi.pszDisplayName = new string('\\0', 260);
        bi.lpszTitle = title ?? "Select folder to link as symlink";
        bi.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_USENEWUI;
        bi.lpfn = new BrowseCallbackProc(Callback);

        IntPtr pidl = SHBrowseForFolderW(ref bi);
        if (pidl != IntPtr.Zero) {
            StringBuilder sb = new StringBuilder(260);
            if (SHGetPathFromIDListW(pidl, sb)) {
                CoTaskMemFree(pidl);
                return sb.ToString();
            }
            CoTaskMemFree(pidl);
        }
        return null;
    }
}
'@
        $selected = [FolderBrowserExpanded]::ShowDialog($top.Handle, 'Select folder to link as symlink', $target)
      } catch {
        $f = New-Object System.Windows.Forms.FolderBrowserDialog
        $f.Description = 'Select folder to link as symlink'
        $f.ShowNewFolderButton = $true
        if ($target -and (Test-Path $target)) { $f.SelectedPath = $target }
        if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
          $selected = $f.SelectedPath
        }
        $f.Dispose()
      }
      if ($selected) {
        Write-Output $selected
      }
      $top.Close()
      $top.Dispose()
    `;
    try {
      const res = runSpawn('powershell.exe', ['-NoProfile', '-STA', '-Command', psScript], {
        encoding: 'utf8',
        windowsHide: false,
        timeout: 120000,
      });
      if (res && res.error) return finish(null, { unavailable: true });
      const selected = ((res && res.stdout) || '').trim().split(/\r?\n/).filter(Boolean).pop();
      if (selected && existsFn(selected)) return finish(path.resolve(selected));
      return finish(null, { cancelled: true });
    } catch (_) {
      return finish(null, { unavailable: true });
    }
  }
  if (platform === 'darwin') {
    try {
      const res = runSpawn(
        'osascript',
        ['-e', 'POSIX path of (choose folder with prompt "Select folder to link")'],
        {
          encoding: 'utf8',
          timeout: 120000,
        }
      );
      if (res && res.error) return finish(null, { unavailable: true });
      const selected = ((res && res.stdout) || '').trim();
      if (selected && existsFn(selected)) return finish(path.resolve(selected));
      return finish(null, { cancelled: true });
    } catch (_) {
      return finish(null, { unavailable: true });
    }
  }

  const title = 'Select folder to link';
  const targetDir = cleanDir && existsFn(cleanDir) ? path.resolve(cleanDir) : '';
  const env = linuxGuiEnv(process.env, existsFn);

  // 1. XDG Desktop Portal (org.freedesktop.portal.FileChooser) via Python + GI (Omarchy / Hyprland / GNOME / KDE)
  const pythonBins = ['/usr/bin/python3', 'python3'];
  for (const pyBin of pythonBins) {
    if (pyBin.startsWith('/') && !existsFn(pyBin)) continue;
    try {
      const res = runSpawn(pyBin, ['-c', PORTAL_FOLDER_PICKER_PY, title, targetDir], {
        encoding: 'utf8',
        timeout: 120000,
        env,
      });
      if (!res || res.error) continue;
      if (res.status === 0) {
        const selected = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
        if (selected && existsFn(selected)) return finish(path.resolve(selected));
        return finish(null, { cancelled: true });
      }
      if (res.status === 1) {
        return finish(null, { cancelled: true });
      }
    } catch (_) {}
  }

  // 2. Native Omarchy file chooser CLI (omarchy-file-select)
  const omarchyBins = [
    '/usr/bin/omarchy-file-select',
    '/usr/share/omarchy/bin/omarchy-file-select',
    'omarchy-file-select',
  ];
  for (const omBin of omarchyBins) {
    if (omBin.startsWith('/') && !existsFn(omBin)) continue;
    try {
      const res = runSpawn(omBin, ['--title', title, '--directory'], {
        encoding: 'utf8',
        timeout: 120000,
        env,
      });
      if (!res || res.error) continue;
      if (res.status === 0) {
        const selected = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
        if (selected && existsFn(selected)) return finish(path.resolve(selected));
        return finish(null, { cancelled: true });
      }
      if (res.status === 1) {
        return finish(null, { cancelled: true });
      }
    } catch (_) {}
  }

  // 3. GTK / Qt dialog helpers (zenity, yad, qarma, matedialog)
  for (const bin of ['zenity', 'yad', 'qarma', 'matedialog']) {
    try {
      const args = ['--file-selection', '--directory', `--title=${title}`];
      if (targetDir) args.push(`--filename=${targetDir.replace(/\/?$/, '/')}`);
      const res = runSpawn(bin, args, {
        encoding: 'utf8',
        timeout: 120000,
        env,
      });
      if (!res || res.error) continue;
      if (res.status === 0) {
        const selected = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
        if (selected && existsFn(selected)) return finish(path.resolve(selected));
        return finish(null, { cancelled: true });
      }
      if (res.status === 1 || res.status === 5) {
        return finish(null, { cancelled: true });
      }
    } catch (_) {}
  }

  // 4. KDE kdialog
  try {
    const res = runSpawn('kdialog', ['--getexistingdirectory', targetDir || '.', '--title', title], {
      encoding: 'utf8',
      timeout: 120000,
      env,
    });
    if (res && !res.error) {
      if (res.status === 0) {
        const selected = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
        if (selected && existsFn(selected)) return finish(path.resolve(selected));
        return finish(null, { cancelled: true });
      }
      if (res.status === 1) {
        return finish(null, { cancelled: true });
      }
    }
  } catch (_) {}

  return finish(null, { unavailable: true });
}

function addPersistentTarget(name, targetPath) {
  const current = readConfig('symlinks.json') || {};
  const targets = Array.isArray(current.targets) ? [...current.targets] : [];
  const normalized = path.resolve(targetPath).toLowerCase();
  const exists = targets.some(
    (t) => t && t.targetPath && path.resolve(t.targetPath).toLowerCase() === normalized
  );
  if (!exists) {
    targets.push({ name, targetPath: path.resolve(targetPath) });
    writeConfig('symlinks.json', { ...current, targets });
  }
}

module.exports = {
  LINK_TYPE,
  SHAREABLE,
  readLink,
  scan,
  status,
  create,
  remove,
  siblingWorktrees,
  suggestTargets,
  browseFolder,
  addPersistentTarget,
};
