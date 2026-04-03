@echo off
cd /d D:\hongyixuan.1\Desktop\AI??\speakbetter-mvp
start "SpeakBetter-Server" cmd /k "npm run start"
timeout /t 2 >nul
start "" http://127.0.0.1:5173
