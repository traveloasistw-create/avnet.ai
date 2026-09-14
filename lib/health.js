import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { STREAMS_DIR, RECORDINGS_DIR, DATA_DIR } from './config.js';

// ---- CPU 使用率：靠兩次取樣的差值算出來（os.loadavg 在 Windows 無效） ----
let lastSample = null;

function cpuSnapshot() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

/** 兩次呼叫之間的平均 CPU 使用率（%）。第一次呼叫回傳 null */
function cpuPercent() {
  const now = cpuSnapshot();
  if (!lastSample) {
    lastSample = now;
    return null;
  }
  const idleDiff = now.idle - lastSample.idle;
  const totalDiff = now.total - lastSample.total;
  lastSample = now;
  if (totalDiff <= 0) return null;
  return Math.round((1 - idleDiff / totalDiff) * 100);
}

// 每 3 秒在背景取樣一次，確保隨時都有最新的數字可回報
const sampler = setInterval(cpuPercent, 3000);
if (sampler.unref) sampler.unref();

/** 算出一個資料夾的大小與檔案數（只看一層子資料夾，夠用且快） */
function dirStats(root) {
  let bytes = 0;
  let files = 0;
  try {
    for (const sub of fs.readdirSync(root)) {
      const p = path.join(root, sub);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        try {
          for (const f of fs.readdirSync(p)) {
            try {
              bytes += fs.statSync(path.join(p, f)).size;
              files += 1;
            } catch {
              /* 忽略 */
            }
          }
        } catch {
          /* 忽略 */
        }
      } else {
        bytes += st.size;
        files += 1;
      }
    }
  } catch {
    /* 資料夾不存在 */
  }
  return { bytes, files };
}

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * 系統健康狀況：CPU、記憶體、執行時間、串流檔案量、
 * 以及每台攝影機目前的狀態。
 */
export function health(manager) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  const cams = manager.list();
  const byStatus = { running: 0, starting: 0, stopped: 0, error: 0, sleeping: 0 };
  const perCamera = [];
  for (const c of cams) {
    if (c.enabled === false) continue;
    let st = manager.status(c.id);
    // 省電模式且沒在跑 = 休眠中，不算異常
    if (c.onDemand && st === 'unknown') st = 'sleeping';
    if (byStatus[st] === undefined) byStatus[st] = 0;
    byStatus[st] += 1;
    perCamera.push({ id: c.id, name: c.name, status: st, onDemand: !!c.onDemand });
  }

  return {
    cpuPercent: cpuPercent(),
    cpuCount: os.cpus().length,
    memTotal: totalMem,
    memUsed: totalMem - freeMem,
    memProcess: process.memoryUsage().rss, // 我們這支程式自己佔的記憶體
    uptimeSec: Math.round(process.uptime()), // 系統已經跑多久沒重開
    osUptimeSec: Math.round(os.uptime()),
    streams: dirStats(STREAMS_DIR),
    recordings: dirStats(RECORDINGS_DIR),
    auditLogBytes: fileSize(path.join(DATA_DIR, 'audit.log')),
    cameraCount: perCamera.length,
    byStatus,
    perCamera,
  };
}
