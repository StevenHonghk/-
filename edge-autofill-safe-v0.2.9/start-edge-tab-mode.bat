@echo off
setlocal
cd /d "%~dp0"

set "EDGE_PROFILE=%~dp0configs\current-tab-profile"
set "DEBUG_PORT=9222"

echo Starting connectable Microsoft Edge...
echo Debug port: %DEBUG_PORT%
echo Profile: %EDGE_PROFILE%
echo.
start "" msedge --remote-debugging-port=%DEBUG_PORT% --user-data-dir="%EDGE_PROFILE%" --no-first-run

echo Open your target website in the Edge window that just appeared.
echo Then run fill-current.bat or npm run fill-current.
echo.
pause
