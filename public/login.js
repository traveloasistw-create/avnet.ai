const form = document.getElementById('loginForm');
const err = document.getElementById('err');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.classList.add('hidden');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      const data = await res.json().catch(() => ({}));
      err.textContent = data.error || '登入失敗';
      err.classList.remove('hidden');
    }
  } catch {
    err.textContent = '無法連線到伺服器';
    err.classList.remove('hidden');
  }
});
