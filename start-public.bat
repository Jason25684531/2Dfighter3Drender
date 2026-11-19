@echo off
setlocal
cd /d "%~dp0"
title 2D Fighter public launcher

set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
set "LOGA=%TEMP%\cf-api.log"
set "LOGF=%TEMP%\cf-web.log"

if not exist "%CF%" (
  echo [ERROR] cloudflared.exe not found in Program Files x86
  pause & exit /b 1
)
if not exist "venv\Scripts\python.exe" (
  echo [ERROR] venv not found. Create it first: python -m venv venv ^&^& venv\Scripts\pip install -r backend\requirements.txt
  pause & exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo [ERROR] node_modules not found. Run: npm install
  pause & exit /b 1
)

rem Console QuickEdit freezes any cmd window the moment it is clicked.
reg add HKCU\Console /v QuickEdit /t REG_DWORD /d 0 /f >nul

echo Stopping previous backend / frontend / tunnels...
powershell -nop -c "Get-NetTCPConnection -State Listen -LocalPort 8000,5173 -ea 0 | %% { Stop-Process -Id $_.OwningProcess -Force -ea 0 }; Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | ? { $_.CommandLine -match ':(8000|5173)' } | %% { Stop-Process -Id $_.ProcessId -Force -ea 0 }"
del "%LOGA%" "%LOGF%" 2>nul

rem Tunnels first: each public URL is needed by the other side (API base for the frontend, CORS origin for the backend).
start "Tunnel API" cmd /c ""%CF%" tunnel --no-autoupdate --url http://127.0.0.1:8000 2> "%LOGA%""
start "Tunnel Web" cmd /c ""%CF%" tunnel --no-autoupdate --url http://localhost:5173 2> "%LOGF%""

set "API_URL="
set "WEB_URL="
echo Waiting for tunnel URLs...
for /l %%i in (1,1,30) do (
  if not defined API_URL for /f "delims=" %%u in ('powershell -nop -c "(Select-String -Path $env:LOGA -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ea 0 | select -First 1).Matches.Value"') do set "API_URL=%%u"
  if not defined WEB_URL for /f "delims=" %%u in ('powershell -nop -c "(Select-String -Path $env:LOGF -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ea 0 | select -First 1).Matches.Value"') do set "WEB_URL=%%u"
  if defined API_URL if defined WEB_URL goto tunnels
  ping -n 2 127.0.0.1 >nul
)
echo [ERROR] No tunnel URL after 30s. See %LOGA% and %LOGF%
pause & exit /b 1

:tunnels
set "EXP2_CORS_ORIGINS=%WEB_URL%,http://localhost:5173"
set "VITE_API_BASE_URL=%API_URL%/api/v1"

start "Backend :8000" cmd /k venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
start "Frontend :5173" cmd /k npm run dev -- --host localhost --port 5173 --strictPort

echo Waiting for servers...
for /l %%i in (1,1,30) do (
  curl.exe -s -o nul -m 1 http://127.0.0.1:8000/api/v1/health && curl.exe -s -o nul -m 1 http://localhost:5173/ && goto ready
  ping -n 2 127.0.0.1 >nul
)
echo [WARN] Servers did not answer within 30s. Check the Backend / Frontend windows.
pause & exit /b 1

:ready
echo.
echo [OK] Public URL (share this): %WEB_URL%
echo      API tunnel:              %API_URL%
echo      URLs change on every restart. Close the Backend / Frontend / Tunnel windows to stop.
echo %WEB_URL%| clip
echo      (public URL copied to clipboard)
pause
