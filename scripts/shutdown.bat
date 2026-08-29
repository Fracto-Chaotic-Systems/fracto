@echo off
setlocal

pushd "%~dp0.." || exit /b 1
set "target=%~1"
if not defined target set "target=both"
if /I "%target%"=="prod" goto detect
if /I "%target%"=="dev" goto detect
if /I "%target%"=="both" goto detect
echo Usage: scripts\shutdown.bat [dev^|prod]
popd
exit /b 2

:detect
set "prod_running="
set "dev_running="
for /f "delims=" %%I in ('docker compose ps --status running -q fracto 2^>nul') do set "prod_running=1"
for /f "delims=" %%I in ('docker compose -f compose.yaml -f compose.dev.yaml ps --status running -q fracto-dev 2^>nul') do set "dev_running=1"
if /I "%target%"=="prod" set "dev_running="
if /I "%target%"=="dev" set "prod_running="
if not defined prod_running if not defined dev_running (
  echo No requested Fracto server is running.
  popd
  exit /b 0
)
set "running="
if defined prod_running set "running=production"
if defined dev_running if defined running set "running=%running% and development"
if defined dev_running if not defined running set "running=development"
choice /C YN /N /M "Stop the running %running% server(s) gracefully? [Y/N] "
if errorlevel 2 (
  echo Shutdown cancelled.
  popd
  exit /b 0
)
if defined prod_running docker compose stop fracto
if errorlevel 1 goto failed
if defined dev_running docker compose -f compose.yaml -f compose.dev.yaml stop fracto-dev
if errorlevel 1 goto failed
echo Requested Fracto server(s) stopped.
popd
exit /b 0

:failed
set "shutdown_exit_code=%ERRORLEVEL%"
if "%shutdown_exit_code%"=="0" set "shutdown_exit_code=1"
echo Shutdown failed. Inspect Docker output above.
popd
exit /b %shutdown_exit_code%
