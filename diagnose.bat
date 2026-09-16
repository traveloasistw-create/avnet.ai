@echo off
chcp 65001 >nul
title Camera Wall - Diagnose
echo ============================================
echo    Camera Wall - find all copies / instances
echo ============================================
echo.

echo [1] Node servers running now (each line = one running system):
echo --------------------------------------------
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | ForEach-Object { $_.CommandLine }"
echo.

echo [2] Camera streams (ffmpeg) running now:
echo --------------------------------------------
powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"name='ffmpeg.exe'\").Count"
echo.

echo [3] What is listening on port 8080 (the dashboard):
echo --------------------------------------------
netstat -ano | findstr :8080 | findstr LISTENING
echo.

echo [4] Project folders found on this PC (folders containing server.js):
echo     (searching Desktop, Downloads, Documents, C:\ root - please wait)
echo --------------------------------------------
powershell -NoProfile -Command "$roots=@(\"$env:USERPROFILE\Desktop\",\"$env:USERPROFILE\Downloads\",\"$env:USERPROFILE\Documents\",'C:\'); $found=@(); foreach($r in $roots){ Get-ChildItem -Path $r -Filter server.js -Recurse -Depth 3 -ErrorAction SilentlyContinue | ForEach-Object { $found += $_.DirectoryName } }; $found | Select-Object -Unique"
echo.

echo ============================================
echo   Done. Please screenshot this whole window
echo   and send it back to me.
echo ============================================
echo.
pause
