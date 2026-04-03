@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=5173
set HOST=127.0.0.1
"C:\Program Files\nodejs\node.exe" server.js
set EXIT_CODE=%ERRORLEVEL%
echo.
echo [SpeakBetter] server exited, code=%EXIT_CODE%
pause
