@echo off
setlocal

pushd "%~dp0.." || exit /b 1
call scripts\ensure_exclusive.bat prod
if errorlevel 1 exit /b %ERRORLEVEL%
docker compose up --build -d fracto
set "launch_exit_code=%ERRORLEVEL%"
popd

exit /b %launch_exit_code%
