@echo off
setlocal

echo WARNING: This will drop and recreate the Fracto database tables from backup/*.sql.
choice /C YN /N /M "Continue? [Y/N] "
if errorlevel 2 exit /b 0

pushd "%~dp0.." || exit /b 1
set "FRACTO_DB_INIT_CONFIRM=reset"
docker compose run --build --rm database-init
set "reset_exit_code=%ERRORLEVEL%"
popd

exit /b %reset_exit_code%
