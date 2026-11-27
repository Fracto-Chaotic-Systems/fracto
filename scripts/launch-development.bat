@echo off
setlocal

pushd "%~dp0.." || exit /b 1
node scripts\write_build_info.js
if errorlevel 1 exit /b %ERRORLEVEL%
call scripts\ensure_exclusive.bat dev
if errorlevel 1 exit /b %ERRORLEVEL%
node scripts\windows_host_startup.js --port 3101
rem Apply pending database migrations (root and service-owned) from the working
rem tree before starting, as cold_boot does. A failed migration stops the launch.
docker compose -f compose.yaml -f compose.dev.yaml build fracto-dev
if errorlevel 1 goto failed
echo Applying pending database migrations...
docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps fracto-dev node scripts/migrate_database.js
if errorlevel 1 (
  echo Database migrations failed; development stack not started. See the output above.
  goto failed
)
docker compose -f compose.yaml -f compose.dev.yaml up --renew-anon-volumes fracto-dev
set "launch_exit_code=%ERRORLEVEL%"
popd
exit /b %launch_exit_code%

:failed
set "launch_exit_code=%ERRORLEVEL%"
if "%launch_exit_code%"=="0" set "launch_exit_code=1"
popd
exit /b %launch_exit_code%
