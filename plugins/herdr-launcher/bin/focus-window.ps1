# Bring an already-running app's window to the foreground.
#
# Called by lib/focus.js. Two modes:
#
#   -ExePath <exe> [-NameHint <name>] [-TitleHint <text>] [-TimeoutMs <ms>]
#       Poll for a top-level window owned by that image and force it forward.
#       Polls because a launch that hands its argv to a live instance takes a
#       moment to surface the window.
#
#   -ExplorerPath <dir>
#       Ask the shell whether a File Explorer window is already showing <dir>
#       and activate it. Exits 0 when one was found (the caller then skips the
#       launch), 1 when none was.
#
# PowerShell rather than Node because forcing the foreground needs Win32 calls
# and this plugin ships no native dependencies.

[CmdletBinding()]
param(
  [string]$ExePath,
  [string]$NameHint,
  [string]$TitleHint,
  [string]$ExplorerPath,
  [int]$TimeoutMs = 8000
)

$ErrorActionPreference = 'SilentlyContinue'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HerdrFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@

$SW_RESTORE = 9
$VK_MENU = 0x12
$KEYEVENTF_KEYUP = 2

function Push-Foreground {
  param([IntPtr]$Handle)

  $fg = [HerdrFocus]::GetForegroundWindow()
  $ours = [HerdrFocus]::GetCurrentThreadId()
  $theirs = [HerdrFocus]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)

  $attached = $false
  if ($theirs -ne 0 -and $theirs -ne $ours) {
    $attached = [HerdrFocus]::AttachThreadInput($ours, $theirs, $true)
  }
  [void][HerdrFocus]::SetForegroundWindow($Handle)
  if ($attached) { [void][HerdrFocus]::AttachThreadInput($ours, $theirs, $false) }

  return ([HerdrFocus]::GetForegroundWindow() -eq $Handle)
}

# SetForegroundWindow is refused outright for a process that does not already
# own the foreground: the taskbar button flashes and nothing comes forward. The
# sidebar's node process is normally started BY the foreground terminal, which
# does earn it those rights -- but not when a launch is triggered from anywhere
# else, so there are three escalating attempts here.
#
# Measured on Windows 11 with the foreground held by an unrelated app: attempt 1
# fails (last error 203), attempt 2 succeeds. The ALT tap works because releasing
# a modifier key clears the foreground lock timeout; it is a bare press/release
# of a key nothing is listening for.
function Set-Foreground {
  param([IntPtr]$Handle)

  if ($Handle -eq [IntPtr]::Zero) { return $false }
  if ([HerdrFocus]::GetForegroundWindow() -eq $Handle) { return $true }
  if ([HerdrFocus]::IsIconic($Handle)) { [void][HerdrFocus]::ShowWindow($Handle, $SW_RESTORE) }

  # 1. the polite way, which is all that is needed when we own the foreground
  if (Push-Foreground $Handle) { return $true }

  # 2. clear the foreground lock with an ALT tap, then ask again
  [HerdrFocus]::keybd_event($VK_MENU, 0, 0, [IntPtr]::Zero)
  [HerdrFocus]::keybd_event($VK_MENU, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero)
  if (Push-Foreground $Handle) { return $true }

  # 3. last resort: the shell's own alt-tab switcher
  [HerdrFocus]::SwitchToThisWindow($Handle, $true)
  Start-Sleep -Milliseconds 150
  return ([HerdrFocus]::GetForegroundWindow() -eq $Handle)
}

function Normalize-Dir {
  param([string]$Path)
  if (-not $Path) { return '' }
  try { $full = [IO.Path]::GetFullPath($Path) } catch { $full = $Path }
  return $full.TrimEnd('\')
}

# --- Explorer: the shell knows which folder each window is showing -----------
# Explorer opens a fresh window for every launch, so the reuse has to happen
# before we spawn anything.
if ($ExplorerPath) {
  $want = Normalize-Dir $ExplorerPath
  $shell = New-Object -ComObject Shell.Application
  foreach ($window in @($shell.Windows())) {
    $here = $null
    try { $here = $window.Document.Folder.Self.Path } catch { continue }  # an IE window, not a folder
    if (-not $here) { continue }
    if ((Normalize-Dir $here) -ieq $want) {
      [void](Set-Foreground ([IntPtr]$window.HWND))
      exit 0
    }
  }
  exit 1
}

if (-not $ExePath -and -not $NameHint) { exit 2 }

# --- Everything else: poll for the app's own window --------------------------
# A cold IDE start can take seconds to put a window up, hence the polling. The
# window we started from is remembered so that a user who deliberately clicks
# away mid-start does not get yanked back when the app finally appears.
$startedUnder = [HerdrFocus]::GetForegroundWindow()
$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
do {
  $foreground = [HerdrFocus]::GetForegroundWindow()
  $movedOn = ($foreground -ne $startedUnder -and $foreground -ne [IntPtr]::Zero)
  $userWindow = $false

  $windowed = @()
  foreach ($proc in @(Get-Process)) {
    if ($proc.MainWindowHandle -eq [IntPtr]::Zero) { continue }
    $path = $null
    try { $path = $proc.Path } catch { }  # protected processes refuse to say
    $isOurs = ($ExePath -and $path -and ($path -ieq $ExePath)) -or
              ($NameHint -and ($proc.ProcessName -ieq $NameHint))
    if ($isOurs) { $windowed += $proc; if ($proc.MainWindowHandle -eq $foreground) { $movedOn = $false } }
    elseif ($proc.MainWindowHandle -eq $foreground) { $userWindow = $true }
  }

  # Somebody else's window took over while we waited: the user clicked away, so
  # stop rather than yanking them back when the app finally opens.
  if ($movedOn -and $userWindow) { exit 0 }

  if ($windowed.Count -gt 0) {
    $pick = $null
    # A hint matching the window title picks the right window when the app has
    # several open (VS Code with two folders, say).
    if ($TitleHint) {
      $pick = $windowed | Where-Object { $_.MainWindowTitle -like "*$TitleHint*" } | Select-Object -First 1
    }
    if (-not $pick) { $pick = $windowed | Sort-Object StartTime -Descending | Select-Object -First 1 }
    if ($pick -and (Set-Foreground $pick.MainWindowHandle)) { exit 0 }
  }

  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)

exit 1
