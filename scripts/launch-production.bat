@echo off
setlocal

pushd "%~dp0.." || exit /b 1
docker compose up --build -d fracto
set "launch_exit_code=%ERRORLEVEL%"
popd

exit /b %launch_exit_code%
