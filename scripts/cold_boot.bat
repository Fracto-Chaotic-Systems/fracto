@echo off
setlocal

pushd "%~dp0.." || exit /b 1

echo [1/4] Refreshing the root and service repositories...
call npm run update:repos
if errorlevel 1 goto failed

echo [2/4] Rebuilding the production image...
docker compose build fracto
if errorlevel 1 goto failed

echo [3/4] Tile-index refresh is optional and can take about an hour.
set "refresh_tiles="
set /p "refresh_tiles=Refresh the compiled tile index now? [y/N] "
if /I not "%refresh_tiles%"=="Y" goto start_production
echo Refreshing the compiled tile index...
echo The existing published generation remains usable until refresh completes.
docker compose run --rm index-refresh
if errorlevel 1 goto failed

:start_production
echo [4/4] Starting the production server with Docker Compose...
docker compose up -d fracto
if errorlevel 1 goto failed

echo Cold boot complete. Production is running on http://localhost:3006.
popd
exit /b 0

:failed
set "cold_boot_exit_code=%ERRORLEVEL%"
if "%cold_boot_exit_code%"=="0" set "cold_boot_exit_code=1"
echo Cold boot failed. Resolve the issue above and rerun scripts\cold_boot.bat.
popd
exit /b %cold_boot_exit_code%
