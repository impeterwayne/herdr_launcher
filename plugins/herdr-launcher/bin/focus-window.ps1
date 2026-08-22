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

function Set-Foreground {
  param([IntPtr]$Handle)

  if ($Handle -eq [IntPtr]::Zero) { return $false }
  if ([HerdrFocus]::GetForegroundWindow() -eq $Handle) { return $true }
  if ([HerdrFocus]::IsIconic($Handle)) { [void][HerdrFocus]::ShowWindow($Handle, $SW_RESTORE) }

  if (Push-Foreground $Handle) { return $true }

  [HerdrFocus]::keybd_event($VK_MENU, 0, 0, [IntPtr]::Zero)
  [HerdrFocus]::keybd_event($VK_MENU, 0, $KEYEVENTF_KEYUP, [IntPtr]::Zero)
  if (Push-Foreground $Handle) { return $true }

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

if ($ExplorerPath) {
  $want = Normalize-Dir $ExplorerPath
  $shell = New-Object -ComObject Shell.Application
  foreach ($window in @($shell.Windows())) {
    $here = $null
    try { $here = $window.Document.Folder.Self.Path } catch { continue }
    if (-not $here) { continue }
    if ((Normalize-Dir $here) -ieq $want) {
      [void](Set-Foreground ([IntPtr]$window.HWND))
      exit 0
    }
  }
  exit 1
}

if (-not $ExePath -and -not $NameHint) { exit 2 }

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
    try { $path = $proc.Path } catch { }
    $isOurs = ($ExePath -and $path -and ($path -ieq $ExePath)) -or
              ($NameHint -and ($proc.ProcessName -ieq $NameHint))
    if ($isOurs) { $windowed += $proc; if ($proc.MainWindowHandle -eq $foreground) { $movedOn = $false } }
    elseif ($proc.MainWindowHandle -eq $foreground) { $userWindow = $true }
  }

  if ($movedOn -and $userWindow) { exit 0 }

  if ($windowed.Count -gt 0) {
    $pick = $null

    if ($TitleHint) {
      $pick = $windowed | Where-Object { $_.MainWindowTitle -like "*$TitleHint*" } | Select-Object -First 1
    }
    if (-not $pick) { $pick = $windowed | Sort-Object StartTime -Descending | Select-Object -First 1 }
    if ($pick -and (Set-Foreground $pick.MainWindowHandle)) { exit 0 }
  }

  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)

exit 1
