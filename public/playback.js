// 回放頁：選攝影機 → 選日期 → 列出片段 → 播放 / 下載。

const cameraSelect = document.getElementById('cameraSelect');
const dateSelect = document.getElementById('dateSelect');
const clipList = document.getElementById('clipList');
const player = document.getElementById('player');
const nowPlaying = document.getElementById('nowPlaying');
const downloadLink = document.getElementById('downloadLink');

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-TW', { hour12: false });
}

function fmtDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${String(s).padStart(2, '0')}秒`;
}

function fmtSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

async function loadCameras() {
  const cams = await getJSON('/api/cameras');
  const recordable = cams.filter((c) => c.record);
  cameraSelect.innerHTML = '';
  if (recordable.length === 0) {
    cameraSelect.innerHTML = '<option>（沒有錄影中的攝影機）</option>';
    return;
  }
  for (const c of recordable) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    cameraSelect.appendChild(opt);
  }
  await loadDates();
}

async function loadDates() {
  const id = cameraSelect.value;
  if (!id) return;
  const dates = await getJSON(`/api/recordings/${encodeURIComponent(id)}/dates`);
  dateSelect.innerHTML = '';
  if (dates.length === 0) {
    dateSelect.innerHTML = '<option>（尚無錄影）</option>';
    clipList.innerHTML = '<div class="pb-empty">這台攝影機還沒有錄影檔。</div>';
    return;
  }
  for (const d of dates) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    dateSelect.appendChild(opt);
  }
  await loadClips();
}

async function loadClips() {
  const id = cameraSelect.value;
  const date = dateSelect.value;
  if (!id || !date) return;
  const clips = await getJSON(
    `/api/recordings/${encodeURIComponent(id)}?date=${encodeURIComponent(date)}`
  );
  clipList.innerHTML = '';
  if (clips.length === 0) {
    clipList.innerHTML = '<div class="pb-empty">這一天沒有錄影檔。</div>';
    return;
  }
  for (const clip of clips) {
    const el = document.createElement('div');
    el.className = 'clip';
    el.innerHTML = `
      <span class="clip-time">${fmtTime(clip.start)}</span>
      <span class="clip-meta">${fmtDuration(clip.durationSec)} · ${fmtSize(clip.size)}</span>
    `;
    el.addEventListener('click', () => {
      document.querySelectorAll('.clip.active').forEach((c) =>
        c.classList.remove('active')
      );
      el.classList.add('active');
      play(clip);
    });
    clipList.appendChild(el);
  }
}

function play(clip) {
  player.src = clip.url;
  player.play().catch(() => {});
  nowPlaying.textContent = `播放中：${dateSelect.value} ${fmtTime(clip.start)}`;
  downloadLink.href = clip.url;
  downloadLink.classList.remove('hidden');
}

cameraSelect.addEventListener('change', loadDates);
dateSelect.addEventListener('change', loadClips);

loadCameras().catch((err) => {
  clipList.innerHTML = `<div class="pb-empty">載入失敗：${err.message}</div>`;
});
