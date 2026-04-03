@echo off
cd /d "%~dp0"
start "SpeakBetterDaemon" /min cmd /c "\"C:\Program Files\nodejs\node.exe\" server.js > \"%~dp0server.out.log\" 2> \"%~dp0server.err.log\""
