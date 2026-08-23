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
    fs.symlinkSync(targetPath, linkPath, LINK_TYPE);
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

const SHAREABLE = ['node_modules', 'build', 'dist', '.gradle', 'vendor', 'target', '.venv'];

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
      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) return;
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

function browseFolder(initialDir) {
  if (process.platform === 'win32') {
    const target =
      initialDir && fs.existsSync(initialDir)
        ? initialDir
        : fs.existsSync('D:\\')
          ? 'D:\\'
          : '';
    const initial = target ? target.replace(/'/g, "''") : '';
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      $target = '${initial}'
      $top = New-Object System.Windows.Forms.Form
      $top.TopMost = $true
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
                if (System.IO.Directory.Exists("D:\\\\")) {
                    SendMessage(hwnd, BFFM_SETEXPANDED, (IntPtr)1, "D:\\\\");
                }
                if (!string.IsNullOrEmpty(_initialPath) && System.IO.Directory.Exists(_initialPath)) {
                    SendMessage(hwnd, BFFM_SETEXPANDED, (IntPtr)1, _initialPath);
                    SendMessage(hwnd, BFFM_SETSELECTIONW, (IntPtr)1, _initialPath);
                } else if (System.IO.Directory.Exists("D:\\\\")) {
                    SendMessage(hwnd, BFFM_SETSELECTIONW, (IntPtr)1, "D:\\\\");
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
        if ($target) { $f.SelectedPath = $target }
        if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
          $selected = $f.SelectedPath
        }
        $f.Dispose()
      }
      if ($selected) {
        Write-Output $selected
      }
      $top.Dispose()
    `;
    try {
      const res = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', psScript], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000,
      });
      const selected = (res.stdout || '').trim().split(/\\r?\\n/).filter(Boolean).pop();
      return selected && fs.existsSync(selected) ? path.resolve(selected) : null;
    } catch (_) {
      return null;
    }
  }
  if (process.platform === 'darwin') {
    try {
      const res = spawnSync(
        'osascript',
        ['-e', 'POSIX path of (choose folder with prompt "Select folder to link")'],
        {
          encoding: 'utf8',
          timeout: 120000,
        }
      );
      const selected = (res.stdout || '').trim();
      return selected && fs.existsSync(selected) ? path.resolve(selected) : null;
    } catch (_) {
      return null;
    }
  }
  try {
    const res = spawnSync(
      'zenity',
      ['--file-selection', '--directory', '--title=Select folder to link'],
      {
        encoding: 'utf8',
        timeout: 120000,
      }
    );
    const selected = (res.stdout || '').trim();
    if (selected && fs.existsSync(selected)) return path.resolve(selected);
  } catch (_) {}
  return null;
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
