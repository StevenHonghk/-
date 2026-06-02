@echo off
setlocal
cd /d "%~dp0"

if not exist "configs\sequence.json" (
  echo configs\sequence.json not found.
  echo Copying configs\sequence.example.json to configs\sequence.json...
  copy "configs\sequence.example.json" "configs\sequence.json" >nul
)

if not exist "configs\values.txt" (
  echo configs\values.txt not found.
  echo Copying configs\values.example.txt to configs\values.txt...
  copy "configs\values.example.txt" "configs\values.txt" >nul
)

echo Filling an already-open Edge tab with configs\values.txt...
echo.
npm run fill-current

echo.
echo Press any key to close this window.
pause >nul
