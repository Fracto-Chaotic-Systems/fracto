@echo off
setlocal

set "target=%~1"
if /I "%target%"=="prod" goto check_dev
if /I "%target%"=="dev" goto check_prod
echo Usage: scripts\ensure_exclusive.bat [prod^|dev]
exit /b 2

:check_dev
set "other="
for /f "delims=" %%I in ('docker compose -f compose.yaml -f compose.dev.yaml ps --status running -q fracto-dev 2^>nul') do set "other=%%I"
if not defined other exit /b 0
choice /C YN /N /M "Development server is running. Stop it gracefully before launching production? [Y/N] "
if errorlevel 2 exit /b 1
docker compose -f compose.yaml -f compose.dev.yaml stop fracto-dev
exit /b %ERRORLEVEL%

:check_prod
set "other="
for /f "delims=" %%I in ('docker compose ps --status running -q fracto 2^>nul') do set "other=%%I"
if not defined other exit /b 0
choice /C YN /N /M "Production server is running. Stop it gracefully before launching development? [Y/N] "
if errorlevel 2 exit /b 1
docker compose stop fracto
exit /b %ERRORLEVEL%
