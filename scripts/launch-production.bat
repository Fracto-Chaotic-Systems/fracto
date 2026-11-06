@echo off
setlocal

pushd "%~dp0.." || exit /b 1
node scripts\write_build_info.js
if errorlevel 1 exit /b %ERRORLEVEL%
call scripts\ensure_exclusive.bat prod
if errorlevel 1 exit /b %ERRORLEVEL%
node scripts\windows_host_startup.js --port 3001
if exist ".fracto-production.json" goto managed_production
docker compose up --build -d fracto
set "launch_exit_code=%ERRORLEVEL%"
popd

exit /b %launch_exit_code%

:managed_production
node scripts\build_windows_image.js prod
if errorlevel 1 (popd & exit /b 1)
node scripts\managed_production.js upgrade
set "launch_exit_code=%ERRORLEVEL%"
popd
exit /b %launch_exit_code%
