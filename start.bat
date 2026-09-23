@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://127.0.0.1:4173
call npm start
