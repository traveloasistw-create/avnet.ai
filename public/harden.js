// 裝飾性防護（防君子不防小人）：禁右鍵、禁選取、禁拖曳存圖。
// 僅套用在「一般帳號」；主管理員不受限制。
// 注意：不攔截拖曳排列（那是把手按鈕觸發的 dragstart），只擋圖片/影片的拖曳另存。

(async function () {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return; // 尚未登入等情況，不套用
    const me = await res.json();
    if (me.isAdmin) return; // 管理員照常，可右鍵/選取
  } catch {
    return;
  }

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
