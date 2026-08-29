@echo off
setlocal

pushd "%~dp0.." || exit /b 1
docker compose run --rm --no-deps fracto node scripts/run_logged.js tile-backup node --max-old-space-size=16384 servers/fracto-tiles-server/backup.js
set "backup_exit_code=%ERRORLEVEL%"
popd

exit /b %backup_exit_code%
