@echo off
setlocal
cd /d "%~dp0"
title 2D Fighter dev launcher

if not exist "venv\Scripts\python.exe" (
  echo [ERROR] venv not found. Create it first: python -m venv venv ^&^& venv\Scripts\pip install -r backend\requirements.txt
  pause & exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo [ERROR] node_modules not found. Run: npm install
  pause & exit /b 1
)

curl.exe -s -o nul -m 3 http://127.0.0.1:8188/system_stats
if errorlevel 1 (
  echo [WARN] ComfyUI is not responding on http://127.0.0.1:8188 - character generation will fail until it is started.
) else (
  echo [OK] ComfyUI is running on 8188.
)

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
echo [OK] Backend http://127.0.0.1:8000  Frontend http://localhost:5173
start "" http://localhost:5173/
echo Close the Backend and Frontend windows to stop the servers.
ping -n 6 127.0.0.1 >nul
