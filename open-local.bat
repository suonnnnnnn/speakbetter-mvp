@echo off
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr LISTENING ^| findstr :5173') do taskkill /PID %%a /F >nul 2>nul
start cmd /k daemon-debug.bat
echo SpeakBetter server is starting...
echo Open this URL in browser: http://127.0.0.1:5173
