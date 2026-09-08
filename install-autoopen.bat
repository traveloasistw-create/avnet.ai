@echo off
title Camera Wall - Auto Open Dashboard
cd /d "%~dp0"

echo ============================================
echo    Camera Wall - Open dashboard on startup
echo ============================================
echo.
echo After this, every time Windows starts the
echo camera dashboard opens by itself on screen.
echo You will not have to click anything.
echo.

if not exist "%~dp0open-wall.vbs" (
  echo [ERROR] open-wall.vbs is missing.
  echo Run update-windows.bat first, then try again.
  echo.
  pause
  exit /b
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "%~dp0open-wall.vbs" "%STARTUP%\CameraWallOpen.vbs" >nul
if errorlevel 1 (
  echo [ERROR] Could not register it.
  pause
  exit /b
)

echo.
echo ============================================
echo   DONE!
echo.
echo   From the next reboot, the dashboard opens
echo   automatically - it waits for the system to
echo   be ready first, so give it a few seconds.
echo.
echo   REMINDER: the background service must also
echo   be installed. If you have not done it yet,
echo   run  install-autostart.bat  as well.
echo.
echo   To undo this: run  uninstall-autoopen.bat
echo ============================================
echo.
pause
