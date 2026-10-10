@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  exit /b 1
)
if not exist "node_modules\openai\package.json" (
  call npm ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
node runner.mjs %*
set "run_exit=%errorlevel%"
if "%~1"=="" pause
exit /b %run_exit%
