@echo off

title Gym Judging Dev

cd /d "%~dp0"

echo Starting API (port 3000) and frontend (port 5173)...

echo After Vite shows "ready", open e.g. http://127.0.0.1:5173/login  or  http://127.0.0.1:5173/admin
echo Error -102 on any URL means the dev servers below are NOT running or the window was closed.
echo.

npm run dev

pause


