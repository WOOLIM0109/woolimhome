@echo off
rem Keep this file ASCII-only: cmd.exe reads it in the OEM codepage.
rem Korean text belongs in worker-control.ps1, which is read as UTF-8.
chcp 65001 > nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker-control.ps1" -Action Off
echo.
pause
