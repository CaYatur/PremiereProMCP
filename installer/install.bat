@echo off
title PPMCP Installer — CaYaDev
cd /d "%~dp0"

echo.
echo  Premiere Pro MCP Installer
echo  Developer: CaYaDev  ·  https://cayadev.com
echo.
echo  This will: npm install/build, start the bridge at login,
echo  register the UXP plugin helper, and write MCP config snippets.
echo.

:: Prefer elevated for Startup folder reliability (optional)
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo  Tip: Right-click → Run as administrator for best results.
  echo.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo  Install finished with errors. Code: %ERR%
) else (
  echo  Install finished.
)
echo.
pause
exit /b %ERR%
