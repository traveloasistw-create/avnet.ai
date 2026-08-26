import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { DATA_DIR } from './config.js';

const NOTIFY_PATH = path.join(DATA_DIR, 'notify.json');

export function loadNotify() {
  try {
    const cfg = JSON.parse(fs.readFileSync(NOTIFY_PATH, 'utf-8'));
    return { telegram: { token: '', chatId: '', enabled: false, ...cfg.telegram } };
  } catch {
    return { telegram: { token: '', chatId: '', enabled: false } };
  }
}

export function saveNotify(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(NOTIFY_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

// 透過 Telegram Bot 送訊息
export function sendTelegram(text) {
  const t = loadNotify().telegram || {};
  if (!t.token || !t.chatId) {
    return Promise.reject(new Error('尚未設定 Telegram Bot Token 或 Chat ID'));
  }
  const body = JSON.stringify({ chat_id: t.chatId, text });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${t.token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 8000,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Telegram 回應 ${res.statusCode}: ${d}`));
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('連線逾時')));
    req.write(body);
    req.end();
  });
}

// 只有在啟用且設定完整時才實際發送（給偵測用）
export function pushAlert(text) {
  const t = loadNotify().telegram || {};
  if (!t.enabled || !t.token || !t.chatId) return;
  sendTelegram(text).catch((e) => console.error('推播失敗:', e.message));
}
