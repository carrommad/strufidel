@echo off
cd /d "%~dp0"
title Spectrogram Server

netstat -ano | findstr :9090 >nul
if errorlevel 1 (
    start /b "" uv run python -m http.server 9090 >nul 2>&1
    timeout /t 1 /nobreak >nul
)

start "" http://localhost:9090
exit
