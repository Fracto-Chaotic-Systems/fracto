@echo off
setlocal

echo WARNING: This removes host node_modules directories and all Docker builder cache.
echo Named application volumes, images, containers, tile data, and indexes are preserved.
choice /C YN /N /M "Continue? [Y/N] "
if errorlevel 2 exit /b 0

pushd "%~dp0.." || exit /b 1

echo Removing host dependencies...
for %%D in (
  "node_modules"
  "servers\fracto-admin-server\node_modules"
  "servers\fracto-asset-server\node_modules"
  "servers\fracto-data-server\node_modules"
  "servers\fracto-tiles-server\node_modules"
  "servers\fracto-ui\node_modules"
) do if exist "%%~D" rmdir /s /q "%%~D"

echo Clearing Docker builder cache...
docker builder prune --all --force
set "clean_exit_code=%ERRORLEVEL%"
popd

exit /b %clean_exit_code%
