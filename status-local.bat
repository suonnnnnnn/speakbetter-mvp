@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0server-control.ps1" status
pause
