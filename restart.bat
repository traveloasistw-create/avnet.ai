@echo off
title Camera Wall - Restart
echo ============================================
echo    Camera Wall - Restart
echo ============================================
echo.
echo Restarting the camera system...
echo (use this after running update-windows.bat)
echo.

rem Killing the server is enough - the background
rem loop brings it back up within a few seconds.
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im ffmpeg.exe >nul 2>nul

ping -n 9 127.0.0.1 >nul

echo Done. Refresh your browser at http://localhost:8080
echo.
pause
