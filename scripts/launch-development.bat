@echo off
setlocal

pushd "%~dp0.." || exit /b 1
node scripts\write_build_info.js
if errorlevel 1 exit /b %ERRORLEVEL%
call scripts\ensure_exclusive.bat dev
if errorlevel 1 exit /b %ERRORLEVEL%
docker compose -f compose.yaml -f compose.dev.yaml up --build fracto-dev
set "launch_exit_code=%ERRORLEVEL%"
popd

exit /b %launch_exit_code%
