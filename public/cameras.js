// 攝影機管理頁（僅主管理員）：新增/修改/刪除攝影機。

let recordingEnabled = false;

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('未登入');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

async function loadCameras() {
  const cams = await getJSON('/api/admin/cameras');
  document.getElementById('camCount').textContent = cams.length;
  const list = document.getElementById('camList');
  list.innerHTML = '';

  if (cams.length === 0) {
    list.innerHTML = '<p class="user-note">還沒有任何攝影機，用上方表單新增。</p>';
    return;
  }

  for (const cam of cams) {
    const card = document.createElement('div');
    card.className = 'user-card';

    const head = document.createElement('div');
    head.className = 'user-head';
    head.innerHTML = `<span class="dot ${cam.status}"></span> <strong>${cam.name}</strong>`;
    card.appendChild(head);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = cam.name;
    nameInput.className = 'pass-input';

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = cam.url;
    urlInput.className = 'pass-input';
    urlInput.style.flexBasis = '100%';

    const recLabel = document.createElement('label');
    recLabel.className = 'chk';
    const recCb = document.createElement('input');
    recCb.type = 'checkbox';
    recCb.checked = cam.record;
    recLabel.append(recCb, document.createTextNode(' 錄影'));
    if (!recordingEnabled) recLabel.style.display = 'none';

    const enLabel = document.createElement('label');
    enLabel.className = 'chk';
    const enCb = document.createElement('input');
    enCb.type = 'checkbox';
    enCb.checked = cam.enabled;
    enLabel.append(enCb, document.createTextNode(' 啟用'));

    const moLabel = document.createElement('label');
    moLabel.className = 'chk';
    const moCb = document.createElement('input');
    moCb.type = 'checkbox';
    moCb.checked = !!cam.motion;
    moLabel.append(moCb, document.createTextNode(' 移動偵測通知'));

    const odLabel = document.createElement('label');
    odLabel.className = 'chk';
    const odCb = document.createElement('input');
    odCb.type = 'checkbox';
    odCb.checked = !!cam.onDemand;
    odLabel.append(odCb, document.createTextNode(' 省電模式（點擊喚醒）'));

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '儲存';
    saveBtn.addEventListener('click', async () => {
      try {
        await getJSON(`/api/admin/cameras/${encodeURIComponent(cam.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nameInput.value.trim(),
            url: urlInput.value.trim(),
            record: recCb.checked,
            enabled: enCb.checked,
            motion: moCb.checked,
            onDemand: odCb.checked,
          }),
        });
        await loadCameras();
      } catch (err) {
        alert('儲存失敗：' + err.message);
      }
    });

    const rebootBtn = document.createElement('button');
    rebootBtn.textContent = '重啟相機';
    rebootBtn.addEventListener('click', async () => {
      if (!confirm(`確定要重新啟動「${cam.name}」？（相機會斷線約 1 分鐘）`)) return;
      rebootBtn.disabled = true;
      rebootBtn.textContent = '重啟中…';
      try {
        await getJSON(`/api/admin/cameras/${encodeURIComponent(cam.id)}/reboot`, {
          method: 'POST',
        });
        alert('已送出重啟指令，相機稍後會重新上線。');
      } catch (err) {
        alert('重啟失敗：' + err.message + '（相機可能不支援 ONVIF 重啟）');
      }
      rebootBtn.disabled = false;
      rebootBtn.textContent = '重啟相機';
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '刪除';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`確定刪除攝影機「${cam.name}」？（錄影檔會保留）`)) return;
      try {
        await getJSON(`/api/admin/cameras/${encodeURIComponent(cam.id)}`, {
          method: 'DELETE',
        });
        await loadCameras();
      } catch (err) {
        alert('刪除失敗：' + err.message);
      }
    });

    const row = document.createElement('div');
    row.className = 'user-actions';
    row.append(nameInput, urlInput, recLabel, enLabel, moLabel, odLabel, saveBtn, rebootBtn, delBtn);
    card.appendChild(row);
    list.appendChild(card);
  }
}

document.getElementById('addCamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('addCamErr');
  err.classList.add('hidden');
  try {
    await getJSON('/api/admin/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('camName').value.trim(),
        url: document.getElementById('camUrl').value.trim(),
        record: document.getElementById('camRecord').checked,
        onDemand: document.getElementById('camOnDemand').checked,
      }),
    });
    document.getElementById('camName').value = '';
    document.getElementById('camUrl').value = '';
    document.getElementById('camRecord').checked = true;
    document.getElementById('camOnDemand').checked = false;
    await loadCameras();
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
  }
});

// ---- 偵測攝影機：測連接埠 + 向相機詢問 RTSP 網址 ----
document.getElementById('probeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = document.getElementById('probeResult');
  const btn = document.getElementById('probeBtn');
  btn.disabled = true;
  btn.textContent = '偵測中…（約 10 秒）';
  out.innerHTML = '<p class="user-note">正在測試各個連接埠，請稍候…</p>';

  try {
    const r = await getJSON('/api/admin/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: document.getElementById('probeHost').value.trim(),
        username: document.getElementById('probeUser').value.trim(),
        password: document.getElementById('probePass').value,
      }),
    });
    renderProbe(r, out);
  } catch (err) {
    out.innerHTML = `<p class="login-err">偵測失敗：${err.message}</p>`;
  }
  btn.disabled = false;
  btn.textContent = '🔍 開始偵測';
});

function renderProbe(r, out) {
  const parts = [];

  if (!r.reachable) {
    parts.push(
      `<p class="probe-bad">❌ 連不到 ${r.host}</p>` +
        '<p class="user-note">請確認：IP 是否正確、相機是否和這台電腦在同一個 Wi-Fi、相機是否已開機。</p>'
    );
    out.innerHTML = parts.join('');
    return;
  }

  // 結論放最前面
  if (r.onvif && r.onvif.uri) {
    parts.push(
      '<p class="probe-good">✅ 太好了！這台相機支援即時串流，而且它直接告訴我們網址：</p>' +
        `<div class="probe-uri">${r.onvif.uri}</div>` +
        '<p class="user-note">把上面這串複製到下方「新增攝影機」的 RTSP 網址欄位即可。' +
        '若網址裡沒有帳號密碼，請改成 rtsp://帳號:密碼@… 的格式。</p>'
    );
    if (r.onvif.maker || r.onvif.model) {
      parts.push(
        `<p class="user-note">相機回報型號：${r.onvif.maker} ${r.onvif.model}</p>`
      );
    }
  } else if (r.hasRtsp) {
    parts.push(
      '<p class="probe-good">✅ RTSP 連接埠（554）是開著的，很可能支援即時串流。</p>' +
        '<p class="user-note">但相機不支援 ONVIF 或帳密不對，所以問不到確切網址，' +
        '需要查該廠牌的網址格式再試。</p>'
    );
  } else {
    parts.push(
      '<p class="probe-bad">⚠️ 沒有偵測到 RTSP（554/8554 都沒開）。</p>' +
        '<p class="user-note">這台相機很可能不支援即時串流，只能用原廠 App 觀看。</p>'
    );
  }

  if (r.hasSmb) {
    parts.push(
      '<p class="user-note">📁 偵測到 SMB 檔案分享（445）：這台可能支援 NAS 錄影存檔。</p>'
    );
  }

  // 連接埠明細
  const rows = r.ports
    .map(
      (p) =>
        `<div class="probe-row"><span class="dot ${p.open ? 'running' : 'stopped'}"></span>` +
        `<strong>${p.port}</strong><span>${p.what}</span>` +
        `<span>${p.open ? '開啟' : '關閉'}</span></div>`
    )
    .join('');
  parts.push('<div class="probe-ports">' + rows + '</div>');

  if (r.onvifError) {
    parts.push(`<p class="user-note">ONVIF 詢問失敗：${r.onvifError}</p>`);
  }

  out.innerHTML = parts.join('');
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

async function init() {
  const me = await getJSON('/api/me');
  document.getElementById('userLabel').textContent = `👤 ${me.username}`;
  if (me.isAdmin) document.getElementById('adminTab')?.classList.remove('hidden');
  const info = await getJSON('/api/recording-info');
  recordingEnabled = !!info.enabled;
  if (!recordingEnabled) {
    document.getElementById('playbackTab')?.classList.add('hidden');
    document.getElementById('camRecordLabel')?.classList.add('hidden');
  }
  await loadCameras();
}

init().catch((err) => {
  if (err.message !== '未登入') alert('載入失敗：' + err.message);
});
