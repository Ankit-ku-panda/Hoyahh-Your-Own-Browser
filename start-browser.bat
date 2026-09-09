@echo off
setlocal
cd /d "%~dp0"
set "COMPOSE_FILE=compose.yaml;compose.browser.yaml"
call start.bat --no-browser
if errorlevel 1 exit /b 1
echo Preparing Hoyahh...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-browser.ps1"
if errorlevel 1 (
  echo Browser setup failed. Read the error above.
  pause
  exit /b 1
)
echo Hoyahh is opening. Close the browser and run stop.bat when finished.
