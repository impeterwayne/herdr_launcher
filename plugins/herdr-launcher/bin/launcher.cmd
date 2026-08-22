@echo off
setlocal
node "%~dp0launcher.js" %* 2>>"%TEMP%\herdr-launcher.err"
