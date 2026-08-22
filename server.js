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

// 產生一個不重複的攝影機代號
function newCameraId() {
  let id;
  do {
    id = 'cam_' + Math.random().toString(36).slice(2, 8);
  } while (manager.get(id));
  return id;
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
  const user = findUser(username);
  if (!user || !verifyPassword(password || '', user.password)) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  req.session.username = user.username;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requireLogin, (req, res) => {
  const user = currentUser(req);
  res.json({ username: user.username, isAdmin: !!user.isAdmin });
});

// ---- 此行以下全部需要登入 ----
app.use(requireLogin);

// 管理頁（需要管理員）
app.get('/admin.html', requireAdmin, (req, res) =>
  res.sendFile(path.join(PUBLIC, 'admin.html'))
);

// 攝影機清單：只回傳這位使用者被授權且啟用中的
app.get('/api/cameras', (req, res) => {
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

app.get('/api/recordings/:id/dates', guardCamera, (req, res) =>
  res.json(listDates(req.params.id))
);
app.get('/api/recordings/:id', guardCamera, (req, res) =>
  res.json(listRecordings(req.params.id, req.query.date))
);

// 即時快照
app.get('/api/snapshot/:id', guardCamera, (req, res) => {
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
app.use('/streams', guardCamera, express.static(STREAMS_DIR));
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
      status: manager.status(c.id),
    }))
  )
);

app.post('/api/admin/cameras', requireAdmin, (req, res) => {
  const { name, url, enabled, record } = req.body || {};
  if (!name || !url) {
    return res.status(400).json({ error: '名稱與 RTSP 網址為必填' });
  }
  try {
    const cam = manager.add({
      id: newCameraId(),
      name,
      url,
      enabled: enabled !== false,
      record: record !== false,
    });
    res.json({ ok: true, id: cam.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/cameras/:id', requireAdmin, (req, res) => {
  const { name, url, enabled, record } = req.body || {};
  const patch = {};
  if (typeof name === 'string') patch.name = name;
  if (typeof url === 'string' && url) patch.url = url;
  if (typeof enabled === 'boolean') patch.enabled = enabled;
  if (typeof record === 'boolean') patch.record = record;
  const ok = manager.update(req.params.id, patch);
  if (!ok) return res.status(404).json({ error: '找不到攝影機' });
  res.json({ ok: true });
});

app.delete('/api/admin/cameras/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const ok = manager.remove(id);
  if (!ok) return res.status(404).json({ error: '找不到攝影機' });
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
  res.json({ ok: true });
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const me = currentUser(req);
  if (me.username === req.params.username) {
    return res.status(400).json({ error: '不能刪除自己' });
  }
  const users = loadUsers().filter((u) => u.username !== req.params.username);
  saveUsers(users);
  res.json({ ok: true });
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
  manager.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
