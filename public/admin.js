// 管理頁：新增/編輯/刪除同事帳號，並勾選每個人能看的攝影機。

let allCameras = [];
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

// 產生一組攝影機勾選框
function cameraCheckboxes(container, selectedIds) {
  container.innerHTML = '';
  const selected = new Set(selectedIds === '*' ? [] : selectedIds || []);
  for (const cam of allCameras) {
    const label = document.createElement('label');
    label.className = 'chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = cam.id;
    cb.checked = selected.has(cam.id);
    label.append(cb, document.createTextNode(' ' + cam.name));
    container.appendChild(label);
  }
}

function selectedCams(container) {
  return [...container.querySelectorAll('input[type=checkbox]:checked')].map(
    (cb) => cb.value
  );
}

async function loadUsers() {
  const users = await getJSON('/api/admin/users');
  const subCount = users.filter((u) => !u.isAdmin).length;
  document.getElementById('userCount').textContent =
    `${users.length} 個（子帳號 ${subCount}）`;
  const list = document.getElementById('userList');
  list.innerHTML = '';

  for (const u of users) {
    const card = document.createElement('div');
    card.className = 'user-card';

    const head = document.createElement('div');
    head.className = 'user-head';
    head.innerHTML = `<strong>${u.username}</strong>${
      u.isAdmin ? ' <span class="badge">管理員</span>' : ''
    }`;
    card.appendChild(head);

    if (u.isAdmin) {
      const note = document.createElement('p');
      note.className = 'user-note';
      note.textContent = '管理員可看全部攝影機。';
      card.appendChild(note);
    } else {
      const picker = document.createElement('div');
      picker.className = 'cam-picker';
      cameraCheckboxes(picker, u.cameras);
      card.appendChild(picker);
      card._picker = picker;
    }

    const row = document.createElement('div');
    row.className = 'user-actions';

    const pass = document.createElement('input');
    pass.type = 'text';
    pass.placeholder = '重設密碼（留空不改）';
    pass.className = 'pass-input';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '儲存';
    saveBtn.addEventListener('click', async () => {
      const body = {};
      if (pass.value) body.password = pass.value;
      if (!u.isAdmin && card._picker)
        body.cameras = selectedCams(card._picker);
      try {
        await getJSON(`/api/admin/users/${encodeURIComponent(u.username)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        pass.value = '';
        saveBtn.textContent = '已儲存 ✓';
        setTimeout(() => (saveBtn.textContent = '儲存'), 1500);
      } catch (err) {
        alert('儲存失敗：' + err.message);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '刪除';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`確定刪除帳號「${u.username}」？`)) return;
      try {
        await getJSON(`/api/admin/users/${encodeURIComponent(u.username)}`, {
          method: 'DELETE',
        });
        loadUsers();
      } catch (err) {
        alert('刪除失敗：' + err.message);
      }
    });

    row.append(pass, saveBtn, delBtn);
    card.appendChild(row);
    list.appendChild(card);
  }
}

// ---- 攝影機管理 ----
async function loadCameras() {
  allCameras = await getJSON('/api/admin/cameras');
  const list = document.getElementById('camList');
  list.innerHTML = '';

  if (allCameras.length === 0) {
    list.innerHTML = '<p class="user-note">還沒有任何攝影機，用上方表單新增。</p>';
  }

  for (const cam of allCameras) {
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

    const enLabel = document.createElement('label');
    enLabel.className = 'chk';
    const enCb = document.createElement('input');
    enCb.type = 'checkbox';
    enCb.checked = cam.enabled;
    enLabel.append(enCb, document.createTextNode(' 啟用'));
    if (!recordingEnabled) recLabel.style.display = 'none';

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
        await refresh();
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
        await refresh();
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
    await refresh();
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.remove('hidden');
  }
});

// 重新載入攝影機與使用者（攝影機異動後，權限勾選也要跟著更新）
async function refresh() {
  await loadCameras();
  cameraCheckboxes(document.getElementById('newCams'), []);
  await loadUsers();
  loadLogs();
}

// 目前在線的使用者與他們正在看的相機（每 5 秒更新）
async function loadOnline() {
  let data;
  try {
    data = await getJSON('/api/admin/online');
  } catch {
    return;
  }
  document.getElementById('onlineCount').textContent = data.length;
  const el = document.getElementById('onlineList');
  if (data.length === 0) {
    el.innerHTML = '<p class="user-note">目前沒有人在線。</p>';
    return;
  }
  el.innerHTML = '';
  for (const u of data) {
    const row = document.createElement('div');
    row.className = 'online-row';
    const cams = u.cameras.length
      ? u.cameras.join('、')
      : '（剛登入，尚未載入畫面）';
    const dot = document.createElement('span');
    dot.className = 'dot running';
    const name = document.createElement('strong');
    name.textContent = u.username;
    const seeing = document.createElement('span');
    seeing.className = 'online-cams';
    seeing.textContent = '正在看：' + cams;
    row.append(dot, name, seeing);
    el.appendChild(row);
  }
}

// 操作日誌
function fmtWhen(ts) {
  return new Date(ts).toLocaleString('zh-TW', { hour12: false });
}
async function loadLogs() {
  let logs;
  try {
    logs = await getJSON('/api/admin/logs');
  } catch {
    return;
  }
  const el = document.getElementById('logList');
  if (!logs.length) {
    el.innerHTML = '<p class="user-note">尚無紀錄。</p>';
    return;
  }
  el.innerHTML = '';
  for (const l of logs) {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML =
      `<span class="log-time">${fmtWhen(l.t)}</span>` +
      `<span class="log-user">${l.user}</span>` +
      `<span class="log-act">${l.action}${l.detail ? '：' + l.detail : ''}</span>`;
    el.appendChild(row);
  }
}

// 主機硬碟空間
function fmtGB(bytes) {
  return (bytes / 1e9).toFixed(0) + ' GB';
}
async function loadDisk() {
  let d;
  try {
    d = await getJSON('/api/admin/disk');
  } catch {
    return;
  }
  const el = document.getElementById('diskInfo');
  if (!d.ok) {
    el.textContent = '';
    return;
  }
  const pctFree = Math.round((d.free / d.total) * 100);
  const warn = pctFree < 10 ? '⚠️ 空間偏低！' : '';
  el.textContent = `💾 主機硬碟：剩餘 ${fmtGB(d.free)} / 共 ${fmtGB(d.total)}（${pctFree}%）${warn}`;
}

async function init() {
  const me = await getJSON('/api/me');
  document.getElementById('userLabel').textContent = `👤 ${me.username}`;
  const info = await getJSON('/api/recording-info');
  recordingEnabled = !!info.enabled;
  if (!recordingEnabled) {
    document.getElementById('playbackTab')?.classList.add('hidden');
    document.getElementById('camRecordLabel')?.classList.add('hidden');
  }
  await refresh();
  loadOnline();
  loadDisk();
  loadLogs();
  setInterval(loadOnline, 5000);
}

// 新增帳號
document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const addErr = document.getElementById('addErr');
  addErr.classList.add('hidden');
  const isAdmin = document.getElementById('newAdmin').checked;
  const body = {
    username: document.getElementById('newUser').value.trim(),
    password: document.getElementById('newPass').value,
    isAdmin,
    cameras: isAdmin ? '*' : selectedCams(document.getElementById('newCams')),
  };
  try {
    await getJSON('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    document.getElementById('newUser').value = '';
    document.getElementById('newPass').value = '';
    document.getElementById('newAdmin').checked = false;
    cameraCheckboxes(document.getElementById('newCams'), []);
    await loadUsers();
  } catch (err) {
    addErr.textContent = err.message;
    addErr.classList.remove('hidden');
  }
});

// 新增表單勾管理員時，隱藏攝影機勾選（因為管理員本來就全看）
document.getElementById('newAdmin').addEventListener('change', (e) => {
  document.getElementById('newCams').style.display = e.target.checked
    ? 'none'
    : '';
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

init().catch((err) => {
  if (err.message !== '未登入') alert('載入失敗：' + err.message);
});
