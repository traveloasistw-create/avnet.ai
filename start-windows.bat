@echo off
chcp 65001 >nul
title 監視器看板
cd /d "%~dp0"

echo ============================================
echo    監視器看板 啟動程式
echo ============================================
echo.

rem --- 檢查 Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js。
  echo 請先到 https://nodejs.org/ 下載並安裝 LTS 版，
  echo 安裝完成後，再重新點兩下這個檔案。
  echo.
  pause
  exit /b
)

rem --- 檢查 ffmpeg（沒有的話畫面無法顯示，僅提醒不中斷） ---
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [提醒] 找不到 ffmpeg，攝影機畫面將無法顯示。
  echo 請用「系統管理員」開啟命令提示字元後執行：
  echo     winget install Gyan.FFmpeg
  echo 安裝完成後重開機，再重新啟動本程式。
  echo.
)

rem --- 第一次啟動自動安裝必要元件 ---
if not exist node_modules (
  echo 第一次啟動，正在安裝必要元件，請稍候幾分鐘……
  echo.
  call npm install
  echo.
)

echo ============================================
echo   系統啟動中……
echo.
echo   請用瀏覽器開啟： http://localhost:8080
echo   預設帳號： admin      密碼： admin
echo   （第一次登入後請立刻到「管理」頁修改密碼）
echo.
echo   要關閉系統：直接關掉這個黑色視窗即可。
echo ============================================
echo.

call npm start

echo.
echo 系統已停止。按任意鍵關閉視窗。
pause >nul
