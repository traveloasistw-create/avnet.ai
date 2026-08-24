import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const LOG_PATH = path.join(DATA_DIR, 'audit.log');
const MAX_RETURN = 200;

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
