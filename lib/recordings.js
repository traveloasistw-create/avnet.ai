import fs from 'node:fs';
import path from 'node:path';
import { RECORDINGS_DIR } from './config.js';

// 檔名格式：YYYY-MM-DD_HH-MM-SS.mp4
const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/;

function parseStart(filename) {
  const m = filename.match(NAME_RE);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S] = m.map(Number);
  return new Date(Y, Mo - 1, D, H, Mi, S);
}

function safeCameraDir(cameraId) {
  // 防止路徑穿越
  const id = path.basename(cameraId);
  return path.join(RECORDINGS_DIR, id);
}

/** 列出某台攝影機有錄影的日期（新到舊） */
export function listDates(cameraId) {
  const dir = safeCameraDir(cameraId);
  if (!fs.existsSync(dir)) return [];
  const dates = new Set();
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(NAME_RE);
    if (m) dates.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return [...dates].sort().reverse();
}

/** 列出某台攝影機在指定日期的所有錄影片段（早到晚） */
export function listRecordings(cameraId, date) {
  const dir = safeCameraDir(cameraId);
  if (!fs.existsSync(dir)) return [];

  const items = [];
  for (const f of fs.readdirSync(dir)) {
    if (date && !f.startsWith(date)) continue;
    const start = parseStart(f);
    if (!start) continue;
    let size = 0;
    let mtime = start;
    try {
      const st = fs.statSync(path.join(dir, f));
      size = st.size;
      mtime = st.mtime;
    } catch {
      continue;
    }
    // 用最後寫入時間近似結束時間，估算長度
    const durationSec = Math.max(0, Math.round((mtime - start) / 1000));
    items.push({
      file: f,
      url: `/recordings/${encodeURIComponent(cameraId)}/${encodeURIComponent(f)}`,
      start: start.toISOString(),
      durationSec,
      size,
    });
  }
  items.sort((a, b) => a.start.localeCompare(b.start));
  return items;
}

/** 刪除超過保留天數的舊錄影 */
export function cleanup(retentionDays) {
  if (!retentionDays || retentionDays <= 0) return;
  if (!fs.existsSync(RECORDINGS_DIR)) return;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const camId of fs.readdirSync(RECORDINGS_DIR)) {
    const dir = path.join(RECORDINGS_DIR, camId);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const start = parseStart(f);
      if (!start) continue;
      if (start.getTime() < cutoff) {
        try {
          fs.unlinkSync(path.join(dir, f));
          deleted++;
        } catch {
          /* 忽略刪除失敗 */
        }
      }
    }
  }
  if (deleted > 0) console.log(`🗑️  已清理 ${deleted} 個過期錄影檔`);
}

/** 啟動定期清理（每小時一次），並立即先跑一次 */
export function startCleanupJob(retentionDays) {
  cleanup(retentionDays);
  return setInterval(() => cleanup(retentionDays), 60 * 60 * 1000);
}
