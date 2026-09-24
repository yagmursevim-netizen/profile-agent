import { username, normalizeProfile } from './domain.mjs';
export function importTikTok(input) {
  if (!input || input.format !== 'hiwell-tiktok-profile' || input.version !== 1)
    throw new Error(
      'Hiwell TikTok eklentisinden indirilen JSON dosyasını seçin.',
    );
  const p = input.profile;
  if (!p || typeof p !== 'object') throw new Error('Profil bilgileri eksik.');
  const handle = username(p.username, 'tiktok');
  if (input.sourceUrl !== 'https://www.tiktok.com/@' + handle)
    throw new Error('Profil adresi ve kullanıcı adı eşleşmiyor.');
  for (const field of ['followers', 'following'])
    if (p[field] !== null && (!Number.isSafeInteger(p[field]) || p[field] < 0))
      throw new Error('Takipçi ve takip sayısı tam sayı veya null olmalı.');
  if (p.private !== null && typeof p.private !== 'boolean')
    throw new Error('Hesap durumu geçersiz.');
  if (
    (p.bio !== null && (typeof p.bio !== 'string' || p.bio.length > 10000)) ||
    typeof p.fullName !== 'string' ||
    p.fullName.length > 200
  )
    throw new Error('Profil metni geçersiz.');
  const date = Date.parse(input.collectedAt);
  if (!Number.isFinite(date) || date > Date.now() + 300000)
    throw new Error('Profil okuma tarihi geçersiz.');
  return {
    ...normalizeProfile({
      username: handle,
      full_name: p.fullName,
      biography: p.bio,
      follower_count: p.followers,
      following_count: p.following,
      is_private: p.private,
    }),
    platform: 'tiktok',
    collectedAt: new Date(date).toISOString(),
    imported: true,
  };
}
