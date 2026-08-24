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
          }),
        });
        await loadCameras();
      } catch (err) {
        alert('儲存失敗：' + err.message);
      }
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
    row.append(nameInput, urlInput, recLabel, enLabel, saveBtn, delBtn);
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
      }),
    });
    document.getElementById('camName').value = '';
    document.getElementById('camUrl').value = '';
    document.getElementById('camRecord').checked = true;
    await loadCameras();
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
  }
});

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
