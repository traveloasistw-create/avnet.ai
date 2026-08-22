import express from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 設定 ----------------------------------------------------------------
const PORT = process.env.PORT || 8080;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const STREAMS_DIR = path.join(__dirname, 'streams');
const CONFIG_PATH = path.join(
  __dirname,
  'config',
  fs.existsSync(path.join(__dirname, 'config', 'cameras.json'))
    ? 'cameras.json'
    : 'cameras.example.json'
);

// HLS 參數：段短一點延遲較低，但太短會不穩，2 秒是家用監看的甜蜜點
const HLS_SEGMENT_TIME = 2;
const HLS_LIST_SIZE = 4;
const RESTART_DELAY_MS = 5000; // ffmpeg 掛掉後隔多久重啟

// ---- 載入攝影機設定 --------------------------------------------------------
function loadCameras() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return (parsed.cameras || []).filter((c) => c.enabled !== false);
  } catch (err) {
    console.error(`⚠️  無法讀取設定檔 ${CONFIG_PATH}:`, err.message);
    return [];
  }
}

// ---- 串流管理器 ------------------------------------------------------------
// 每台攝影機開一個 ffmpeg，把 RTSP 轉成 HLS 寫到 streams/<id>/index.m3u8
const processes = new Map(); // id -> { proc, camera, status }

function startStream(camera) {
  const outDir = path.join(STREAMS_DIR, camera.id);
  fs.mkdirSync(outDir, { recursive: true });

  const playlist = path.join(outDir, 'index.m3u8');
  const segmentPattern = path.join(outDir, 'seg_%03d.ts');

  const args = [
    '-nostdin',
    '-loglevel', 'error',
    // RTSP 用 TCP 傳輸較穩定（UDP 容易掉包導致畫面破裂）
    '-rtsp_transport', 'tcp',
    // 連線逾時（微秒），避免攝影機離線時卡住
    '-stimeout', '5000000',
    '-i', camera.url,
    // 直接複製視訊串流，不重新編碼 → 幾乎不吃 CPU
    '-an',
    '-c:v', 'copy',
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_TIME),
    '-hls_list_size', String(HLS_LIST_SIZE),
    '-hls_flags', 'delete_segments+omit_endlist',
    '-hls_segment_filename', segmentPattern,
    playlist,
  ];

  console.log(`▶️  啟動串流: ${camera.name} (${camera.id})`);
  const proc = spawn(FFMPEG, args);
  const entry = { proc, camera, status: 'starting' };
  processes.set(camera.id, entry);

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[${camera.id}] ${msg}`);
  });

  proc.on('spawn', () => {
    entry.status = 'running';
  });

  proc.on('exit', (code, signal) => {
    entry.status = 'stopped';
    if (signal === 'SIGTERM' || signal === 'SIGKILL') return; // 我們主動關掉的
    console.warn(
      `⚠️  ${camera.name} 的串流結束 (code=${code})，${RESTART_DELAY_MS / 1000} 秒後重試`
    );
    setTimeout(() => {
      if (processes.get(camera.id) === entry) startStream(camera);
    }, RESTART_DELAY_MS);
  });

  proc.on('error', (err) => {
    entry.status = 'error';
    console.error(`❌ 無法啟動 ffmpeg (${camera.id}):`, err.message);
    if (err.code === 'ENOENT') {
      console.error(
        '   找不到 ffmpeg。請先安裝 ffmpeg，或用 FFMPEG_PATH 環境變數指定路徑。'
      );
    }
  });
}

function stopAll() {
  for (const { proc } of processes.values()) {
    proc.kill('SIGTERM');
  }
}

// ---- 啟動 ----------------------------------------------------------------
const cameras = loadCameras();

// 開機時清掉舊的串流檔
fs.rmSync(STREAMS_DIR, { recursive: true, force: true });
fs.mkdirSync(STREAMS_DIR, { recursive: true });

if (cameras.length === 0) {
  console.warn(
    '⚠️  沒有啟用中的攝影機。請複製 config/cameras.example.json 成 config/cameras.json 並填入你的攝影機資訊。'
  );
}
cameras.forEach(startStream);

// ---- Web 伺服器 ----------------------------------------------------------
const app = express();

// 前端頁面
app.use(express.static(path.join(__dirname, 'public')));
// hls.js（從 npm 套件直接提供，執行時不需連外網）
app.use(
  '/vendor/hls.js',
  express.static(path.join(__dirname, 'node_modules', 'hls.js', 'dist'))
);
// HLS 串流檔（.m3u8 / .ts）
app.use('/streams', express.static(STREAMS_DIR));

// API：讓前端知道有哪些攝影機
app.get('/api/cameras', (req, res) => {
  res.json(
    cameras.map((c) => ({
      id: c.id,
      name: c.name,
      status: processes.get(c.id)?.status || 'unknown',
      src: `/streams/${c.id}/index.m3u8`,
    }))
  );
});

const server = app.listen(PORT, () => {
  console.log(`\n📷 監視器看板已啟動： http://localhost:${PORT}`);
  console.log(`   共 ${cameras.length} 台攝影機\n`);
});

// ---- 優雅關閉 ------------------------------------------------------------
function shutdown() {
  console.log('\n正在關閉…');
  stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
