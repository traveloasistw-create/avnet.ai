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

echo Extracting...
tar -xf _update.zip
if errorlevel 1 (
  echo [ERROR] Extract failed.
  del _update.zip
  pause
  exit /b
)

echo Copying files (your cameras and users are kept)...
xcopy /E /Y /Q avnet.ai-claude-photography-system-software-mat8x8\* . >nul

del _update.zip
rmdir /S /Q avnet.ai-claude-photography-system-software-mat8x8

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
