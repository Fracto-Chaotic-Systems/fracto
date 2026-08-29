@echo off
setlocal

pushd "%~dp0.." || exit /b 1
set "FRACTO_DB_INIT_CONFIRM="

if not exist "config\mysql.json" (
  echo Missing config\mysql.json. Add the local configuration files before continuing.
  goto failed
)
if not exist "servers\fracto-admin-server\package.json" goto missing_services
if not exist "servers\fracto-asset-server\package.json" goto missing_services
if not exist "servers\fracto-data-server\package.json" goto missing_services
if not exist "servers\fracto-tiles-server\package.json" goto missing_services
if not exist "servers\fracto-ui\package.json" goto missing_services
echo Building the production image...
docker compose build fracto
if errorlevel 1 goto failed

:initialize_database
echo Initializing the database from backup\*.sql or applying pending migrations...
docker compose run --build --rm database-init
if errorlevel 1 goto failed

echo Building the initial tile index...
docker compose run --build --rm index-refresh
if errorlevel 1 goto failed

echo Starting production...
docker compose up -d fracto
if errorlevel 1 goto failed

echo First-run setup complete. Production is running on http://localhost:3006.
popd
exit /b 0

:missing_services
echo Missing one or more internal service checkouts under servers\.
echo Check out all five service repositories before continuing.
goto failed

:failed
set "first_run_exit_code=%ERRORLEVEL%"
if "%first_run_exit_code%"=="0" set "first_run_exit_code=1"
echo First-run setup failed. Resolve the issue above and run this script again.
popd
exit /b %first_run_exit_code%
