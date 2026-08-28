@echo off
setlocal

pushd "%~dp0.." || exit /b 1
docker compose run --rm --no-deps fracto node -e "console.log(process.env.FRACTO_MYSQL_HOST, process.env.FRACTO_MYSQL_PORT)"
set "verify_exit_code=%ERRORLEVEL%"
popd

exit /b %verify_exit_code%
