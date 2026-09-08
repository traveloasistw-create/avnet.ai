// 裝飾性防護（防君子不防小人）：禁右鍵、禁選取、禁拖曳存圖。
// 僅套用在「一般帳號」；主管理員不受限制。
// 注意：不攔截拖曳排列（那是把手按鈕觸發的 dragstart），只擋圖片/影片的拖曳另存。
// 另外：若帳號還在用預設密碼，會在最上方顯示紅色警告（遠端連線時很重要）。

(async function () {
  let me;
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return; // 尚未登入等情況，不套用
    me = await res.json();
  } catch {
    return;
  }

  // ---- 還在用預設密碼 admin：顯示警告橫幅 ----
  if (me.weakPassword) {
    const bar = document.createElement('div');
    bar.textContent = me.isAdmin
      ? '⚠️ 你還在使用預設密碼「admin」，請立刻到「管理」頁面修改，否則任何人都能登入！'
      : '⚠️ 你還在使用預設密碼，請聯絡管理員幫你改掉。';
    bar.style.cssText =
      'position:sticky;top:0;z-index:9999;background:#c0392b;color:#fff;' +
      'padding:10px 14px;font-size:0.9rem;font-weight:700;text-align:center;' +
      'letter-spacing:0.02em;';
    document.body.prepend(bar);
  }

  if (me.isAdmin) return; // 管理員照常，可右鍵/選取

  // 一般帳號：套用限制
  document.body.classList.add('no-select');
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO')) {
      e.preventDefault();
    }
  });
})();
