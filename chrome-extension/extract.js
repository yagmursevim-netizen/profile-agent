/* Runs only after the user clicks the extension on the active TikTok profile. */
// eslint-disable-next-line no-unused-vars -- injected by popup.js via chrome.scripting
function extractTikTokProfile() {
  const url = new URL(location.href);
  if (
    !['www.tiktok.com', 'tiktok.com'].includes(url.hostname) ||
    !/^\/@[^/]+\/?$/.test(url.pathname)
  )
    throw new Error(
      'Bir TikTok profilini açın: tiktok.com/@kullaniciadi. Arama ve video sayfası yerine profil sayfasını seçin.',
    );
  const handle = decodeURIComponent(
    url.pathname.slice(2).replace(/\/$/, ''),
  ).toLowerCase();
  const visible = document.body.innerText;
  if (
    /too many attempts|too many requests|verify to continue|drag the slider|complete the puzzle/i.test(
      visible,
    )
  )
    throw new Error(
      'TikTok doğrulama veya kısıt gösteriyor. Önce sayfadaki uyarıyı kontrol edin.',
    );
  let found = null;
  for (const script of document.querySelectorAll(
    'script[type="application/json"], script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE',
  )) {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      continue;
    }
    const stack = [data];
    let visits = 0;
    while (stack.length && visits++ < 50000) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const u = node.user || node.userInfo?.user;
      const stats = node.stats || node.statsV2 || node.userInfo?.stats;
      if (u?.uniqueId?.toLowerCase() === handle && stats) {
        const exact = (n) => {
          const value =
            typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n;
          return Number.isSafeInteger(value) && value >= 0 ? value : null;
        };
        found = {
          username: handle,
          fullName: typeof u.nickname === 'string' ? u.nickname : '',
          bio: typeof u.signature === 'string' ? u.signature : null,
          followers: exact(stats.followerCount),
          following: exact(stats.followingCount),
          private:
            typeof u.privateAccount === 'boolean' ? u.privateAccount : null,
        };
        break;
      }
      stack.push(...Object.values(node));
    }
    if (found) break;
  }
  if (!found) {
    const text = (selector) =>
      document.querySelector(selector)?.textContent?.trim() ?? null;
    const title = text('[data-e2e="user-title"]');
    if (title?.replace(/^@/, '').toLowerCase() !== handle)
      throw new Error(
        'Profil bilgileri okunamadı. Sayfanın yüklenmesini bekleyip tekrar deneyin.',
      );
    // Rounded display counts are deliberately left unknown.
    const count = (selector) => {
      const value = text(selector);
      return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
        ? Number(value)
        : null;
    };
    found = {
      username: handle,
      fullName: text('[data-e2e="user-subtitle"]') || '',
      bio: text('[data-e2e="user-bio"]'),
      followers: count('[data-e2e="followers-count"]'),
      following: count('[data-e2e="following-count"]'),
      private: null,
    };
  }
  return {
    format: 'hiwell-tiktok-profile',
    version: 1,
    sourceUrl: 'https://www.tiktok.com/@' + handle,
    collectedAt: new Date().toISOString(),
    profile: found,
  };
}
