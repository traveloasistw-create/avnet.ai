# 📷 監視器看板 (Camera Wall)

把小米（Mi）、喬安（JOOAN）等多台監視器的畫面，**整合在同一個網頁畫面**裡即時監看。

- 🎥 多台攝影機一次全部顯示成網格
- 🔍 點畫面即可放大單一鏡頭、可全螢幕
- 📹 **24 小時連續錄影（選用，預設關閉）**：開啟後自動切成時段檔案存到硬碟
- ⏪ **回放（選用）**：選攝影機 + 日期，列出片段、播放、拖曳快轉、下載
- 🗑️ **自動清理**：開啟錄影時，超過保留天數的舊錄影自動刪除，硬碟不爆
- 📸 **即時快照**：一鍵擷取當下畫面
- ⏺ **當下錄影到本機**：把當下畫面直接錄下來存到你正在用的電腦
- 👥 **帳號登入與權限**：每個同事一組帳號，登入後只看得到被授權的攝影機
- ➕ **隨時擴充**：未來新增監視器，在管理頁點一點就加進去，立刻顯示、不用改檔或重開
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

**最簡單的方式：啟動後用網頁「管理」頁面新增**（見下方〈新增攝影機〉），
不用編輯任何檔案。以下手動編輯設定檔的方式為進階/初始批次匯入用。

複製範例設定檔，改成你自己的：

```bash
cp config/cameras.example.json config/cameras.json
```

編輯 `config/cameras.json`：

```json
{
  "recording": {
    "enabled": true,
    "segmentMinutes": 10,
    "retentionDays": 7
  },
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

**`cameras` 每台攝影機欄位：**

| 欄位 | 說明 |
| --- | --- |
| `id` | 唯一代號，只能用英文/數字（會用在網址） |
| `name` | 顯示在畫面上的名稱，中文沒問題 |
| `url` | 攝影機的 RTSP 串流網址（見下方） |
| `enabled` | `false` 可暫時停用某台攝影機 |
| `record` | 選填。`false` 表示這台只看即時、不錄影 |

**`recording` 錄影設定（全域）：**

| 欄位 | 說明 | 預設 |
| --- | --- | --- |
| `enabled` | 是否開啟中央錄影 | `false` |
| `segmentMinutes` | 每段錄影檔的長度（分鐘） | `10` |
| `retentionDays` | 保留幾天，超過自動刪除 | `7` |

> **預設為純即時監看牆（中央錄影關閉）**：電腦不必 24 小時開機，
> 上班開、下班關都行；歷史畫面可用各攝影機自己的記憶卡回看。
> 若要開啟系統的 24 小時錄影 + 網頁回放，把 `enabled` 改成 `true` 即可
> （此時電腦需保持開機）。「回放」分頁與錄影相關選項只有在開啟時才會出現。

### 4. 啟動

```bash
npm start
```

打開瀏覽器進入 **http://localhost:8080**：

- **即時** 分頁：所有攝影機畫面同時顯示，可放大、全螢幕、擷取快照（📸）
- **回放** 分頁：選攝影機 + 日期 → 列出當天所有片段 → 點選播放、拖曳快轉、下載

> 想從手機或其他電腦看：用執行主機的區網 IP，例如 `http://192.168.1.10:8080`。

---

## 帳號登入與權限

系統內建登入機制，同事各自用帳號登入，只看得到你授權給他的攝影機。

**第一次啟動**會自動建立管理員帳號，並印在終端機視窗：

```
帳號：admin
密碼：admin        ← 請登入後立刻到「管理」頁改掉
```

（也可在啟動前用環境變數 `ADMIN_PASSWORD=你的密碼 npm start` 設定初始密碼。）

**用管理員登入後**，右上角會出現「管理」分頁，可以：

- ➕ 新增同事帳號、設定密碼
- ✅ 勾選每個同事能看哪幾支攝影機
- 🔑 重設密碼、刪除帳號
- 👑 需要看全部的人可設為「管理員」

> 權限是**鎖在後端**的：沒被授權的攝影機，該帳號連即時畫面、錄影、快照的網址都拿不到，
> 不只是畫面藏起來而已。
>
> 帳號資料存在 `config/users.json`（自動管理，密碼以雜湊儲存，請勿手改）。

---

## 新增攝影機（未來擴充）

未來多買了監視器，用管理員登入 →「管理」頁 →「攝影機管理」：

- ➕ 填**名稱**和**RTSP 網址**，按新增 → 立刻開始顯示（不用改檔、不用重開程式）
- ✏️ 每台可隨時改名稱/網址、切換是否錄影、暫時停用
- 🗑️ 刪除攝影機（已錄好的影片會保留）
- 新增後記得到帳號設定裡，把它勾給需要看的同事

> 攝影機變動會自動存回 `config/cameras.json`，重開電腦後設定都還在。

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

### 小米 Mi / 米家（含 C500 雙鏡版）

⚠️ **重點**：新款小米攝影機（如 **C500 雙鏡版**、CW 系列）原廠韌體**不支援 RTSP，也沒有 ONVIF**，
所以不能像喬安那樣直接填網址。要透過一個橋接工具把它轉出 RTSP。

**推薦做法：用 Micam 橋接（不用刷機，最穩）**

[Micam](https://github.com/miiot/micam) 是社群做的小米攝影機 RTSP 橋接服務，用 Docker 執行：
它會用你的小米帳號登入，把攝影機串流**在本地轉推成 RTSP**（內建 go2rtc），
再把它給你的 RTSP 網址填進本系統的 `cameras.json` 即可。

安裝（需要 Docker）：

```bash
mkdir -p /opt/micam && cd /opt/micam
wget https://raw.githubusercontent.com/miiot/micam/refs/heads/main/docker-compose.yml
docker compose up -d
```

啟動後照 Micam 說明登入你的小米帳號、選擇要橋接的攝影機，它會列出每台的 RTSP 網址，
格式類似 `rtsp://<Micam主機IP>:8554/<攝影機代號>`。把該網址填進 `cameras.json` 即可。

> **C500 是雙鏡頭**：Micam 通常會給你「廣角」與「望遠」兩條串流。
> 在 `cameras.json` 裡放兩筆（`id` 用 `c500_wide`、`c500_tele`），看板上就會顯示成兩格。

**其他做法（進階，不建議一般使用者）**

- 已有 Home Assistant：可直接用 Micam 或 go2rtc 接進 HA，再取 RTSP 網址。
- 刷改裝韌體：C500 較新，社群韌體支援有限且有變磚風險，不建議。

> 💡 拿到任何 RTSP 網址後，先用 **VLC 播放器**（「開啟網路串流」貼上網址）測試，
> 能播就代表網址正確，再填進設定檔。

---

## 進階設定

用環境變數調整：

```bash
PORT=9000 npm start                            # 換連接埠
FFMPEG_PATH=/usr/local/bin/ffmpeg npm start    # 指定 ffmpeg 路徑
RETENTION_DAYS=14 npm start                    # 錄影保留 14 天
SEGMENT_MINUTES=5 npm start                    # 每段錄影 5 分鐘
```

### 錄影會佔多少硬碟？

錄影是「直接複製」攝影機的串流，大小取決於攝影機碼率。以常見設定粗估：

- 1080p 約 2 Mbps → 每台每天約 **20 GB**
- 用**子串流**（低解析度）錄影可大幅節省空間

硬碟空間 ≈ `每台每天用量 × 攝影機數 × retentionDays`。
空間不夠時：調低 `retentionDays`、對次要攝影機設 `"record": false`，或改用子串流錄影。
錄影檔存在專案的 `recordings/` 資料夾。

---

## 疑難排解

| 狀況 | 可能原因與解法 |
| --- | --- |
| 燈號一直紅色 | RTSP 網址錯誤或攝影機離線。先用 VLC 測試網址。 |
| 畫面一直「連線中」 | ffmpeg 正在建立串流，通常等幾秒；若持續，多半是網址不對。 |
| `spawn ffmpeg ENOENT` | 沒裝 ffmpeg，或路徑不對（用 `FFMPEG_PATH` 指定）。 |
| 畫面破裂/卡頓 | 改用子串流（低解析度），或確認網路頻寬足夠。 |
| CPU 很高 | 正常情況幾乎不吃 CPU（純複製）。若很高，代表某台被迫重新編碼，檢查該攝影機格式。 |
| 回放沒有片段 | 確認該攝影機 `record` 沒設成 `false`、`recording.enabled` 為 `true`，且已錄超過一段時間。 |
| 硬碟被塞滿 | 調低 `retentionDays`、關掉次要攝影機錄影，或改用子串流錄影。 |

---

## 專案結構

```
server.js            Express 伺服器與 API
lib/config.js        讀取設定與預設值
lib/cameras.js       每台一個 ffmpeg：同時輸出 HLS 即時串流 + 分段錄影
lib/recordings.js    錄影檔查詢與過期自動清理
lib/auth.js          帳號、密碼雜湊、Session 與權限判斷
public/              前端（即時 index / 回放 playback / 管理 admin / 登入 login）
config/cameras.json  你的攝影機與錄影設定（自行建立）
config/users.json    使用者帳號（自動管理，密碼雜湊儲存）
streams/             HLS 即時串流暫存（開機自動清除）
recordings/          錄影檔（依保留天數自動清理）
data/                Session 金鑰等（自動產生）
```

## 技術棧

- **後端**：Node.js + Express（串流管理、HLS 服務、錄影/回放 API）
- **轉檔/錄影**：ffmpeg（單一連線同時輸出 HLS 即時串流與分段 MP4，直接複製串流）
- **前端**：原生 HTML/CSS/JS + [hls.js](https://github.com/video-dev/hls.js)

## 授權

MIT
