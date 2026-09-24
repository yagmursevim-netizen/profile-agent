// eslint-disable-next-line no-unused-vars -- injected by agent.js
function tikTokFollowing(action) {
  const visible = (e) =>
    !!e &&
    e.getBoundingClientRect().height > 0 &&
    getComputedStyle(e).visibility !== 'hidden';
  if (action === 'open') {
    const count = document.querySelector('[data-e2e="following-count"]');
    const exact = count?.textContent?.trim();
    if (exact === '0') return { users: [], complete: true, following: 0 };
    const control =
      count?.closest('a,button,[role="button"]') || count?.parentElement;
    if (!visible(control))
      return {
        error:
          'TikTok takip edilenler düğmesi bulunamadı. Profilin yüklenmesini ve erişimini kontrol edin.',
      };
    control.click();
    return { opened: true };
  }
  const roots = [
    ...document.querySelectorAll(
      '[role="dialog"], [data-e2e="follow-info-popup"], [data-e2e="follow-info-container"]',
    ),
  ].filter(visible);
  const root = roots.find((e) =>
    /following|takip edilen|takip ettiği/i.test(e.innerText),
  );
  if (!root)
    return {
      error:
        'TikTok takip edilenler listesi açılamadı. Liste gizli olabilir veya sayfa yapısı değişmiş olabilir.',
    };
  if (
    /following list is private|following list is hidden|only .* can see.*following|takip.*listesi.*gizli|can.t view.*following/i.test(
      root.innerText,
    )
  )
    return {
      error:
        'Bu hesabın takip edilenler listesi gizli; kullanıcılar okunamıyor.',
    };
  // Select the Following tab if the popup initially shows Followers.
  const tabs = [...root.querySelectorAll('[role="tab"],button')];
  const following = tabs.find((e) =>
    /^(following|takip edilenler|takip ettikleri)(\s|$)/i.test(
      e.innerText.trim(),
    ),
  );
  if (following && following.getAttribute('aria-selected') === 'false') {
    following.click();
    return { users: [], switched: true };
  }
  const users = [];
  for (const a of root.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.href, location.origin);
      if (
        ['www.tiktok.com', 'tiktok.com'].includes(u.hostname) &&
        /^\/@[a-z0-9._]{2,24}\/?$/i.test(u.pathname)
      )
        users.push(u.pathname.slice(2).replace(/\/$/, '').toLowerCase());
    } catch {}
  }
  if (action === 'scroll') {
    const scrolling = [root, ...root.querySelectorAll('*')].filter(
      (e) =>
        visible(e) &&
        e.scrollHeight > e.clientHeight + 5 &&
        /auto|scroll/.test(getComputedStyle(e).overflowY),
    );
    const scroller = scrolling.sort(
      (a, b) => b.scrollHeight - a.scrollHeight,
    )[0];
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }
  return { users: [...new Set(users)].slice(0, 5000) };
}
