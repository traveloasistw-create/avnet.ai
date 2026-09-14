import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const LOG_PATH = path.join(DATA_DIR, 'audit.log');
const MAX_RETURN = 200;

// 日誌檔上限：超過就只保留最近的部分，避免長期執行後檔案無限長大
const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2 MB
const KEEP_LINES = 2000; // 修剪後保留最近幾筆
let sinceCheck = 0; // 每寫入 200 筆才檢查一次大小（省得每次都 stat）

function trimIfTooBig() {
  try {
    if (fs.statSync(LOG_PATH).size <= MAX_LOG_BYTES) return;
    const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    const kept = lines.slice(-KEEP_LINES).join('\n') + '\n';
    fs.writeFileSync(LOG_PATH, kept, 'utf-8');
    console.log(`🗂️  操作日誌過大，已修剪為最近 ${KEEP_LINES} 筆`);
  } catch {
    /* 修剪失敗不影響主功能 */
  }
}

// 記錄一筆操作（登入、加/刪相機、加/刪帳號…）
export function logAction(username, action, detail) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const entry = JSON.stringify({
      t: Date.now(),
      user: username || '-',
      action,
      detail: detail || '',
    });
    fs.appendFileSync(LOG_PATH, entry + '\n', 'utf-8');
    if (++sinceCheck >= 200) {
      sinceCheck = 0;
      trimIfTooBig();
    }
  } catch {
    /* 記錄失敗不影響主功能 */
  }
}

// 取最近的操作紀錄（新到舊）
export function recentLogs(limit = 100) {
  try {
    const lines = fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    return lines
      .slice(-Math.min(limit, MAX_RETURN))
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}
