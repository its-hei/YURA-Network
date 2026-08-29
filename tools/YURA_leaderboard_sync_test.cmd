@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0YURA_leaderboard_sync.ps1"
echo.
pause
