@echo off
setlocal

pushd "%~dp0.." || exit /b 1
set "cold_boot_mode=%~1"
if not defined cold_boot_mode set "cold_boot_mode=prod"
if /I "%cold_boot_mode%"=="prod" goto mode_valid
if /I "%cold_boot_mode%"=="dev" goto mode_valid
echo Usage: scripts\cold_boot.bat [prod^|dev]
popd
exit /b 2

:mode_valid

echo [1/4] Refreshing the root and service repositories...
call npm run update:repos
if errorlevel 1 goto failed

echo [2/4] Rebuilding the production image (this may take several minutes)...
docker compose build --progress=plain fracto
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
echo [4/4] Starting the %cold_boot_mode% server with Docker Compose...
call scripts\ensure_exclusive.bat %cold_boot_mode%
if errorlevel 1 goto failed
if /I "%cold_boot_mode%"=="dev" goto start_dev
docker compose up -d fracto
if errorlevel 1 goto failed
set "cold_boot_log_service=fracto"
set "cold_boot_log_compose=docker compose"
goto stream_logs

:start_dev
docker compose -f compose.yaml -f compose.dev.yaml up -d fracto-dev
if errorlevel 1 goto failed
set "cold_boot_log_service=fracto-dev"
set "cold_boot_log_compose=docker compose -f compose.yaml -f compose.dev.yaml"

:stream_logs
if /I "%cold_boot_mode%"=="dev" (set "cold_boot_url=http://localhost:3106") else (set "cold_boot_url=http://localhost:3006")
echo Cold boot complete. %cold_boot_mode% is running on %cold_boot_url%.
echo Streaming Docker logs; press Ctrl+C to stop viewing logs (the server stays running).
%cold_boot_log_compose% logs -f %cold_boot_log_service%
popd
exit /b 0

:failed
set "cold_boot_exit_code=%ERRORLEVEL%"
if "%cold_boot_exit_code%"=="0" set "cold_boot_exit_code=1"
echo Cold boot failed. Resolve the issue above and rerun scripts\cold_boot.bat.
popd
exit /b %cold_boot_exit_code%
