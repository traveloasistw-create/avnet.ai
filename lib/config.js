import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
export const STREAMS_DIR = path.join(ROOT, 'streams');
export const RECORDINGS_DIR = path.join(ROOT, 'recordings');

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const PORT = process.env.PORT || 8080;

const CONFIG_PATH = fs.existsSync(path.join(ROOT, 'config', 'cameras.json'))
  ? path.join(ROOT, 'config', 'cameras.json')
  : path.join(ROOT, 'config', 'cameras.example.json');

// 預設值，可被設定檔或環境變數覆寫
const DEFAULT_RECORDING = {
  enabled: true,
  segmentMinutes: 10, // 每段錄影長度（分鐘）
  retentionDays: 7, // 保留天數，超過自動刪除
};

export function loadConfig() {
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    console.error(`⚠️  無法讀取設定檔 ${CONFIG_PATH}:`, err.message);
  }

  const recording = { ...DEFAULT_RECORDING, ...(parsed.recording || {}) };
  if (process.env.RETENTION_DAYS)
    recording.retentionDays = Number(process.env.RETENTION_DAYS);
  if (process.env.SEGMENT_MINUTES)
    recording.segmentMinutes = Number(process.env.SEGMENT_MINUTES);

  const cameras = (parsed.cameras || []).filter((c) => c.enabled !== false);

  return { recording, cameras, configPath: CONFIG_PATH };
}
