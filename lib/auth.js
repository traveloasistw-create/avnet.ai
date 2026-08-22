import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { USERS_PATH, DATA_DIR } from './config.js';

// ---- 密碼雜湊（用 Node 內建 scrypt，不需額外套件） ----------------------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- 使用者資料存取 -------------------------------------------------------
export function loadUsers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
    return parsed.users || [];
  } catch {
    return [];
  }
}

export function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify({ users }, null, 2), 'utf-8');
}

export function findUser(username) {
  return loadUsers().find((u) => u.username === username);
}

/** 第一次啟動若沒有任何使用者，自動建立一個管理員 admin / admin */
export function ensureAdmin() {
  const users = loadUsers();
  if (users.length > 0) return;
  const password = process.env.ADMIN_PASSWORD || 'admin';
  users.push({
    username: 'admin',
    password: hashPassword(password),
    isAdmin: true,
    cameras: '*', // 管理員看得到全部
  });
  saveUsers(users);
  console.log('\n========================================================');
  console.log('  已建立預設管理員帳號：');
  console.log('    帳號：admin');
  console.log(`    密碼：${password}`);
  console.log('  ⚠️  請登入後立刻到「管理」頁面修改密碼！');
  console.log('========================================================\n');
}

// ---- 權限判斷 -------------------------------------------------------------
/** 這個使用者被授權的攝影機 id 清單（管理員 = 全部） */
export function allowedCameraIds(user, allCameras) {
  const allIds = allCameras.map((c) => c.id);
  if (!user) return [];
  if (user.isAdmin || user.cameras === '*') return allIds;
  const set = new Set(user.cameras || []);
  return allIds.filter((id) => set.has(id));
}

export function canAccess(user, cameraId) {
  if (!user) return false;
  if (user.isAdmin || user.cameras === '*') return true;
  return Array.isArray(user.cameras) && user.cameras.includes(cameraId);
}

// ---- Session 金鑰（持久化，避免每次重啟就把大家登出） --------------------
export function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = path.join(DATA_DIR, '.session-secret');
  try {
    return fs.readFileSync(secretFile, 'utf-8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(secretFile, secret, 'utf-8');
    return secret;
  }
}

// ---- Express 中介層 -------------------------------------------------------
export function requireLogin(req, res, next) {
  if (req.session && req.session.username) return next();
  // API 請求回傳 401（讓前端自行導向登入）；一般頁面則直接導向登入頁
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: '未登入' });
  }
  return res.redirect('/login.html');
}

export function requireAdmin(req, res, next) {
  const user = req.session && findUser(req.session.username);
  if (user && user.isAdmin) return next();
  if (req.accepts('html')) return res.status(403).send('需要管理員權限');
  return res.status(403).json({ error: '需要管理員權限' });
}

/** 取得目前登入者的完整資料（每次即時讀，權限異動立即生效） */
export function currentUser(req) {
  if (!req.session || !req.session.username) return null;
  return findUser(req.session.username) || null;
}
