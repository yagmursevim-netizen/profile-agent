import { parse } from 'csv-parse/sync';
import { profileSignals } from './profile-signals.mjs';

const RESERVED = new Set([
  'p',
  'reel',
  'reels',
  'stories',
  'explore',
  'accounts',
  'direct',
  'about',
  'legal',
]);
export function username(value, platform = 'instagram') {
  let s = String(value ?? '').trim();
  if (platform === 'tiktok') {
    if (/^(www\.)?tiktok\.com\//i.test(s)) s = 'https://' + s;
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      if (
        !['tiktok.com', 'www.tiktok.com'].includes(u.hostname) ||
        !/^\/@[^/]+\/?$/.test(u.pathname)
      )
        throw new Error(
          'TikTok profil bağlantısı girin: tiktok.com/@kullaniciadi',
        );
      s = u.pathname.slice(1).replace(/\/$/, '');
    }
    s = s.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9._]{2,24}$/.test(s) || s.endsWith('.'))
      throw new Error('Geçersiz TikTok kullanıcı adı.');
    return s;
  }
  if (/^(www\.)?instagram\.com\//i.test(s)) s = 'https://' + s;
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    if (!['instagram.com', 'www.instagram.com'].includes(u.hostname))
      throw new Error('Yalnızca Instagram profil bağlantıları kabul edilir.');
    s = u.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  s = s.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s) || RESERVED.has(s))
    throw new Error(`Geçersiz kullanıcı adı: ${s.slice(0, 60)}`);
  return s;
}
export function parseInput(
  text,
  csv = false,
  platform = 'instagram',
  maxCount = 500,
) {
  let values;
  if (csv) {
    const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
    const records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: firstLine.includes(';') ? ';' : ',',
      relax_column_count: true,
    });
    if (!records.length) throw new Error('CSV boş.');
    const headers = records[0].map((x) =>
      x.toLocaleLowerCase('tr').replace(/[_\s]/g, ''),
    );
    const column = headers.findIndex((x) =>
      [
        'username',
        'kullanıcıadı',
        'kullaniciadi',
        'url',
        'instagram',
        'tiktok',
      ].includes(x),
    );
    if (column < 0 && records[0].length > 1)
      throw new Error(
        'CSV başlığında username, kullanıcı adı veya url sütunu olmalı.',
      );
    values = (column >= 0 ? records.slice(1) : records)
      .map((r) => r[Math.max(column, 0)])
      .filter(Boolean);
  } else values = text.split(/[\s,;]+/).filter(Boolean);
  const result = [...new Set(values.map((value) => username(value, platform)))];
  if (!result.length) throw new Error('En az bir kullanıcı adı girin.');
  if (result.length > maxCount)
    throw new Error(
      `Bir taramada en fazla ${maxCount.toLocaleString('tr-TR')} hesap girilebilir.`,
    );
  return result;
}
// An optional extra CSV column (alongside the username/url one parseInput
// already requires) — lets a following-mode scan know roughly how large
// each source account is before ever opening it. Silently returns {} for
// plain (non-CSV) input, a single-column CSV, or one with no recognized
// count header; sortSourcesByFollowing already treats a missing count as
// "unknown", so this is purely additive and never required.
export function followingCounts(text, platform = 'instagram') {
  if (!text) return {};
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/)[0];
  let records;
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: firstLine.includes(';') ? ';' : ',',
      relax_column_count: true,
    });
  } catch {
    return {};
  }
  if (records.length < 2) return {};
  const headers = records[0].map((x) =>
    String(x).toLocaleLowerCase('tr').replace(/[_\s]/g, ''),
  );
  const userCol = headers.findIndex((x) =>
    [
      'username',
      'kullanıcıadı',
      'kullaniciadi',
      'url',
      'instagram',
      'tiktok',
    ].includes(x),
  );
  const countCol = headers.findIndex((x) =>
    [
      'following',
      'takipedilen',
      'takipedilensayısı',
      'takipedilensayisi',
      'followingcount',
    ].includes(x),
  );
  if (userCol < 0 || countCol < 0) return {};
  const counts = {};
  for (const row of records.slice(1)) {
    let u;
    try {
      u = username(row[userCol], platform);
    } catch {
      continue;
    }
    const raw = String(row[countCol] ?? '').trim();
    if (!raw) continue;
    const n = Number(raw.replace(/[.,\s]/g, ''));
    if (Number.isFinite(n) && n >= 0) counts[u] = n;
  }
  return counts;
}
// Optional extra CSV columns (followers/fullname/private) — matches the
// enriched export at GET /api/jobs/:id/usernames. Lets a 'candidates' mode
// scan (see index.mjs) apply the same fame/min-follower/private/title
// pre-visit filters 'following' mode uses, without a following-list read:
// this data already came from one, earlier, and is just being replayed.
// Silently returns {} for plain input or a CSV with none of these columns
// — nothing here is required, filters just apply to fewer users without it.
export function candidateInfoFromCsv(text, platform = 'instagram') {
  if (!text) return {};
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/)[0];
  let records;
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: firstLine.includes(';') ? ';' : ',',
      relax_column_count: true,
    });
  } catch {
    return {};
  }
  if (records.length < 2) return {};
  const headers = records[0].map((x) =>
    String(x).toLocaleLowerCase('tr').replace(/[_\s]/g, ''),
  );
  const userCol = headers.findIndex((x) =>
    [
      'username',
      'kullanıcıadı',
      'kullaniciadi',
      'url',
      'instagram',
      'tiktok',
    ].includes(x),
  );
  if (userCol < 0) return {};
  const followersCol = headers.findIndex((x) =>
    [
      'followers',
      'takipçi',
      'takipci',
      'takipçisayısı',
      'takipcisayisi',
    ].includes(x),
  );
  const nameCol = headers.findIndex((x) =>
    ['fullname', 'isim', 'adsoyad', 'ad'].includes(x),
  );
  const privateCol = headers.findIndex((x) => ['private', 'gizli'].includes(x));
  if (followersCol < 0 && nameCol < 0 && privateCol < 0) return {};
  const info = {};
  for (const row of records.slice(1)) {
    let u;
    try {
      u = username(row[userCol], platform);
    } catch {
      continue;
    }
    const entry = {};
    const rawFollowers = String(row[followersCol] ?? '').trim();
    if (followersCol >= 0 && rawFollowers) {
      const n = Number(rawFollowers.replace(/[.,\s]/g, ''));
      if (Number.isFinite(n) && n >= 0) entry.followers = n;
    }
    if (nameCol >= 0 && row[nameCol]) entry.fullName = String(row[nameCol]);
    if (privateCol >= 0 && String(row[privateCol] ?? '').trim())
      entry.private = /^(true|1|evet|yes|gizli)$/i.test(
        String(row[privateCol]).trim(),
      );
    if (Object.keys(entry).length) info[u] = entry;
  }
  return info;
}
// Following-list discovery's cost scales with how many accounts a source
// follows (each candidate gets a hover-card lookup — see instagram.mjs), so
// processing smaller sources first surfaces results faster and lets a large
// one run last instead of blocking everything behind it. Sources with no
// known count (the common case — followingCounts only finds one with a
// specific CSV column) keep their original relative order: Array#sort is
// stable, and every unknown count ties at Infinity, so with no counts at
// all this is a no-op.
export function sortSourcesByFollowing(sources, counts = {}) {
  return [...sources].sort((a, b) => {
    const ca = counts[a];
    const cb = counts[b];
    const va = typeof ca === 'number' ? ca : Infinity;
    const vb = typeof cb === 'number' ? cb : Infinity;
    return va - vb;
  });
}
// Bağlantılar's "Hariç tutulacak kullanıcılar" free-text field (comma or
// newline separated, '@' optional) parsed into a lowercase lookup set.
export function excludedUsernameSet(list) {
  return new Set(
    String(list || '')
      .split(/[\n,]+/)
      .map((u) => u.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean),
  );
}
export function emails(bio) {
  return (
    [
      ...new Set(
        (bio ?? '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [],
      ),
    ].join('; ') || null
  );
}
export function exactCount(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}
// Parses a follower/following/post count off Instagram's hover-card text
// (en-US locale, e.g. "661\nfollowers", "12,345 followers", "1.2K following",
// "3.4M followers"). Returns null if no count for that label is found.
export function parseAbbreviatedCount(text, label) {
  if (typeof text !== 'string') return null;
  const re = new RegExp(
    `([\\d,]+(?:\\.\\d+)?)\\s*([KMB])?\\s*[\\s\\n]*${label}`,
    'i',
  );
  const m = text.match(re);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') n *= 1_000;
  else if (suffix === 'M') n *= 1_000_000;
  else if (suffix === 'B') n *= 1_000_000_000;
  return exactCount(Math.round(n));
}
export function cleanUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function pickUrl(links) {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    const url = cleanUrl(link?.url);
    if (url) return url;
  }
  return null;
}
export function normalizeProfile(p) {
  const bio = typeof p.biography === 'string' ? p.biography : null;
  return {
    username: username(p.username),
    email: emails(bio),
    followers: exactCount(p.follower_count ?? p.edge_followed_by?.count),
    following: exactCount(p.following_count ?? p.edge_follow?.count),
    private: typeof p.is_private === 'boolean' ? p.is_private : null,
    photoUrl: cleanUrl(p.profile_pic_url_hd ?? p.profile_pic_url) ?? null,
    bio,
    ...profileSignals(bio),
    externalUrl: pickUrl(p.bio_links) ?? cleanUrl(p.external_url) ?? null,
    bioLinks: Array.isArray(p.bio_links)
      ? [...new Set(p.bio_links.map((l) => cleanUrl(l?.url)).filter(Boolean))]
      : null,
    isBusiness: typeof p.is_business === 'boolean' ? p.is_business : null,
    category: p.category ?? null,
    accountType: p.account_type ?? null,
    hasBusinessAddress: Boolean(p.address_street || p.city_name || p.zip),
    fullName: p.full_name || '',
    collectedAt: new Date().toISOString(),
    ai: null,
    error: null,
  };
}
export { selectProfiles as filterRows } from '../lib/profile-list.mjs';
export const HEADERS = [
  'Kullanıcı adı',
  'Email',
  'Takipçi sayısı',
  'Takip ettiği kişi sayısı',
  'Hesap durumu',
  'Bio tam metin',
  'İş birliği değerlendirmesi',
  'İş birliği iletişimi',
  'Bio dili',
  'Dil tespiti dayanağı',
  'Cinsiyet (açık beyan)',
  'Cinsiyet beyanı',
  'Platform',
  'Bio kaynağı',
  'Bio bağlantısı',
  'Arama özeti (doğrulanmadı)',
  'Arama kaynağı URL',
];
export function rowValues(r) {
  return [
    r.username,
    r.email,
    r.followers,
    r.following,
    r.private === null ? 'Bilinmiyor' : r.private ? 'Kilitli' : 'Açık',
    r.bio,
    r.ai
      ? `${r.ai.verdict}: ${r.ai.reason}`
      : r.error
        ? `Veri alınamadı: ${r.error}`
        : 'Değerlendirilmedi',
    r.dmForCollaboration
      ? `İş birliği için DM: ${r.dmEvidence}`
      : 'DM beyanı yok',
    r.language || 'Bilinmiyor',
    r.languageEvidence || 'Tespit edilemedi',
    r.gender || 'Bilinmiyor',
    r.genderEvidence || 'Açık beyan yok',
    r.platform === 'tiktok' ? 'TikTok' : 'Instagram',
    r.bioSource || null,
    r.bioLink || null,
    r.searchEvidence?.text || null,
    r.searchEvidence?.url || null,
  ];
}
export function csvCell(value) {
  let s = value === null || value === undefined ? 'null' : String(value);
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function sourceLimitWarnings(
  handle,
  followers,
  following,
  limit = 5000,
) {
  const notes = [];
  // The scan reads who this source *follows*, not their own follower count
  // — that count is only worth a quick parenthetical, not a full sentence
  // repeated once per large source.
  if (typeof followers === 'number' && followers > 5000)
    notes.push(`@${handle} (${followers.toLocaleString('tr-TR')} takipçi)`);
  if (typeof following === 'number' && following > limit)
    notes.push(
      `@${handle}: ${following.toLocaleString('tr-TR')} hesap takip ediyor; en fazla ${limit.toLocaleString('tr-TR')} hesap alınacak.`,
    );
  return notes;
}
