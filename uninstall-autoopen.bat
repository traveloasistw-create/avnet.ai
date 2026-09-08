@echo off
title Camera Wall - Stop Auto Open
echo ============================================
echo    Camera Wall - Stop opening on startup
echo ============================================
echo.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP%\CameraWallOpen.vbs" (
  del "%STARTUP%\CameraWallOpen.vbs"
  echo Removed.
) else (
  echo It was not set up.
)

echo.
echo The dashboard will no longer open by itself.
echo The system itself keeps running in the background.
echo.
pause
