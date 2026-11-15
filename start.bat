@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск сайту ЗначокUA. Відкрийте http://localhost:3000
node server.js
pause
