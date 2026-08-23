// 監視器看板前端：抓取攝影機清單，為每台建立播放器，並用 hls.js 播 HLS 串流。

const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const colsSelect = document.getElementById('colsSelect');
const fullscreenBtn = document.getElementById('fullscreenBtn');

const players = new Map(); // id -> { hls, video, tile }

let draggedTile = null; // 目前被拖曳的攝影機格
const ORDER_KEY = 'camwall.order';

// 儲存目前畫面上的排列順序（記在這台瀏覽器，下次打開位置不變）
function saveOrder() {
  try {
    const ids = [...grid.querySelectorAll('.tile')].map((t) => t.dataset.id);
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* 無法儲存就算了 */
  }
}

// 依上次儲存的順序排列攝影機；新加入、沒記錄的排最後
function applySavedOrder(cameras) {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]');
    if (!Array.isArray(saved) || saved.length === 0) return cameras;
    const byId = new Map(cameras.map((c) => [c.id, c]));
    const ordered = [];
    for (const id of saved) {
      if (byId.has(id)) {
        ordered.push(byId.get(id));
        byId.delete(id);
      }
    }
    for (const c of byId.values()) ordered.push(c);
    return ordered;
  } catch {
    return cameras;
  }
}

async function fetchCameras() {
  try {
    const res = await fetch('/api/cameras');
    if (res.status === 401) {
      window.location.href = '/login.html';
      return [];
    }
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (err) {
    console.error('無法取得攝影機清單', err);
    return [];
  }
}

// 顯示登入者、管理員才看得到「管理」分頁、綁定登出
async function setupUserBar() {
  try {
    const res = await fetch('/api/me');
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    const me = await res.json();
    const label = document.getElementById('userLabel');
    if (label) label.textContent = `👤 ${me.username}`;
    if (me.isAdmin) document.getElementById('adminTab')?.classList.remove('hidden');
    // 中央錄影關閉時，隱藏「回放」分頁
    const info = await fetch('/api/recording-info').then((r) => r.json());
    if (!info.enabled) document.getElementById('playbackTab')?.classList.add('hidden');
  } catch {
    /* 忽略 */
  }
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

function createTile(cam) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.id = cam.id;

  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  const label = document.createElement('div');
  label.className = 'label';
  label.innerHTML = `<span class="dot ${cam.status}"></span><span>${cam.name}</span>`;

  const actions = document.createElement('div');
  actions.className = 'tile-actions';

  const snapBtn = document.createElement('button');
  snapBtn.className = 'tile-btn';
  snapBtn.textContent = '📸';
  snapBtn.title = '擷取快照';
  snapBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open(`/api/snapshot/${encodeURIComponent(cam.id)}`, '_blank');
  });

  // 當下錄影，直接存到「你正在用的這台電腦」
  const recBtn = document.createElement('button');
  recBtn.className = 'tile-btn';
  recBtn.textContent = '⏺';
  recBtn.title = '錄影到我的電腦';
  let recorder = null;
  let chunks = [];
  recBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    let stream;
    try {
      stream = video.captureStream
        ? video.captureStream()
        : video.mozCaptureStream?.();
    } catch {
      stream = null;
    }
    if (!stream) {
      alert('無法擷取畫面，請等畫面開始播放後再試（建議用 Chrome 瀏覽器）。');
      return;
    }
    chunks = [];
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `${cam.id}_${ts}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      recBtn.classList.remove('recording');
      recBtn.textContent = '⏺';
      recBtn.title = '錄影到我的電腦';
    };
    recorder.start();
    recBtn.classList.add('recording');
    recBtn.textContent = '⏹';
    recBtn.title = '停止並存檔';
  });

  const expand = document.createElement('button');
  expand.className = 'tile-btn';
  expand.textContent = '⛶';
  expand.title = '放大';
  expand.addEventListener('click', (e) => {
    e.stopPropagation();
    tile.classList.toggle('zoomed');
  });

  // 拖曳把手：可拖動這一格來排列位置
  const drag = document.createElement('button');
  drag.className = 'tile-btn drag-handle';
  drag.textContent = '⠿';
  drag.title = '拖曳排列位置';
  drag.draggable = true;
  drag.addEventListener('click', (e) => e.stopPropagation());
  drag.addEventListener('dragstart', (e) => {
    draggedTile = tile;
    tile.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', cam.id);
      e.dataTransfer.setDragImage(tile, 30, 20);
    } catch {
      /* 忽略 */
    }
  });
  drag.addEventListener('dragend', () => {
    tile.classList.remove('dragging');
    draggedTile = null;
    saveOrder();
  });

  // 拖曳經過這一格時，依左右半邊決定插在它前面或後面
  tile.addEventListener('dragover', (e) => {
    if (!draggedTile || tile === draggedTile) return;
    e.preventDefault();
    const box = tile.getBoundingClientRect();
    const before = e.clientX < box.left + box.width / 2;
    grid.insertBefore(draggedTile, before ? tile : tile.nextSibling);
  });

  actions.append(drag, snapBtn, recBtn, expand);

  // 點畫面也能切換放大
  tile.addEventListener('click', () => tile.classList.toggle('zoomed'));

  tile.append(video, label, actions);
  grid.appendChild(tile);

  attachStream(cam, video, tile);
  players.set(cam.id, { video, tile });
}

function showState(tile, msg) {
  let el = tile.querySelector('.state-msg');
  if (!el) {
    el = document.createElement('div');
    el.className = 'state-msg';
    tile.appendChild(el);
  }
  el.textContent = msg;
}

function clearState(tile) {
  tile.querySelector('.state-msg')?.remove();
}

function attachStream(cam, video, tile) {
  showState(tile, '連線中…');

  if (window.Hls && window.Hls.isSupported()) {
    const hls = new Hls({
      liveSyncDurationCount: 2, // 盡量貼近即時
      maxBufferLength: 8,
      manifestLoadingMaxRetry: Infinity,
      manifestLoadingRetryDelay: 3000,
      levelLoadingMaxRetry: Infinity,
    });
    hls.loadSource(cam.src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      clearState(tile);
    });
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            showState(tile, '等待串流…');
            setTimeout(() => hls.startLoad(), 3000);
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            showState(tile, '串流錯誤');
            break;
        }
      }
    });
    const rec = players.get(cam.id);
    if (rec) rec.hls = hls;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari 原生支援 HLS
    video.src = cam.src;
    video.addEventListener('loadedmetadata', () => {
      video.play().catch(() => {});
      clearState(tile);
    });
    video.addEventListener('error', () => showState(tile, '等待串流…'));
  } else {
    showState(tile, '此瀏覽器不支援 HLS');
  }
}

async function init() {
  await setupUserBar();
  const cameras = await fetchCameras();
  if (cameras.length === 0) {
    grid.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  applySavedOrder(cameras).forEach(createTile);
  pollStatus();
}

// 定時更新每台攝影機的狀態燈號
async function pollStatus() {
  setInterval(async () => {
    const cameras = await fetchCameras();
    for (const cam of cameras) {
      const rec = players.get(cam.id);
      if (!rec) continue;
      const dot = rec.tile.querySelector('.dot');
      if (dot) dot.className = `dot ${cam.status}`;
    }
  }, 5000);
}

// ---- 控制項 ----
colsSelect.addEventListener('change', () => {
  const v = colsSelect.value;
  if (v === 'auto') grid.removeAttribute('data-cols');
  else grid.dataset.cols = v;
});

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});

// 按 Esc 取消放大檢視
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelector('.tile.zoomed')?.classList.remove('zoomed');
  }
});

init();
