@echo off
cd /d "%~dp0"
echo cwd=%cd%
"C:\Program Files\nodejs\node.exe" server.js
echo exit=%errorlevel%
pause
