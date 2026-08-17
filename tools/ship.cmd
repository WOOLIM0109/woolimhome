@echo off
rem 실행 정책에 막히지 않도록 이 실행에만 우회를 씁니다.
rem 시스템 설정(Set-ExecutionPolicy)은 바꾸지 않습니다.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ship.ps1" %*
