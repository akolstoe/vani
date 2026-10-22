@echo off
cd /d "%~dp0"
title Vani voice server
if not exist ".venv\python.exe" (
  echo Run setup.bat first.
  pause & exit /b 1
)
echo Keep this window open while you listen. Close it to stop the server.
"%~dp0.venv\python.exe" vani_voice_server.py
pause
