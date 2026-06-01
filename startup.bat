@echo off
cd /d C:\Users\samka\Desktop\secplus-v2
start /b npm run dev
timeout /t 5 /nobreak >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "http://localhost:3000"