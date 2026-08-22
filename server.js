import express from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PORT,
  FFMPEG,
  STREAMS_DIR,
  RECORDINGS_DIR,
  loadConfig,
} from './lib/config.js';
import { CameraManager } from './lib/cameras.js';
import {
  listDates,
  listRecordings,
  startCleanupJob,
} from './lib/recordings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 載入設定並啟動串流 ----------------------------------------------------
const { recording, cameras } = loadConfig();

// 開機時清掉舊的即時串流暫存（錄影檔保留）
fs.rmSync(STREAMS_DIR, { recursive: true, force: true });
fs.mkdirSync(STREAMS_DIR, { recursive: true });
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

if (cameras.length === 0) {
  console.warn(
    '⚠️  沒有啟用中的攝影機。請複製 config/cameras.example.json 成 config/cameras.json 並填入你的攝影機資訊。'
  );
}

const manager = new CameraManager(recording);
cameras.forEach((c) => manager.start(c));

const cleanupTimer = recording.enabled
  ? startCleanupJob(recording.retentionDays)
  : null;

// ---- Web 伺服器 ----------------------------------------------------------
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/vendor/hls.js',
  express.static(path.join(__dirname, 'node_modules', 'hls.js', 'dist'))
);
app.use('/streams', express.static(STREAMS_DIR));
// 錄影檔（express 靜態服務自動支援 Range，方便拖曳快轉與下載）
app.use('/recordings', express.static(RECORDINGS_DIR));

// 攝影機清單 + 即時狀態
app.get('/api/cameras', (req, res) => {
  res.json(
    cameras.map((c) => ({
      id: c.id,
      name: c.name,
      status: manager.status(c.id),
      record: recording.enabled && c.record !== false,
      src: `/streams/${c.id}/index.m3u8`,
    }))
  );
});

// 錄影設定資訊
app.get('/api/recording-info', (req, res) => {
  res.json(recording);
});

// 某台攝影機有錄影的日期
app.get('/api/recordings/:id/dates', (req, res) => {
  res.json(listDates(req.params.id));
});

// 某台攝影機某日的所有片段
app.get('/api/recordings/:id', (req, res) => {
  const date = req.query.date; // YYYY-MM-DD
  res.json(listRecordings(req.params.id, date));
});

// 即時快照：從 HLS 擷取一張畫面
app.get('/api/snapshot/:id', (req, res) => {
  const id = path.basename(req.params.id);
  const playlist = path.join(STREAMS_DIR, id, 'index.m3u8');
  if (!fs.existsSync(playlist)) {
    return res.status(503).send('串流尚未就緒');
  }
  const ff = spawn(FFMPEG, [
    '-nostdin',
    '-loglevel', 'error',
    '-i', playlist,
    '-frames:v', '1',
    '-q:v', '3',
    '-f', 'image2',
    'pipe:1',
  ]);
  res.setHeader('Content-Type', 'image/jpeg');
  ff.stdout.pipe(res);
  ff.on('error', () => {
    if (!res.headersSent) res.status(500).end();
  });
  // 逾時保護
  const killer = setTimeout(() => ff.kill('SIGKILL'), 8000);
  ff.on('exit', () => clearTimeout(killer));
});

const server = app.listen(PORT, () => {
  console.log(`\n📷 監視器看板已啟動： http://localhost:${PORT}`);
  console.log(`   攝影機 ${cameras.length} 台`);
  if (recording.enabled) {
    console.log(
      `   錄影：開啟（每段 ${recording.segmentMinutes} 分鐘，保留 ${recording.retentionDays} 天）`
    );
  } else {
    console.log('   錄影：關閉');
  }
  console.log('');
});

// ---- 優雅關閉 ------------------------------------------------------------
function shutdown() {
  console.log('\n正在關閉…');
  if (cleanupTimer) clearInterval(cleanupTimer);
  manager.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
