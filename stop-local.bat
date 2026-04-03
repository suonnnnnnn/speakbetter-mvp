@echo off
for /f "tokens=5" %%a in ('netstat -ano ^| findstr LISTENING ^| findstr :5173') do taskkill /PID %%a /F
