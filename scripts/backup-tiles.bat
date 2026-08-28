@echo off
setlocal

pushd "%~dp0.." || exit /b 1
docker compose run --rm --no-deps fracto npm run tiles:backup
set "backup_exit_code=%ERRORLEVEL%"
popd

exit /b %backup_exit_code%
