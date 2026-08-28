@echo off
setlocal

pushd "%~dp0.." || exit /b 1
if not exist "tiles\" (
  echo Legacy tile cache not found: %CD%\tiles 1>&2
  popd
  exit /b 1
)

docker compose -f compose.yaml -f compose.dev.yaml stop fracto fracto-dev
if errorlevel 1 goto stop_failed

docker compose run --build --rm tile-cache-migrate
set "migration_exit_code=%ERRORLEVEL%"
popd

exit /b %migration_exit_code%

:stop_failed
set "migration_exit_code=%ERRORLEVEL%"
popd
exit /b %migration_exit_code%
