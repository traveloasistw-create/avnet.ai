// 監視器看板前端：抓取攝影機清單，為每台建立播放器，並用 hls.js 播 HLS 串流。

const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const layoutSelect = document.getElementById('layoutSelect');
const fullscreenBtn = document.getElementById('fullscreenBtn');

const players = new Map(); // id -> { hls, video, tile }

let draggedTile = null; // 目前被拖曳的攝影機格
let isAdmin = false; // 是否為主管理員（決定能否用截圖/錄影/畫質/轉動）
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
    isAdmin = !!me.isAdmin;
    const label = document.getElementById('userLabel');
    if (label) label.textContent = `👤 ${me.username}`;
    if (me.isAdmin) {
      document.getElementById('adminTab')?.classList.remove('hidden');
      document.getElementById('camMgmtTab')?.classList.remove('hidden');
      startOnlineCount(); // 管理員才顯示目前上線人數
    }
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

// 目前上線人數（僅管理員可見，含管理員自己，每 5 秒更新）
function startOnlineCount() {
  const badge = document.getElementById('onlineCountBadge');
  if (!badge) return;
  async function update() {
    try {
      const res = await fetch('/api/admin/online');
      if (!res.ok) return;
      const data = await res.json();
      badge.textContent = `🟢 線上 ${data.length} 人`;
      badge.classList.remove('hidden');
    } catch {
      /* 忽略 */
    }
  }
  update();
  setInterval(update, 5000);
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

  // 暫停 / 播放這一格的即時畫面
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'tile-btn';
  pauseBtn.textContent = '⏸';
  pauseBtn.title = '暫停';
  pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video.paused) {
      video.play().catch(() => {});
      pauseBtn.textContent = '⏸';
      pauseBtn.title = '暫停';
    } else {
      video.pause();
      pauseBtn.textContent = '▶';
      pauseBtn.title = '播放';
    }
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

  // 畫質切換：超清(主串流) <-> 標清(子串流)
  let curQuality = cam.quality || 'main';
  const qualBtn = document.createElement('button');
  qualBtn.className = 'tile-btn qual-btn';
  qualBtn.textContent = curQuality === 'sub' ? '標清' : '超清';
  qualBtn.title = '切換畫質';
  if (!cam.hasSub) qualBtn.style.display = 'none';
  qualBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const toSub = curQuality !== 'sub';
    qualBtn.disabled = true;
    qualBtn.textContent = '…';
    try {
      const res = await fetch(
        `/api/cameras/${encodeURIComponent(cam.id)}/quality`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sub: toSub }),
        }
      );
      if (res.ok) {
        const d = await res.json();
        curQuality = d.quality;
        showState(tile, '切換畫質中…');
        setTimeout(() => reattach(cam.id), 2500);
      }
    } catch {
      /* 忽略 */
    }
    qualBtn.textContent = curQuality === 'sub' ? '標清' : '超清';
    qualBtn.disabled = false;
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

  // 一般帳號：只能拖移、暫停、放大；截圖/畫質/錄影/轉動僅主管理員
  const btns = [drag];
  if (isAdmin) btns.push(snapBtn, qualBtn);
  btns.push(pauseBtn);
  if (isAdmin) btns.push(recBtn);
  btns.push(expand);
  actions.append(...btns);

  // 點畫面也能切換放大
  tile.addEventListener('click', () => tile.classList.toggle('zoomed'));

  tile.append(video, label, actions);

  // 畫面移動（PTZ）控制盤：僅主管理員，且放大檢視時才出現
  if (isAdmin) {
    const ptz = document.createElement('div');
    ptz.className = 'ptz';
    ptz.innerHTML = `
      <button data-a="up" title="上">▲</button>
      <div class="ptz-mid">
        <button data-a="left" title="左">◀</button>
        <button data-a="zoomin" title="放大">＋</button>
        <button data-a="zoomout" title="縮小">－</button>
        <button data-a="right" title="右">▶</button>
      </div>
      <button data-a="down" title="下">▼</button>
    `;
    ptz.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      fetch(`/api/ptz/${encodeURIComponent(cam.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: b.dataset.a }),
      }).catch(() => {});
    });
    tile.append(ptz);
  }

  grid.appendChild(tile);

  const entry = { video, tile, onDemand: !!cam.onDemand, awake: false };
  players.set(cam.id, entry);

  if (cam.onDemand) {
    // 省電模式：平時不連線，等使用者點「喚醒」才開始看，點「關閉」就休眠
    const initDot = tile.querySelector('.dot');
    if (initDot) initDot.className = 'dot sleeping';
    const wake = document.createElement('div');
    wake.className = 'wake-overlay';
    wake.innerHTML =
      '<div class="wake-box">' +
      '<div class="wake-icon">🔋</div>' +
      '<button class="wake-btn" type="button">▶ 喚醒查看</button>' +
      '<div class="wake-hint">省電模式：平時不連線、不耗電</div>' +
      '</div>';

    const sleepBtn = document.createElement('button');
    sleepBtn.className = 'sleep-btn hidden';
    sleepBtn.type = 'button';
    sleepBtn.textContent = '💤 關閉休眠';
    sleepBtn.title = '關閉並休眠（省電）';

    function goAwake() {
      entry.awake = true;
      wake.classList.add('hidden');
      sleepBtn.classList.remove('hidden');
      attachStream(cam, video, tile);
    }
    function goSleep() {
      entry.awake = false;
      if (entry.hls) {
        try {
          entry.hls.destroy();
        } catch {
          /* 忽略 */
        }
        entry.hls = null;
      }
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        /* 忽略 */
      }
      clearState(tile);
      sleepBtn.classList.add('hidden');
      wake.classList.remove('hidden');
    }

    wake.addEventListener('click', (e) => e.stopPropagation());
    wake.querySelector('.wake-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      goAwake();
    });
    sleepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goSleep();
    });

    tile.append(wake, sleepBtn);
  } else {
    attachStream(cam, video, tile);
  }
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

// 重新連線某台的串流（畫質切換後，等 server 重啟串流再重載）
function reattach(id) {
  const rec = players.get(id);
  if (!rec) return;
  if (rec.hls) {
    try {
      rec.hls.destroy();
    } catch {
      /* 忽略 */
    }
    rec.hls = null;
  }
  attachStream({ id, src: `/streams/${id}/index.m3u8` }, rec.video, rec.tile);
}

function attachStream(cam, video, tile) {
  showState(tile, '連線中…');

  if (window.Hls && window.Hls.isSupported()) {
    const hls = new Hls({
      lowLatencyMode: true, // 低延遲模式
      liveSyncDurationCount: 2, // 只落後 2 段（約 2 秒）就播，盡量貼近即時
      liveMaxLatencyDurationCount: 6, // 落後太多就跳回即時
      maxLiveSyncPlaybackRate: 1.5, // 落後時自動小幅加速追上
      maxBufferLength: 4,
      backBufferLength: 4,
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
  restoreLayout();
  pollStatus();
}

// 定時更新每台攝影機的狀態燈號 + 離線警示
async function pollStatus() {
  setInterval(async () => {
    const cameras = await fetchCameras();
    let offline = 0;
    for (const cam of cameras) {
      const rec = players.get(cam.id);
      if (!rec) continue;
      // 省電模式且休眠中：不算離線，燈號顯示休眠中
      if (rec.onDemand && !rec.awake) {
        const dot = rec.tile.querySelector('.dot');
        if (dot) dot.className = 'dot sleeping';
        rec.tile.classList.remove('offline');
        continue;
      }
      const dot = rec.tile.querySelector('.dot');
      if (dot) dot.className = `dot ${cam.status}`;
      if (cam.status === 'error' || cam.status === 'stopped') {
        offline++;
        rec.tile.classList.add('offline');
      } else {
        rec.tile.classList.remove('offline');
      }
    }
    const alertEl = document.getElementById('offlineAlert');
    if (alertEl) {
      if (offline > 0) {
        alertEl.textContent = `⚠️ ${offline} 支離線`;
        alertEl.classList.remove('hidden');
      } else {
        alertEl.classList.add('hidden');
      }
    }
  }, 5000);
}

// ---- 版面切換 ----
const LAYOUT_KEY = 'camwall.layout';
let seqTimer = null;
let seqIndex = 0;
const SEQ_SIZE = 4; // 輪播一次顯示幾格
const SEQ_INTERVAL = 10000; // 每 10 秒換一批

function showSeqBatch() {
  const tiles = [...grid.querySelectorAll('.tile')];
  if (tiles.length === 0) return;
  tiles.forEach((t) => t.classList.remove('seq-on'));
  const n = Math.min(SEQ_SIZE, tiles.length);
  for (let i = 0; i < n; i++) {
    tiles[(seqIndex + i) % tiles.length].classList.add('seq-on');
  }
  seqIndex = (seqIndex + n) % tiles.length;
}
function startSequence() {
  stopSequence();
  seqIndex = 0;
  showSeqBatch();
  seqTimer = setInterval(showSeqBatch, SEQ_INTERVAL);
}
function stopSequence() {
  if (seqTimer) clearInterval(seqTimer);
  seqTimer = null;
  grid.querySelectorAll('.seq-on').forEach((t) => t.classList.remove('seq-on'));
}

function applyLayout(name) {
  grid.dataset.layout = name;
  try {
    localStorage.setItem(LAYOUT_KEY, name);
  } catch {
    /* 忽略 */
  }
  if (name === 'sequence') startSequence();
  else stopSequence();
}

layoutSelect.addEventListener('change', () => applyLayout(layoutSelect.value));

// 套用上次選的版面
function restoreLayout() {
  let name = 'auto';
  try {
    name = localStorage.getItem(LAYOUT_KEY) || 'auto';
  } catch {
    /* 忽略 */
  }
  layoutSelect.value = name;
  applyLayout(name);
}

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
