# 📷 監視器看板 (Camera Wall)

把小米（Mi）、喬安（JOOAN）等多台監視器的畫面，**整合在同一個網頁畫面**裡即時監看。

- 🎥 多台攝影機一次全部顯示成網格
- 🔍 點畫面即可放大單一鏡頭、可全螢幕
- 🔄 攝影機斷線會自動重連
- 🟢 每台顯示連線狀態燈號
- ⚙️ 用一個設定檔管理所有攝影機，新增/移除不用改程式

---

## 運作原理

瀏覽器**不能**直接播放攝影機的 RTSP 串流，所以：

```
攝影機 (RTSP) ──> ffmpeg 轉檔 ──> HLS 串流 ──> 瀏覽器網頁看板
```

後端用 `ffmpeg` 把每台攝影機的 RTSP 即時轉成 HLS，前端用 hls.js 播放。
影像串流是「直接複製、不重新編碼」，所以 CPU 負擔很低。

---

## 安裝

### 1. 安裝 ffmpeg（必要）

| 系統 | 指令 |
| --- | --- |
| macOS | `brew install ffmpeg` |
| Ubuntu/Debian | `sudo apt install ffmpeg` |
| Windows | 到 [ffmpeg.org](https://ffmpeg.org/download.html) 下載，或 `winget install ffmpeg` |

安裝後執行 `ffmpeg -version` 確認成功。

### 2. 安裝專案

```bash
npm install
```

### 3. 設定你的攝影機

複製範例設定檔，改成你自己的：

```bash
cp config/cameras.example.json config/cameras.json
```

編輯 `config/cameras.json`：

```json
{
  "cameras": [
    {
      "id": "livingroom",
      "name": "客廳（小米）",
      "url": "rtsp://使用者:密碼@192.168.1.50:554/stream1",
      "enabled": true
    }
  ]
}
```

| 欄位 | 說明 |
| --- | --- |
| `id` | 唯一代號，只能用英文/數字（會用在網址） |
| `name` | 顯示在畫面上的名稱，中文沒問題 |
| `url` | 攝影機的 RTSP 串流網址（見下方） |
| `enabled` | `false` 可暫時停用某台攝影機 |

### 4. 啟動

```bash
npm start
```

打開瀏覽器進入 **http://localhost:8080** 就能看到所有畫面。

> 想從手機或其他電腦看：用執行主機的區網 IP，例如 `http://192.168.1.10:8080`。

---

## 如何取得 RTSP 網址

RTSP 網址格式通常是：
`rtsp://帳號:密碼@攝影機IP:554/串流路徑`

先到你的路由器管理頁面，找出每台攝影機的**區網 IP**。

### 喬安 JOOAN

喬安攝影機多數支援 ONVIF / RTSP，常見路徑：

```
主串流（高畫質）： rtsp://admin:密碼@攝影機IP:554/live/ch00_0
子串流（省頻寬）： rtsp://admin:密碼@攝影機IP:554/live/ch00_1
```

- 帳號通常是 `admin`，密碼是你在 App 設定的密碼。
- 若上面路徑不通，可在攝影機 App 或網頁後台開啟「ONVIF」，再用 ONVIF 工具查出實際路徑。
- 建議監看用**子串流**（`ch00_1`），畫質夠用又省頻寬，多台同時看比較順。

### 小米 Mi / 米家

小米攝影機**原廠韌體預設不開放 RTSP**，有兩種做法：

1. **支援 RTSP 的機型 / 開啟局域網功能**
   部分小米/米家攝影機在設定裡有「局域網監控」或類似選項，開啟後會提供 RTSP 網址，直接填進來即可。

2. **刷改裝韌體（進階）**
   社群韌體如 [OpenMiio / xiaomi-cam 相關專案](https://github.com/al-one/hass-xiaomi-miot) 或 `MiCam` hack 可開啟 RTSP。
   刷機有風險，請自行評估。

3. **透過 Home Assistant / go2rtc 橋接（最穩）**
   若你已有 Home Assistant，可用 go2rtc 把小米雲端串流轉成 RTSP，再把那個 RTSP 網址填進本系統。

> 💡 先用 [VLC 播放器] 測試：選「開啟網路串流」貼上 RTSP 網址，能播就代表網址正確，再填進設定檔。

---

## 進階設定

用環境變數調整：

```bash
PORT=9000 npm start              # 換連接埠
FFMPEG_PATH=/usr/local/bin/ffmpeg npm start   # 指定 ffmpeg 路徑
```

---

## 疑難排解

| 狀況 | 可能原因與解法 |
| --- | --- |
| 燈號一直紅色 | RTSP 網址錯誤或攝影機離線。先用 VLC 測試網址。 |
| 畫面一直「連線中」 | ffmpeg 正在建立串流，通常等幾秒；若持續，多半是網址不對。 |
| `spawn ffmpeg ENOENT` | 沒裝 ffmpeg，或路徑不對（用 `FFMPEG_PATH` 指定）。 |
| 畫面破裂/卡頓 | 改用子串流（低解析度），或確認網路頻寬足夠。 |
| CPU 很高 | 正常情況幾乎不吃 CPU（純複製）。若很高，代表某台被迫重新編碼，檢查該攝影機格式。 |

---

## 技術棧

- **後端**：Node.js + Express（串流管理、HLS 服務、狀態 API）
- **轉檔**：ffmpeg（RTSP → HLS，直接複製串流）
- **前端**：原生 HTML/CSS/JS + [hls.js](https://github.com/video-dev/hls.js)

## 授權

MIT
