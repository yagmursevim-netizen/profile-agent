import { normalizeProfile } from './domain.mjs';

export const selectors = {
  username: '[data-e2e="user-title"]',
  bio: '[data-e2e="user-bio"]',
  name: '[data-e2e="user-subtitle"]',
  followers: '[data-e2e="followers-count"]',
  following: '[data-e2e="following-count"]',
  link: 'a[data-e2e="user-link"]',
};
export function domProfile(data, handle, source = 'TikTok HTML') {
  if (
    typeof data?.username !== 'string' ||
    data.username.trim().replace(/^@/, '').toLowerCase() !==
      handle.toLowerCase()
  )
    return null;
  if (typeof data.bio !== 'string') return null;
  const exact = (v) =>
    typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
  let bioLink = null;
  try {
    const url = new URL(data.link);
    if (['https:', 'http:'].includes(url.protocol)) bioLink = url.href;
  } catch {}
  return {
    ...normalizeProfile({
      username: handle,
      biography: data.bio,
      full_name: data.name,
      follower_count: exact(data.followers),
      following_count: exact(data.following),
    }),
    platform: 'tiktok',
    bioSource: source,
    bioLink,
  };
}
export async function readDOM(page, handle) {
  const data = await page.evaluate((selectors) => {
    const result = {};
    for (const [key, selector] of Object.entries(selectors)) {
      const el = document.querySelector(selector);
      result[key] = el
        ? key === 'link'
          ? el.getAttribute('href')
          : el.textContent
        : null;
    }
    return result;
  }, selectors);
  return domProfile(data, handle);
}
export function mergeProfile(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const merged = { ...fallback, ...primary };
  for (const key of [
    'bio',
    'email',
    'followers',
    'following',
    'private',
    'bioLink',
    'fullName',
  ]) {
    if (
      primary[key] === null ||
      primary[key] === undefined ||
      (key === 'fullName' && !primary[key])
    )
      merged[key] = fallback[key];
  }
  if (primary.bio == null && fallback.bio != null) {
    const signals = normalizeProfile({
      username: primary.username,
      biography: fallback.bio,
    });
    for (const key of [
      'bioSource',
      'language',
      'languageEvidence',
      'gender',
      'genderEvidence',
      'dmForCollaboration',
      'dmEvidence',
    ])
      merged[key] = fallback[key] ?? signals[key];
  }
  return merged;
}
export function searchEvidence(payload, handle) {
  for (const item of payload?.organic_results || []) {
    try {
      const url = new URL(item.url);
      if (
        !['www.tiktok.com', 'tiktok.com'].includes(url.hostname) ||
        url.pathname.replace(/\/$/, '').toLowerCase() !==
          `/@${handle.toLowerCase()}` ||
        typeof item.description !== 'string' ||
        !item.description.trim()
      )
        continue;
      return {
        text: item.description,
        url: url.href,
        source: 'Google arama özeti — güncelliği ve tamlığı doğrulanmadı',
        observedAt: new Date().toISOString(),
      };
    } catch {}
  }
  return null;
}
export async function externalFallback(
  handle,
  signal,
  request = fetch,
  env = process.env,
) {
  if (!env.SCRAPINGBEE_API_KEY) return {};
  const get = async (endpoint, params) => {
    const url = new URL(endpoint, 'https://app.scrapingbee.com');
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const response = await request(url, {
      headers: { Authorization: `Bearer ${env.SCRAPINGBEE_API_KEY}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    });
    if (!response.ok)
      throw new Error(`Yedek veri servisi HTTP ${response.status}`);
    return response.json();
  };
  const notes = [];
  if (env.TIKTOK_SCRAPINGBEE_ENABLED === 'true') {
    try {
      const rules = Object.fromEntries(
        Object.entries(selectors).map(([key, selector]) => [
          key,
          {
            selector,
            type: 'item',
            ...(key === 'link' ? { output: '@href' } : {}),
          },
        ]),
      );
      const data = await get('/api/v1/', {
        url: `https://www.tiktok.com/@${handle}`,
        render_js: 'true',
        wait: '2500',
        extract_rules: JSON.stringify(rules),
      });
      const profile = domProfile(data, handle, 'ScrapingBee / TikTok HTML');
      if (profile) return { profile, notes };
      notes.push('Yedek HTML kaynağında doğrulanabilir bio bulunamadı.');
    } catch (e) {
      signal.throwIfAborted();
      notes.push(
        e.message.startsWith('Yedek veri servisi HTTP')
          ? e.message
          : 'Yedek HTML servisine erişilemedi.',
      );
    }
  }
  if (env.TIKTOK_GOOGLE_ENABLED === 'true') {
    try {
      const data = await get('/api/v1/google', {
        search: `site:tiktok.com/@${handle} "${handle}"`,
        pages: '1',
      });
      return { evidence: searchEvidence(data, handle), notes };
    } catch {
      signal.throwIfAborted();
      notes.push('Google yedek aramasına erişilemedi.');
    }
  }
  return { notes };
}
