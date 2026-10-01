@echo off
cd /d "%~dp0"
title Parez - Shop Accounting
start "" http://127.0.0.1:4177
call npm start
pause
