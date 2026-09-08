@echo off
rem Camera Wall - background runner (auto restart if it crashes)
title Camera Wall Service
cd /d "%~dp0"

:loop
call npm start
rem If it stops for any reason, wait 5 seconds and start again
ping -n 6 127.0.0.1 >nul
goto loop
