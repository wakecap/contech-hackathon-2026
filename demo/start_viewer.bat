@echo off
setlocal
cd /d "%~dp0"
node model_results.mjs
if errorlevel 1 exit /b 1
node server.mjs
pause
