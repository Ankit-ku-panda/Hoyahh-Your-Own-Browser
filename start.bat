@echo off
setlocal
cd /d "%~dp0"
docker info >nul 2>&1
if errorlevel 1 (
  echo Open Docker Desktop and wait until it is running, then try again.
  pause
  exit /b 1
)
if not exist .env (
  powershell -NoProfile -Command "$b = New-Object byte[] 32; $r = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $r.GetBytes($b); $r.Dispose(); [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), 'SEARXNG_SECRET=' + [BitConverter]::ToString($b).Replace('-', '').ToLower() + [Environment]::NewLine)"
  if errorlevel 1 (
    echo Could not generate the local secret.
    pause
    exit /b 1
  )
)
docker compose down
if errorlevel 1 exit /b 1
docker compose up --build -d
if errorlevel 1 (
  echo Start failed. See the error above and README.md.
  pause
  exit /b 1
)
echo Waiting for Hoyahh...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){& curl.exe --noproxy '*' --fail --silent --max-time 2 'http://127.0.0.1:8787/api/health' > $null; if($LASTEXITCODE -eq 0){$ok=$true;break}; Start-Sleep -Seconds 2}; if(-not $ok){exit 1}"
if errorlevel 1 (
  echo Browser connection failed. Current service status:
  docker compose ps -a
  echo Run diagnose.bat and share its output.
  pause
  exit /b 1
)
echo Checking that searches cannot use a direct internet connection...
docker compose exec -T app python /app/network_check.py
if errorlevel 1 goto isolation_failed
docker compose exec -T searxng python3 /opt/veil-network-check.py
if errorlevel 1 goto isolation_failed
if "%~1"=="--no-browser" exit /b 0
start "" "http://127.0.0.1:8787"
echo Hoyahh is running. Tor may need a few minutes. Click Check Tor connection before searching.
echo Click result titles to read pages inside Hoyahh. Use stop.bat when finished.
pause

exit /b 0
:isolation_failed
echo Isolation could not be confirmed. Current service status:
docker compose ps -a
echo Stopping Hoyahh. Run diagnose.bat for configuration errors.
docker compose down
pause
exit /b 1
