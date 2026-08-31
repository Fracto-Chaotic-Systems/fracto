@echo off
setlocal

echo This command now applies pending versioned database migrations.
echo Existing tables will not be dropped or replaced.

pushd "%~dp0.." || exit /b 1
echo Building the image with the latest database migration logic...
docker compose build fracto
if errorlevel 1 goto build_failed
docker compose run --rm database-init
set "reset_exit_code=%ERRORLEVEL%"
popd

exit /b %reset_exit_code%

:build_failed
set "reset_exit_code=%ERRORLEVEL%"
popd
exit /b %reset_exit_code%
