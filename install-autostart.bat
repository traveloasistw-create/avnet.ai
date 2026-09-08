@echo off
setlocal enabledelayedexpansion
title Camera Wall - Install Autostart
cd /d "%~dp0"

echo ============================================
echo    Camera Wall - Install Autostart
echo ============================================
echo.
echo After this, the system starts automatically
echo with Windows and runs in the background.
echo No CMD, no black window needed.
echo.

rem --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install Node.js from https://nodejs.org/ first.
  echo.
  pause
  exit /b
)

rem --- Check ffmpeg ---
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [NOTE] ffmpeg not found - video will not show yet.
  echo Run this in an Administrator command prompt:
  echo     winget install Gyan.FFmpeg
  echo then reboot and run this file again.
  echo.
)

rem --- Install components on first run ---
if not exist node_modules (
  echo Installing components, please wait a few minutes...
  echo.
  call npm install
  echo.
)

rem --- Build the hidden launcher ---
set "VBS=%~dp0run-hidden.vbs"
> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>> "%VBS%" echo sh.Run """%~dp0run-service.bat""", 0, False

rem --- Register it to start with Windows ---
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "%VBS%" "%STARTUP%\CameraWall.vbs" >nul
if errorlevel 1 (
  echo [ERROR] Could not register autostart.
  pause
  exit /b
)

rem --- Desktop shortcut that opens the dashboard ---
set "LNK=%USERPROFILE%\Desktop\Camera Wall.url"
> "%LNK%" echo [InternetShortcut]
>> "%LNK%" echo URL=http://localhost:8080

rem --- Start it right now ---
start "" wscript "%VBS%"

echo.
echo ============================================
echo   DONE!
echo.
echo   The system is now running in the background
echo   and will start by itself every time this
echo   computer boots.
echo.
echo   On THIS computer, open:
echo      http://localhost:8080
echo   (or double-click "Camera Wall" on the Desktop)
echo.
echo   Your colleagues on the same Wi-Fi can use:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "ip=%%a"
  set "ip=!ip: =!"
  echo      http://!ip!:8080
)
echo.
echo   TIP: to also make the dashboard open on
echo   screen at boot, run  install-autoopen.bat
echo.
echo   To stop the system:  run  stop.bat
echo   To turn off autostart:  run  uninstall-autostart.bat
echo ============================================
echo.
pause
