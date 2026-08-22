// 管理頁：新增/編輯/刪除同事帳號，並勾選每個人能看的攝影機。

let allCameras = [];

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

async function init() {
  const me = await getJSON('/api/me');
  document.getElementById('userLabel').textContent = `👤 ${me.username}`;
  allCameras = await getJSON('/api/admin/cameras');
  cameraCheckboxes(document.getElementById('newCams'), []);
  await loadUsers();
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
