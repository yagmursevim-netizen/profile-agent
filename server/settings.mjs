import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
try {
  process.loadEnvFile('.env');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
let saved = {};
try {
  saved = JSON.parse(await readFile('.local/settings.json', 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
let queue = Promise.resolve();
export function settings() {
  return {
    openaiKey: saved.openaiKey || process.env.OPENAI_API_KEY || '',
    openaiModel: saved.openaiModel || process.env.OPENAI_MODEL || 'gpt-5-mini',
    geminiKey: saved.geminiKey || process.env.GEMINI_API_KEY || '',
    sendgridKey: saved.sendgridKey || process.env.SENDGRID_API_KEY || '',
    // Used only for crash/restriction alert emails (see notifications.mjs),
    // sent via Gmail's own SMTP relay — kept separate from sendgridKey,
    // which candidate outreach sending (outreach.mjs) still uses. Sending
    // through Gmail's real infrastructure (instead of a third-party ESP
    // claiming a @gmail.com From address) avoids the DMARC-alignment
    // rejections that come with the latter.
    gmailAppPassword:
      saved.gmailAppPassword || process.env.GMAIL_APP_PASSWORD || '',
    fromEmail:
      saved.fromEmail ||
      process.env.SENDGRID_FROM_EMAIL ||
      'hello@hiwellapp.com',
    fromName: saved.fromName || process.env.SENDGRID_FROM_NAME || 'Hiwell',
    // Candidate pre-screening thresholds, applied while reading a following
    // list (see index.mjs) — adjustable here instead of fixed in code.
    fameFollowerThreshold: saved.fameFollowerThreshold ?? 100_000,
    minFollowerThreshold: saved.minFollowerThreshold ?? 0,
    titlePrefixes: saved.titlePrefixes || 'dr,dyt,psk,av,prof',
    // Free-text roster (comma or newline separated) checked against every
    // scanned candidate right before a profile visit — see
    // excludedUsernameSet() in domain.mjs and its use in index.mjs's run().
    excludedUsernames: saved.excludedUsernames || '',
    genderExclude: saved.genderExclude || 'erkek', // 'erkek' | 'kadın' | 'kapalı'
    // If on, a profile with an email or a DM-collaboration signal gets the
    // post-visit AI verdict automatically during the scan itself, instead of
    // needing a separate manual "Uygunluğu değerlendir" pass afterward.
    autoAssess: saved.autoAssess ?? false,
    // Caps OpenAI spend/time per scan run — once hit, remaining matches are
    // still collected, just left unassessed for manual review.
    autoAssessLimit: saved.autoAssessLimit ?? 100,
    // Periodic rest pauses during a scan — an account that's active every
    // single minute for hours on end looks less like it has a human owner
    // than one that takes breaks, even with per-visit delays already in
    // place.
    restBreakEnabled: saved.restBreakEnabled ?? false,
    restBreakEveryMinutes: saved.restBreakEveryMinutes ?? 60,
    restBreakDurationMinutes: saved.restBreakDurationMinutes ?? 15,
  };
}
export function publicSettings() {
  const s = settings();
  return {
    openaiConfigured: !!s.openaiKey,
    geminiConfigured: !!s.geminiKey,
    sendgridConfigured: !!s.sendgridKey,
    gmailConfigured: !!s.gmailAppPassword,
    openaiModel: s.openaiModel,
    fromEmail: s.fromEmail,
    fromName: s.fromName,
    fameFollowerThreshold: s.fameFollowerThreshold,
    minFollowerThreshold: s.minFollowerThreshold,
    titlePrefixes: s.titlePrefixes,
    excludedUsernames: s.excludedUsernames,
    genderExclude: s.genderExclude,
    autoAssess: s.autoAssess,
    autoAssessLimit: s.autoAssessLimit,
    restBreakEnabled: s.restBreakEnabled,
    restBreakEveryMinutes: s.restBreakEveryMinutes,
    restBreakDurationMinutes: s.restBreakDurationMinutes,
  };
}
export async function updateSettings(input) {
  const next = { ...saved };
  for (const key of [
    'openaiKey',
    'geminiKey',
    'sendgridKey',
    'openaiModel',
    'fromEmail',
    'fromName',
    'titlePrefixes',
  ]) {
    if (input[key] === undefined || input[key] === '') continue;
    if (
      typeof input[key] !== 'string' ||
      input[key].length > 1000 ||
      /[\r\n]/.test(input[key])
    )
      throw new Error('Geçersiz bağlantı ayarı.');
    next[key] = input[key].trim();
  }
  if (input.clearOpenai) next.openaiKey = '';
  if (input.clearGemini) next.geminiKey = '';
  if (input.clearSendgrid) next.sendgridKey = '';
  if (input.clearGmailAppPassword) next.gmailAppPassword = '';
  if (typeof input.gmailAppPassword === 'string' && input.gmailAppPassword) {
    // Google shows app passwords grouped as "abcd efgh ijkl mnop" for
    // readability; strip the spaces so a direct copy-paste still works.
    const cleaned = input.gmailAppPassword.replace(/\s+/g, '');
    if (!/^[a-zA-Z]{16}$/.test(cleaned))
      throw new Error(
        'Geçersiz Gmail uygulama şifresi (16 harfli olmalı, Google’ın verdiği haliyle girin).',
      );
    next.gmailAppPassword = cleaned;
  }
  if (next.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.fromEmail))
    throw new Error('Geçerli bir gönderen email adresi girin.');
  if (next.openaiModel && !/^[a-zA-Z0-9._:-]+$/.test(next.openaiModel))
    throw new Error('Geçersiz OpenAI model adı.');
  if (
    next.titlePrefixes &&
    !/^[a-zçğıöşü]+(,[a-zçğıöşü]+)*$/i.test(next.titlePrefixes)
  )
    throw new Error(
      'Ünvan önekleri virgülle ayrılmış harflerden oluşmalı (örn. dr,dyt,psk).',
    );
  // Unlike the plain string fields above, this one is allowed to contain
  // newlines (one username per line is the natural way to paste a roster)
  // and an empty string is a valid, meaningful value — it clears the list —
  // so it's validated on its own instead of through that shared loop.
  if (typeof input.excludedUsernames === 'string') {
    const cleaned = input.excludedUsernames.trim();
    if (cleaned.length > 20000)
      throw new Error(
        'Hariç tutulacak kullanıcı listesi çok uzun (en fazla 20.000 karakter).',
      );
    if (cleaned && !/^[a-zA-Z0-9._@,\s]+$/.test(cleaned))
      throw new Error(
        'Hariç tutulacak kullanıcı adları yalnızca harf, rakam, nokta, alt çizgi, @ ve virgül/satır sonu içerebilir.',
      );
    next.excludedUsernames = cleaned;
  }
  if (typeof input.fameFollowerThreshold !== 'undefined') {
    const n = Number(input.fameFollowerThreshold);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000_000)
      throw new Error(
        'Takipçi eşiği 1-1.000.000.000 arasında bir sayı olmalı.',
      );
    next.fameFollowerThreshold = n;
  }
  if (typeof input.minFollowerThreshold !== 'undefined') {
    const n = Number(input.minFollowerThreshold);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000)
      throw new Error(
        'Minimum takipçi eşiği 0-1.000.000.000 arasında bir sayı olmalı.',
      );
    next.minFollowerThreshold = n;
  }
  if (typeof input.genderExclude !== 'undefined') {
    if (!['erkek', 'kadın', 'kapalı'].includes(input.genderExclude))
      throw new Error('Geçersiz cinsiyet eleme seçeneği.');
    next.genderExclude = input.genderExclude;
  }
  if (typeof input.autoAssess !== 'undefined')
    next.autoAssess = !!input.autoAssess;
  if (typeof input.autoAssessLimit !== 'undefined') {
    const n = Number(input.autoAssessLimit);
    if (!Number.isInteger(n) || n < 0 || n > 5000)
      throw new Error(
        'Otomatik değerlendirme sınırı 0-5.000 arasında bir sayı olmalı.',
      );
    next.autoAssessLimit = n;
  }
  if (typeof input.restBreakEnabled !== 'undefined')
    next.restBreakEnabled = !!input.restBreakEnabled;
  if (typeof input.restBreakEveryMinutes !== 'undefined') {
    const n = Number(input.restBreakEveryMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 1440)
      throw new Error('Mola aralığı 5-1440 dakika arasında olmalı.');
    next.restBreakEveryMinutes = n;
  }
  if (typeof input.restBreakDurationMinutes !== 'undefined') {
    const n = Number(input.restBreakDurationMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 720)
      throw new Error('Mola süresi 1-720 dakika arasında olmalı.');
    next.restBreakDurationMinutes = n;
  }
  queue = queue
    .catch(() => {})
    .then(async () => {
      await mkdir('.local', { recursive: true, mode: 0o700 });
      await writeFile('.local/settings.tmp', JSON.stringify(next), {
        mode: 0o600,
      });
      await rename('.local/settings.tmp', '.local/settings.json');
      saved = next;
    });
  await queue;
  return publicSettings();
}
