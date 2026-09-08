@echo off
title Camera Wall - Update
cd /d "%~dp0"

echo ============================================
echo    Camera Wall - Update to latest version
echo ============================================
echo.
echo Downloading latest version...
curl -L -o _update.zip https://github.com/traveloasistw-create/avnet.ai/archive/refs/heads/claude/photography-system-software-mat8x8.zip
if errorlevel 1 (
  echo [ERROR] Download failed. Check your internet and try again.
  pause
  exit /b
)

echo Extracting and updating files - your cameras and users are kept...
tar -xf _update.zip --strip-components=1
if errorlevel 1 (
  echo [ERROR] Extract failed.
  del _update.zip
  pause
  exit /b
)

del _update.zip

echo Installing components...
call npm install

echo.
echo Stopping the old version...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*run-service.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul
taskkill /f /im node.exe >nul 2>nul
taskkill /f /im ffmpeg.exe >nul 2>nul

if exist "%~dp0run-hidden.vbs" goto autorestart
goto manualrestart

:autorestart
echo Starting the new version in the background...
start "" wscript "%~dp0run-hidden.vbs"
ping -n 9 127.0.0.1 >nul
echo.
echo ============================================
echo   Update complete!
echo.
echo   The system restarted by itself.
echo   Just refresh your browser:
echo      http://localhost:8080
echo ============================================
echo.
pause
exit /b

:manualrestart
echo.
echo ============================================
echo   Update complete!
echo.
echo   Now start the system again:
echo      double-click  start-windows.bat
echo.
echo   TIP: run  install-autostart.bat  once, and
echo   the system will start by itself on boot,
echo   in the background, with no black window.
echo ============================================
echo.
pause
