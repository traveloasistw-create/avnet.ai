@echo off
title Camera Wall - Stop
echo ============================================
echo    Camera Wall - Stop
echo ============================================
echo.
echo Stopping the camera system...

rem 1) Stop the background keep-alive loop first
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*run-service.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul

rem 2) Then stop the server and the camera streams
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im ffmpeg.exe >nul 2>nul

echo.
echo Stopped.
echo.
echo To start it again: double-click  install-autostart.bat
echo (or just reboot this computer)
echo.
pause
