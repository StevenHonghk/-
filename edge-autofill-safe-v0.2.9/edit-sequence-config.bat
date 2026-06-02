@echo off
setlocal
cd /d "%~dp0"

if not exist "configs\sequence.json" (
  copy "configs\sequence.example.json" "configs\sequence.json" >nul
)

if not exist "configs\values.txt" (
  copy "configs\values.example.txt" "configs\values.txt" >nul
)

start "" notepad "configs\sequence.json"
start "" notepad "configs\values.txt"
