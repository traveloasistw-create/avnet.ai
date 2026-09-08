import express from 'express';
import cookieSession from 'cookie-session';
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
import { listDates, listRecordings, startCleanupJob } from './lib/recordings.js';
import { move as ptzMove, stop as ptzStop, reboot as ptzReboot } from './lib/ptz.js';
import { logAction, recentLogs } from './lib/audit.js';
import { loadNotify, saveNotify, sendTelegram, pushAlert } from './lib/notify.js';
import { MotionWatcher } from './lib/motion.js';
import {
  ensureAdmin,
  getSessionSecret,
  requireLogin,
  requireAdmin,
  currentUser,
  findUser,
  loadUsers,
  saveUsers,
  hashPassword,
  verifyPassword,
  allowedCameraIds,
  canAccess,
  usesDefaultPassword,
} from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

// ---- 載入設定並啟動串流 ----------------------------------------------------
const { recording, cameras } = loadConfig();

fs.rmSync(STREAMS_DIR, { recursive: true, force: true });
fs.mkdirSync(STREAMS_DIR, { recursive: true });
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

if (cameras.length === 0) {
  console.warn(
    '⚠️  沒有啟用中的攝影機。請複製 config/cameras.example.json 成 config/cameras.json 並填入你的攝影機資訊。'
  );
}

ensureAdmin(); // 第一次啟動建立預設管理員

const manager = new CameraManager(recording);
manager.load(cameras);

const cleanupTimer = recording.enabled
  ? startCleanupJob(recording.retentionDays)
  : null;

// ---- 移動偵測 → Telegram 推播 ----
const motion = new MotionWatcher((camera) => {
  const when = new Date().toLocaleString('zh-TW', { hour12: false });
  pushAlert(`⚠️ 偵測到動靜：${camera.name}\n時間：${when}`);
  logAction('系統', '移動偵測', camera.name);
});
function reconcileMotion() {
  for (const c of manager.list()) {
    if (c.enabled !== false && c.motion) motion.start(c);
    else motion.stop(c.id);
  }
}
reconcileMotion();

// 產生一個不重複的攝影機代號
function newCameraId() {
  let id;
  do {
    id = 'cam_' + Math.random().toString(36).slice(2, 8);
  } while (manager.get(id));
  return id;
}

// 由主串流網址推導子串流網址（喬安：結尾 _0 → _1），推不出來回傳 null
function deriveSub(url) {
  if (typeof url === 'string' && /_0(?=$|\?)/.test(url)) {
    return url.replace(/_0(?=$|\?)/, '_1');
  }
  return null;
}

// ---- 登入失敗保護：防止有人不斷猜密碼（暴力破解） ----
const loginFails = new Map(); // "IP|帳號" -> { count, until }
const MAX_FAILS = 5; // 連續錯 5 次
const LOCK_MS = 15 * 60 * 1000; // 鎖 15 分鐘

function loginKey(req, username) {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
  return `${ip}|${String(username || '').toLowerCase()}`;
}

// 還要鎖幾分鐘（0 = 沒被鎖）
function lockedMinutes(key) {
  const e = loginFails.get(key);
  if (!e || !e.until) return 0;
  if (e.until > Date.now()) return Math.ceil((e.until - Date.now()) / 60000);
  loginFails.delete(key); // 鎖定時間已過
  return 0;
}

function noteLoginFail(key) {
  const e = loginFails.get(key) || { count: 0, until: 0 };
  e.count += 1;
  if (e.count >= MAX_FAILS) {
    e.until = Date.now() + LOCK_MS;
    e.count = 0;
  }
  loginFails.set(key, e);
}

// ---- 在線狀態追蹤：誰在線上、正在看哪些相機 ----
const presence = new Map(); // username -> { lastSeen, cameras: Map<id, ts> }
const ONLINE_WINDOW_MS = 15000; // 15 秒內有活動就算在線

function touch(username, cameraId) {
  if (!username) return;
  let p = presence.get(username);
  if (!p) {
    p = { lastSeen: 0, cameras: new Map() };
    presence.set(username, p);
  }
  p.lastSeen = Date.now();
  if (cameraId) p.cameras.set(cameraId, Date.now());
}

// ---- Web 伺服器 ----------------------------------------------------------
const app = express();
app.use(express.json());
app.use(
  cookieSession({
    name: 'camwall',
    keys: [getSessionSecret()],
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
    httpOnly: true,
    sameSite: 'lax',
  })
);

// ---- 免登入即可存取的資源（登入頁本身、樣式、播放器函式庫） ----
app.get(['/login.html', '/login.js'], (req, res) =>
  res.sendFile(path.join(PUBLIC, path.basename(req.path)))
);
app.use('/style.css', express.static(path.join(PUBLIC, 'style.css')));
app.use(
  '/vendor/hls.js',
  express.static(path.join(__dirname, 'node_modules', 'hls.js', 'dist'))
);

// ---- 登入 / 登出 / 我是誰 ----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = loginKey(req, username);

  const wait = lockedMinutes(key);
  if (wait) {
    return res
      .status(429)
      .json({ error: `嘗試次數過多，請 ${wait} 分鐘後再試` });
  }

  const user = findUser(username);
  if (!user || !verifyPassword(password || '', user.password)) {
    noteLoginFail(key);
    logAction(String(username || '(空白)'), '登入失敗');
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }

  loginFails.delete(key); // 登入成功，清掉失敗紀錄
  req.session.username = user.username;
  logAction(user.username, '登入');
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  if (req.session && req.session.username) {
    logAction(req.session.username, '登出');
  }
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requireLogin, (req, res) => {
  const user = currentUser(req);
  res.json({
    username: user.username,
    isAdmin: !!user.isAdmin,
    weakPassword: usesDefaultPassword(user), // 還在用預設密碼 admin
  });
});

// ---- 此行以下全部需要登入 ----
app.use(requireLogin);

// 管理頁 / 攝影機管理頁（都需要管理員）
app.get('/admin.html', requireAdmin, (req, res) =>
  res.sendFile(path.join(PUBLIC, 'admin.html'))
);
app.get('/cameras.html', requireAdmin, (req, res) =>
  res.sendFile(path.join(PUBLIC, 'cameras.html'))
);

// 攝影機清單：只回傳這位使用者被授權且啟用中的
app.get('/api/cameras', (req, res) => {
  touch(req.session.username); // 標記此使用者在線（心跳）
  const user = currentUser(req);
  const enabled = manager.enabled();
  const allowed = new Set(allowedCameraIds(user, enabled));
  res.json(
    enabled
      .filter((c) => allowed.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: manager.status(c.id),
        record: recording.enabled && c.record !== false,
        hasSub: !!(c.subUrl || deriveSub(c.url)), // 有子串流才顯示畫質切換
        quality: c.useSub ? 'sub' : 'main',
        onDemand: !!c.onDemand, // 省電模式：需要點擊喚醒才連線
        src: `/streams/${c.id}/index.m3u8`,
      }))
  );
});

app.get('/api/recording-info', (req, res) => res.json(recording));

// 每台攝影機資源的授權檢查
function guardCamera(req, res, next) {
  const id = req.params.id || String(req.path).split('/').filter(Boolean)[0];
  if (!canAccess(currentUser(req), id)) {
    return res.status(403).json({ error: '沒有這支攝影機的權限' });
  }
  next();
}

// 畫質切換：主串流(超清) <-> 子串流(標清)
app.post('/api/cameras/:id/quality', requireAdmin, (req, res) => {
  const cam = manager.get(req.params.id);
  if (!cam) return res.status(404).json({ error: '找不到攝影機' });
  const subUrl = cam.subUrl || deriveSub(cam.url);
  if (!subUrl) return res.status(400).json({ error: '這支沒有子串流' });
  const useSub = req.body && req.body.sub === true;
  // 一併把推導出的子串流網址存起來，之後不必再推
  manager.update(cam.id, { subUrl, useSub });
  res.json({ ok: true, quality: useSub ? 'sub' : 'main' });
});

// 畫面移動（PTZ）：轉動支援 ONVIF 的相機；不支援的相機會回錯誤（前端忽略）
app.post('/api/ptz/:id', requireAdmin, async (req, res) => {
  const cam = manager.get(req.params.id);
  if (!cam) return res.status(404).json({ error: '找不到攝影機' });
  const action = req.body && req.body.action;
  try {
    if (action === 'stop') await ptzStop(cam);
    else await ptzMove(cam, action);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'PTZ 失敗' });
  }
});

// 重新啟動相機（ONVIF，僅管理員）
app.post('/api/admin/cameras/:id/reboot', requireAdmin, async (req, res) => {
  const cam = manager.get(req.params.id);
  if (!cam) return res.status(404).json({ error: '找不到攝影機' });
  try {
    await ptzReboot(cam);
    logAction(req.session.username, '重啟相機', cam.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || '重啟失敗（相機可能不支援）' });
  }
});

// ---- 通知設定（Telegram，僅管理員） ----
app.get('/api/admin/notify', requireAdmin, (req, res) => {
  const t = loadNotify().telegram;
  res.json({ token: t.token || '', chatId: t.chatId || '', enabled: !!t.enabled });
});
app.post('/api/admin/notify', requireAdmin, (req, res) => {
  const { token, chatId, enabled } = req.body || {};
  saveNotify({
    telegram: {
      token: String(token || '').trim(),
      chatId: String(chatId || '').trim(),
      enabled: !!enabled,
    },
  });
  logAction(req.session.username, '更新通知設定');
  res.json({ ok: true });
});
app.post('/api/admin/notify/test', requireAdmin, async (req, res) => {
  try {
    await sendTelegram('✅ 旅遊綠洲監視器：這是一則測試通知，設定成功！');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/recordings/:id/dates', guardCamera, (req, res) =>
  res.json(listDates(req.params.id))
);
app.get('/api/recordings/:id', guardCamera, (req, res) =>
  res.json(listRecordings(req.params.id, req.query.date))
);

// 即時快照
app.get('/api/snapshot/:id', requireAdmin, (req, res) => {
  const id = path.basename(req.params.id);
  const playlist = path.join(STREAMS_DIR, id, 'index.m3u8');
  if (!fs.existsSync(playlist)) return res.status(503).send('串流尚未就緒');
  const ff = spawn(FFMPEG, [
    '-nostdin', '-loglevel', 'error',
    '-i', playlist,
    '-frames:v', '1', '-q:v', '3', '-f', 'image2', 'pipe:1',
  ]);
  res.setHeader('Content-Type', 'image/jpeg');
  ff.stdout.pipe(res);
  ff.on('error', () => {
    if (!res.headersSent) res.status(500).end();
  });
  const killer = setTimeout(() => ff.kill('SIGKILL'), 8000);
  ff.on('exit', () => clearTimeout(killer));
});

// 串流檔與錄影檔：先過授權檢查，再交給靜態服務
// 記錄「這位使用者正在看這支相機」（瀏覽器會持續抓該相機的串流片段）
app.use('/streams', guardCamera, (req, res, next) => {
  const id = String(req.path).split('/').filter(Boolean)[0];
  touch(req.session.username, id);
  manager.onStreamAccess(id); // 省電模式：有人在看就保持喚醒
  next();
});
app.use('/streams', express.static(STREAMS_DIR));
app.use('/recordings', guardCamera, express.static(RECORDINGS_DIR));

// ---- 管理員 API：攝影機 ----
// 回傳完整清單（含網址、啟用/錄影狀態）供管理頁編輯
app.get('/api/admin/cameras', requireAdmin, (req, res) =>
  res.json(
    manager.list().map((c) => ({
      id: c.id,
      name: c.name,
      url: c.url,
      enabled: c.enabled !== false,
      record: c.record !== false,
      motion: !!c.motion,
      onDemand: !!c.onDemand,
      status: manager.status(c.id),
    }))
  )
);

app.post('/api/admin/cameras', requireAdmin, (req, res) => {
  const { name, url, enabled, record, motion: mo, onDemand } = req.body || {};
  if (!name || !url) {
    return res.status(400).json({ error: '名稱與 RTSP 網址為必填' });
  }
  try {
    const cam = manager.add({
      id: newCameraId(),
      name,
      url,
      subUrl: deriveSub(url) || undefined,
      enabled: enabled !== false,
      record: record !== false,
      motion: !!mo,
      onDemand: !!onDemand,
    });
    logAction(req.session.username, '新增攝影機', name);
    reconcileMotion();
    res.json({ ok: true, id: cam.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/cameras/:id', requireAdmin, (req, res) => {
  const { name, url, enabled, record, motion: mo, onDemand } = req.body || {};
  const patch = {};
  if (typeof name === 'string') patch.name = name;
  if (typeof url === 'string' && url) patch.url = url;
  if (typeof enabled === 'boolean') patch.enabled = enabled;
  if (typeof record === 'boolean') patch.record = record;
  if (typeof mo === 'boolean') patch.motion = mo;
  if (typeof onDemand === 'boolean') patch.onDemand = onDemand;
  const ok = manager.update(req.params.id, patch);
  if (!ok) return res.status(404).json({ error: '找不到攝影機' });
  logAction(req.session.username, '修改攝影機', patch.name || req.params.id);
  reconcileMotion();
  res.json({ ok: true });
});

app.delete('/api/admin/cameras/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const cam = manager.get(id);
  const name = cam ? cam.name : id;
  const ok = manager.remove(id);
  if (!ok) return res.status(404).json({ error: '找不到攝影機' });
  motion.stop(id);
  logAction(req.session.username, '刪除攝影機', name);
  // 一併從所有使用者的授權清單移除這支攝影機
  const users = loadUsers();
  let changed = false;
  for (const u of users) {
    if (Array.isArray(u.cameras) && u.cameras.includes(id)) {
      u.cameras = u.cameras.filter((c) => c !== id);
      changed = true;
    }
  }
  if (changed) saveUsers(users);
  res.json({ ok: true });
});

// ---- 管理員 API：使用者 ----

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(
    loadUsers().map((u) => ({
      username: u.username,
      isAdmin: !!u.isAdmin,
      cameras: u.cameras === '*' ? '*' : u.cameras || [],
    }))
  );
});

// 目前在線的使用者，以及各自正在觀看哪些相機
app.get('/api/admin/online', requireAdmin, (req, res) => {
  const now = Date.now();
  const online = [];
  for (const [username, p] of presence) {
    if (now - p.lastSeen > ONLINE_WINDOW_MS) continue;
    const cams = [];
    for (const [cid, ts] of p.cameras) {
      if (now - ts <= ONLINE_WINDOW_MS) {
        const cam = manager.get(cid);
        cams.push(cam ? cam.name : cid);
      }
    }
    online.push({ username, cameras: cams });
  }
  online.sort((a, b) => a.username.localeCompare(b.username));
  res.json(online);
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, isAdmin, cameras: cams } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '帳號與密碼為必填' });
  }
  const users = loadUsers();
  if (users.some((u) => u.username === username)) {
    return res.status(409).json({ error: '帳號已存在' });
  }
  users.push({
    username,
    password: hashPassword(password),
    isAdmin: !!isAdmin,
    cameras: isAdmin ? '*' : Array.isArray(cams) ? cams : [],
  });
  saveUsers(users);
  logAction(req.session.username, '新增帳號', username);
  res.json({ ok: true });
});

app.put('/api/admin/users/:username', requireAdmin, (req, res) => {
  const { password, isAdmin, cameras: cams } = req.body || {};
  const users = loadUsers();
  const u = users.find((x) => x.username === req.params.username);
  if (!u) return res.status(404).json({ error: '找不到使用者' });
  if (password) u.password = hashPassword(password);
  if (typeof isAdmin === 'boolean') u.isAdmin = isAdmin;
  if (u.isAdmin) u.cameras = '*';
  else if (Array.isArray(cams)) u.cameras = cams;
  saveUsers(users);
  logAction(
    req.session.username,
    password ? '重設密碼' : '修改帳號權限',
    req.params.username
  );
  res.json({ ok: true });
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const me = currentUser(req);
  if (me.username === req.params.username) {
    return res.status(400).json({ error: '不能刪除自己' });
  }
  const users = loadUsers().filter((u) => u.username !== req.params.username);
  saveUsers(users);
  logAction(req.session.username, '刪除帳號', req.params.username);
  res.json({ ok: true });
});

// 操作日誌（最近 100 筆）
app.get('/api/admin/logs', requireAdmin, (req, res) => res.json(recentLogs(100)));

// 主機硬碟空間
app.get('/api/admin/disk', requireAdmin, (req, res) => {
  fs.statfs(RECORDINGS_DIR, (err, s) => {
    if (err) return res.json({ ok: false });
    const total = s.blocks * s.bsize;
    const free = s.bfree * s.bsize;
    res.json({ ok: true, total, free, used: total - free });
  });
});

// ---- 其餘前端頁面（需登入） ----
app.use(express.static(PUBLIC));

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
  motion.stopAll();
  manager.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
