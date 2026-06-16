@echo off
REM Builds from Dockerfile — never use fly deploy --image deployment-... (stale port / broken health checks).
cd /d "%~dp0\.."
fly deploy --config fly.toml %*
