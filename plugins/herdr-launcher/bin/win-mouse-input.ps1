# Re-enables ENABLE_MOUSE_INPUT on the shared console input buffer.
#
# Why this exists: process.stdin.setRawMode(true) makes libuv replace the console input mode
# with ENABLE_WINDOW_INPUT | ENABLE_VIRTUAL_TERMINAL_INPUT, which clears ENABLE_MOUSE_INPUT.
# ConPTY only converts mouse events into VT (SGR) byte sequences while that flag is set, so a
# raw-mode Node process asks for VT input with mouse switched off and receives nothing.
#
# Console input mode belongs to the console buffer, not the process, so a child attached to the
# same console can restore the flag on the parent's behalf. Run this AFTER setRawMode(true),
# with stdin inherited -- the fix targets whatever GetStdHandle(STD_INPUT_HANDLE) resolves to.

$sig = @"
using System;
using System.Runtime.InteropServices;
public class HerdrConsoleMode {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int nStdHandle);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
}
"@

try { Add-Type -TypeDefinition $sig -ErrorAction Stop } catch { exit 1 }

$STD_INPUT_HANDLE = -10

$ENABLE_PROCESSED_INPUT        = 0x1
$ENABLE_LINE_INPUT             = 0x2
$ENABLE_ECHO_INPUT             = 0x4
$ENABLE_MOUSE_INPUT            = 0x10
$ENABLE_QUICK_EDIT_MODE        = 0x40
$ENABLE_EXTENDED_FLAGS         = 0x80
$ENABLE_VIRTUAL_TERMINAL_INPUT = 0x200

$handle = [HerdrConsoleMode]::GetStdHandle($STD_INPUT_HANDLE)
if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr]-1) { exit 1 }

$mode = 0
if (-not [HerdrConsoleMode]::GetConsoleMode($handle, [ref]$mode)) { exit 1 }

# Mouse reports + SGR delivery, while preserving raw-mode semantics. ENABLE_EXTENDED_FLAGS is
# required for the QuickEdit clear to take effect; QuickEdit would otherwise claim left-drag.
$next = $mode -bor $ENABLE_MOUSE_INPUT -bor $ENABLE_EXTENDED_FLAGS -bor $ENABLE_VIRTUAL_TERMINAL_INPUT
$next = $next -band (-bnot $ENABLE_QUICK_EDIT_MODE)
$next = $next -band (-bnot $ENABLE_LINE_INPUT)
$next = $next -band (-bnot $ENABLE_ECHO_INPUT)
$next = $next -band (-bnot $ENABLE_PROCESSED_INPUT)

if ($next -eq $mode) { exit 0 }
if (-not [HerdrConsoleMode]::SetConsoleMode($handle, $next)) { exit 1 }
exit 0
