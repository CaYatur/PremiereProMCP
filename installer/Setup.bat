@echo off
title Premiere Pro MCP Setup - CaYaDev
cd /d "%~dp0"
echo.
echo  Premiere Pro MCP Setup
echo  CaYaDev  -  https://cayadev.com
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup ended with an error.
  pause
)
