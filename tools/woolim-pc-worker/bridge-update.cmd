@echo off
rem Keep this file ASCII-only; Korean messages belong in the UTF-8 BOM ps1.
chcp 65001 > nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge-update.ps1"
echo.
pause
