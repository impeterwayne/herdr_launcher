@echo off
rem DIAGNOSTIC ENTRY POINT ONLY -- opt in with `toggle-launcher.js --shim`.
rem
rem Do not make this the default launch path: putting cmd.exe between the ConPTY
rem and node is how the sidebar ends up rendering fine but ignoring every
rem keypress. toggle-launcher.js spawns `node launcher.js` directly instead.
rem
rem What this is still good for: capturing a startup crash. A pane whose process
rem dies takes its own error message with it, so stderr is teed to a file.
setlocal
node "%~dp0launcher.js" %* 2>>"%TEMP%\herdr-launcher.err"
