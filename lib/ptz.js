import onvif from 'onvif';

const { Cam } = onvif;

// 已連線的相機（id -> Cam），與最近失敗過的相機（避免每次都慢慢重試）
const cache = new Map();
const failed = new Map(); // id -> 時間戳
const FAIL_RETRY_MS = 60000;

// 常見的 ONVIF 連接埠（喬安/小廠相機多為 8899）
const PORTS = [8899, 80, 8000, 2020, 8080];
const SPEED = 0.6;
const AUTO_STOP_MS = 800; // 點一下＝小幅移動後自動停

// 從 RTSP 網址解析出 帳號 / 密碼 / 主機
function parseUrl(url) {
  const m = String(url).match(/^rtsps?:\/\/(?:([^:@/]+):([^@/]+)@)?([^:/]+)/i);
  if (!m) return null;
  return { username: m[1] || 'admin', password: m[2] || '', host: m[3] };
}

function connect(host, username, password, port) {
  return new Promise((resolve, reject) => {
    const cam = new Cam(
      { hostname: host, username, password, port, timeout: 2500 },
      (err) => (err ? reject(err) : resolve(cam))
    );
  });
}

async function getCam(camera) {
  if (cache.has(camera.id)) return cache.get(camera.id);

  const last = failed.get(camera.id);
  if (last && Date.now() - last < FAIL_RETRY_MS) {
    throw new Error('這支相機不支援轉動（或無法連線）');
  }

  const p = parseUrl(camera.url);
  if (!p) throw new Error('無法解析相機網址');

  let lastErr;
  for (const port of PORTS) {
    try {
      const cam = await connect(p.host, p.username, p.password, port);
      cache.set(camera.id, cam);
      failed.delete(camera.id);
      return cam;
    } catch (err) {
      lastErr = err;
    }
  }
  failed.set(camera.id, Date.now());
  throw lastErr || new Error('無法連線 ONVIF');
}

export async function move(camera, direction) {
  const cam = await getCam(camera);
  const v = { x: 0, y: 0, zoom: 0 };
  if (direction === 'left') v.x = -SPEED;
  else if (direction === 'right') v.x = SPEED;
  else if (direction === 'up') v.y = SPEED;
  else if (direction === 'down') v.y = -SPEED;
  else if (direction === 'zoomin') v.zoom = SPEED;
  else if (direction === 'zoomout') v.zoom = -SPEED;
  else throw new Error('方向不正確');

  await new Promise((resolve, reject) => {
    cam.continuousMove(v, (err) => (err ? reject(err) : resolve()));
  });
  setTimeout(() => {
    try {
      cam.stop({ panTilt: true, zoom: true }, () => {});
    } catch {
      /* 忽略 */
    }
  }, AUTO_STOP_MS);
}

export async function stop(camera) {
  const cam = cache.get(camera.id);
  if (!cam) return;
  await new Promise((resolve) => {
    try {
      cam.stop({ panTilt: true, zoom: true }, () => resolve());
    } catch {
      resolve();
    }
  });
}

// 透過 ONVIF 重新啟動相機
export async function reboot(camera) {
  const cam = await getCam(camera);
  return new Promise((resolve, reject) => {
    try {
      cam.systemReboot((err, msg) => (err ? reject(err) : resolve(msg)));
    } catch (e) {
      reject(e);
    }
  });
}
