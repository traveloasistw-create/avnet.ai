#!/bin/bash
# 監視器看板 - Mac 一鍵啟動
# 使用方式：在這個檔案上按右鍵 →「打開」（第一次會問是否確定，選「打開」）

cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "   監視器看板 啟動程式 (Mac)"
echo "============================================"
echo ""

# --- 檢查 Node.js ---
if ! command -v node >/dev/null 2>&1; then
  echo "[錯誤] 找不到 Node.js。"
  echo "請先到 https://nodejs.org/ 下載並安裝 LTS 版，"
  echo "安裝完成後，再重新打開這個檔案。"
  echo ""
  read -n 1 -s -r -p "按任意鍵關閉…"
  exit 1
fi

# --- 檢查 ffmpeg（沒有的話畫面無法顯示，僅提醒不中斷） ---
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[提醒] 找不到 ffmpeg，攝影機畫面將無法顯示。"
  echo "請先安裝 Homebrew（https://brew.sh），再於「終端機」執行："
  echo "    brew install ffmpeg"
  echo "安裝完成後，再重新打開這個檔案。"
  echo ""
fi

# --- 第一次啟動自動安裝必要元件 ---
if [ ! -d node_modules ]; then
  echo "第一次啟動，正在安裝必要元件，請稍候幾分鐘……"
  echo ""
  npm install
  echo ""
fi

echo "============================================"
echo "   系統啟動中……"
echo ""
echo "   請用瀏覽器開啟： http://localhost:8080"
echo "   預設帳號： admin      密碼： admin"
echo "   （第一次登入後請立刻到「管理」頁修改密碼）"
echo ""
echo "   要關閉系統：關掉這個視窗，或按 Control + C"
echo "============================================"
echo ""

npm start
