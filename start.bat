@echo off
echo [Grzesiu ecom] Zatrzymywanie starych procesow node...
taskkill /f /im node.exe 2>nul
timeout /t 1 /nobreak >nul

echo [Grzesiu ecom] Uruchamianie serwera dev...
cd /d "%~dp0"

start /b cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:3000"

npm run dev
pause
