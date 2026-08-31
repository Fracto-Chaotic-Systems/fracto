@echo off
setlocal

if "%~1"=="" (
  echo Usage: redo-migration.bat NNN
  echo Example: redo-migration.bat 002
  exit /b 1
)

echo This will re-run migration %~1 against the configured database.
echo The migration must be idempotent. No tables or rows are removed automatically.
choice /C YN /N /M "Continue? [y/N] "
if errorlevel 2 exit /b 0

pushd "%~dp0.." || exit /b 1
echo Building the image with the latest migration logic...
docker compose build fracto
if errorlevel 1 goto build_failed
docker compose run --rm database-init node scripts/initialize_database.js --force %~1
set "redo_exit_code=%ERRORLEVEL%"
popd
exit /b %redo_exit_code%

:build_failed
set "redo_exit_code=%ERRORLEVEL%"
popd
exit /b %redo_exit_code%
