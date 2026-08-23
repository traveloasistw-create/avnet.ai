@echo off
title Camera Wall
cd /d "%~dp0"

echo ============================================
echo    Camera Wall - Start
echo ============================================
echo.

rem --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install Node.js LTS from https://nodejs.org/
  echo then run this file again.
  echo.
  pause
  exit /b
)

rem --- Check ffmpeg (only a warning, does not stop) ---
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [NOTE] ffmpeg not found - camera video will NOT show yet.
  echo Install it in an Administrator command prompt with:
  echo     winget install Gyan.FFmpeg
  echo then reboot, and start this again.
  echo.
)

rem --- First run: install components automatically ---
if not exist node_modules (
  echo First run: installing components, please wait a few minutes...
  echo.
  call npm install
  echo.
)

echo ============================================
echo   Starting...
echo.
echo   Open in your browser:  http://localhost:8080
echo   Login:  admin  /  admin
echo   (change the password after first login)
echo.
echo   To STOP the system: just close this window.
echo ============================================
echo.

call npm start

echo.
echo System stopped. Press any key to close.
pause >nul
