@echo off
setlocal

pushd "%~dp0.." || exit /b 1
docker compose run --build --rm database-init
set "database_exit_code=%ERRORLEVEL%"
popd

exit /b %database_exit_code%
