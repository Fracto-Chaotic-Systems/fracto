@echo off
setlocal

pushd "%~dp0.." || exit /b 1
docker compose -f compose.yaml -f compose.dev.yaml up --build fracto-dev
set "launch_exit_code=%ERRORLEVEL%"
popd

exit /b %launch_exit_code%
