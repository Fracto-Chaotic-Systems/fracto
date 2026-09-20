@echo off
setlocal

pushd "%~dp0.." || exit /b 1
node scripts\sync_bluesky_media.js --allow-failure
if errorlevel 1 exit /b %ERRORLEVEL%
node scripts\write_build_info.js
if errorlevel 1 exit /b %ERRORLEVEL%
call scripts\ensure_exclusive.bat dev
if errorlevel 1 exit /b %ERRORLEVEL%
docker compose -f compose.yaml -f compose.dev.yaml up --build --renew-anon-volumes fracto-dev
set "launch_exit_code=%ERRORLEVEL%"
popd

exit /b %launch_exit_code%
