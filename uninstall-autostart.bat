@echo off
title Camera Wall - Remove Autostart
cd /d "%~dp0"

echo ============================================
echo    Camera Wall - Remove Autostart
echo ============================================
echo.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP%\CameraWall.vbs" (
  del "%STARTUP%\CameraWall.vbs"
  echo Autostart removed.
) else (
  echo Autostart was not installed.
)

echo.
echo The system will NOT start automatically anymore.
echo It is still running right now - use stop.bat to stop it.
echo.
pause
