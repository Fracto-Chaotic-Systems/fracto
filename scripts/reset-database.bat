@echo off
setlocal

echo This command now applies pending versioned database migrations.
echo Existing tables will not be dropped or replaced.

pushd "%~dp0.." || exit /b 1
docker compose run --build --rm database-init
set "reset_exit_code=%ERRORLEVEL%"
popd

exit /b %reset_exit_code%
