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

echo Extracting and updating files (your cameras and users are kept)...
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
echo ============================================
echo   Update complete!
echo.
echo   Next: close the black window that is
echo   running the system, then start it again
echo   (npm start), and refresh the browser.
echo ============================================
echo.
pause
