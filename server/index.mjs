import { InstagramAccounts } from './instagram-accounts.mjs';
import { parseContacts } from './outreach-import.mjs';
import { TikTokBridge } from './tiktok-bridge.mjs';
import { WorkQueue } from './work-queue.mjs';
import { performanceReport } from './performance.mjs';
import { importTikTok } from './tiktok-import.mjs';
import { TikTok } from './tiktok.mjs';
import { platformName, profileUrl, searchTerms } from './platform.mjs';
import { senderIdentity, resolveSender } from './sender-identity.mjs';
import { TestEmail } from './test-email.mjs';
import { allowedOrigin } from './network.mjs';
import {
  cachedProfile,
  cachedFollowing,
  needsInstagram,
  rejectedUsernames,
} from './profile-cache.mjs';
import {
  notifyRestriction,
  notifyCrash,
  notifyTest,
} from './notifications.mjs';
import { Auth, publicUser } from './auth.mjs';
import http from 'node:http';
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  copyFile,
  unlink,
} from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import ExcelJS from 'exceljs';
import { Instagram } from './instagram.mjs';
import { demoRows } from './demo.mjs';
import { models, assess, screenPhoto, generatePost } from './ai.mjs';
import { settings, publicSettings, updateSettings } from './settings.mjs';
import { Outreach } from './outreach.mjs';
import { profileSignals } from './profile-signals.mjs';
import {
  parseInput,
  sourceLimitWarnings,
  filterRows,
  HEADERS,
  rowValues,
  csvCell,
  followingCounts,
  sortSourcesByFollowing,
  excludedUsernameSet,
} from './domain.mjs';

// Playwright's own internal IPC to the browser process (pipeTransport.js)
// can throw completely outside our control — e.g. if the browser process is
// killed by macOS sleep, an OS memory reclaim, or a proxy/network hiccup
// mid-message, the next partial read fails JSON.parse. Node treats that as
// an uncaught exception and kills the whole server by default, which for an
// unattended multi-account run means every other account's queued work
// dies with it too. Recovering here — dropping the (now broken) browser
// session and marking only the affected job as interrupted — keeps
// everything else running instead.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server kept running):', err);
  void instagram.context
    ?.close()
    .catch(() => {})
    .finally(() => {
      instagram.context = null;
    });
  void tiktok.context
    ?.close()
    .catch(() => {})
    .finally(() => {
      tiktok.context = null;
    });
  const affectedJob = active ? jobs.find((j) => j.id === active.id) : null;
  if (active) {
    if (affectedJob) {
      affectedJob.status = 'interrupted';
      affectedJob.message =
        'Beklenmeyen bir hata sonrası tarama durduruldu; kayıtlı sonuçlar korundu. Saatlik otomatik kontrol tekrar deneyecek.';
    }
    active.controller.abort();
    active = null;
    // The worker() call this crash interrupted never settles — its promise
    // is just permanently stuck awaiting a browser process that's gone —
    // so drainLane's own cleanup never runs and the scan lane would stay
    // wedged "running" forever, silently blocking every future auto-resume
    // attempt. Releasing it here is what lets autoResumeBlocked() actually
    // restart the job instead of just marking it and never trying again.
    queue.forget('scan');
    void save();
  }
  void notifyCrash(err, affectedJob, settings());
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection (server kept running):', err);
});
// Builds the professional-title-prefix matcher from Bağlantılar's
// comma-separated list (e.g. "dr,dyt,psk,av,prof" -> matches "Dr. Ayşe",
// "Prof. Dr. Zeynep", ...). The prefix must be followed by a period or
// whitespace so real names like "Avcı" aren't caught.
function titlePrefixRegex(list) {
  const words = String(list || '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return /(?!)/; // never matches
  return new RegExp(`^\\s*(${words.join('|')})(\\.|\\s)`, 'i');
}
// The unvan/profession prefix filter (dr, av, prof, health workers, ...)
// reflects outreach restrictions specific to Turkey; scans targeting other
// markets (job.market !== 'tr') skip it entirely rather than excluding
// candidates for no reason. Jobs created before this field existed have no
// job.market and keep the old, Turkey-only behavior.
function titlePrefixFilterFor(job, candidateSettings) {
  if (job.market && job.market !== 'tr') return /(?!)/; // never matches
  return titlePrefixRegex(candidateSettings.titlePrefixes);
}
// Must stay in sync with the "Hedef pazar" dropdown in app/page.tsx — every
// value it can send has to be accepted here. Only 'tr' has any behavioral
// effect (see titlePrefixFilterFor above); the rest just record which
// market a scan targeted.
const MARKETS = [
  'tr',
  'az',
  'uk',
  'br',
  'bg',
  'fr',
  'mx',
  'pl',
  'pt',
  'ro',
  'gr',
  'cz',
  'es',
  'it',
  'other',
];
// A stopped scan can have real work left even with an empty
// remainingUsers — a 'following'/'search' job that was interrupted before
// finishing discovery of every source has nothing queued to visit yet, but
// still has unread sources (see the sourcesDone resume logic in run()).
// Checking remainingUsers alone missed that case entirely: a restriction
// hit early enough (before the first source finished reading) left a job
// with no "Devam et" option and no way to continue short of a full re-scan.
function hasResumableWork(job) {
  if (job.remainingUsers?.length) return true;
  if (['following', 'search'].includes(job.mode)) {
    const done = new Set(job.sourcesDone || []);
    return job.sources.some((s) => !done.has(s));
  }
  return false;
}
const port = Number(process.env.API_PORT || 4318);
const lanOrigin = process.env.APP_LAN_ORIGIN || '';
if (
  lanOrigin &&
  lanOrigin !== 'https://trilogy-punch-ion.ngrok-free.dev' &&
  !/^https:\/\/(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+):\d+$/.test(
    lanOrigin,
  )
)
  throw new Error(
    'Geçersiz HTTPS uygulama adresi. npm run lan veya npm run public kullanın.',
  );
const auth = await new Auth('.local', !!lanOrigin).init();
const instagram = new Instagram();
const instagramAccounts = await new InstagramAccounts().init();
instagram.accounts = instagramAccounts;
const tiktok = new TikTok();
const tiktokBridge = await new TikTokBridge().init();
const outreach = await new Outreach().init();
const testEmail = await new TestEmail().init();
await mkdir('.local', { recursive: true, mode: 0o700 });
// Two server processes against the same .local directory can both open
// jobs.tmp for writing at once; their write() calls can interleave inside
// that multi-megabyte single-line JSON blob, and whichever one renames last
// leaves a corrupted jobs.json behind. A PID lockfile — checked for a still
// -running owner, not just presence — stops a second `npm run dev` here
// from ever reaching that race. A lock left by a killed/crashed process is
// harmless: its PID is dead, so the check below falls through.
async function acquireInstanceLock() {
  const lockPath = '.local/server.lock';
  let existingPid = null;
  try {
    existingPid = Number((await readFile(lockPath, 'utf8')).trim());
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (existingPid && existingPid !== process.pid) {
    let alive = true;
    try {
      process.kill(existingPid, 0);
    } catch {
      alive = false;
    }
    if (alive)
      throw new Error(
        `Sunucu zaten çalışıyor (PID ${existingPid}). Aynı .local klasörüne karşı iki sunucu birden çalıştırmak kayıt dosyasını bozabilir — önce diğer pencereyi/işlemi kapatın, sonra tekrar başlatın.`,
      );
  }
  await writeFile(lockPath, String(process.pid), { mode: 0o600 });
}
await acquireInstanceLock();
let jobs = [];
try {
  jobs = JSON.parse(await readFile('.local/jobs.json', 'utf8'));
  // A known-good snapshot, refreshed only right after a clean parse — cheap
  // (once per boot, not per save) safety net if this session's own writes
  // ever corrupt the live file later.
  await copyFile('.local/jobs.json', '.local/jobs.json.bak').catch(() => {});
} catch (e) {
  if (e.code === 'ENOENT') {
    // First run — nothing to load yet.
  } else {
    console.error(
      'jobs.json bozuk görünüyor, yedekten kurtarma deneniyor:',
      e.message,
    );
    let recovered = false;
    try {
      jobs = JSON.parse(await readFile('.local/jobs.json.bak', 'utf8'));
      recovered = true;
    } catch {}
    const brokenPath = `.local/jobs.corrupt-${Date.now()}.json`;
    await rename('.local/jobs.json', brokenPath).catch(() => {});
    // A single bad write must never take the whole app down — that turns
    // one corrupted save into a total outage. Preserve the broken file for
    // inspection and keep booting instead of refusing to start.
    console.error(
      recovered
        ? `Bozuk kayıt dosyası ${brokenPath} olarak taşındı; son yedekten devam ediliyor (en son birkaç değişiklik kaybolmuş olabilir).`
        : `Bozuk kayıt dosyası ${brokenPath} olarak taşındı; yedek de bulunamadı, boş listeyle başlanıyor.`,
    );
  }
}
for (const job of jobs) {
  if (job.restrictionNotification?.status === 'sending')
    job.restrictionNotification = {
      status: 'unknown',
      message:
        'Sunucu bildirim sırasında kapandı. SendGrid kayıtlarını kontrol edin; otomatik tekrar gönderilmez.',
    };
  for (const row of job.rows) Object.assign(row, profileSignals(row.bio));
  if (['running', 'stopping'].includes(job.status)) {
    job.status = 'interrupted';
    job.message =
      'Sunucu kapandığı için yarıda kaldı. Kaydedilen sonuçlar korunuyor.';
  }
}
let saveQueue = Promise.resolve();
function save() {
  const json = JSON.stringify(jobs);
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      await writeFile('.local/jobs.tmp', json, { mode: 0o600 });
      await rename('.local/jobs.tmp', '.local/jobs.json');
    });
  return saveQueue;
}
await save();
let active = null;
const send = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
};
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new Error('Dosya en fazla 2 MB olabilir.');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
async function run(job, controller) {
  const signal = controller.signal;
  const platform = job.platform || 'instagram';
  const collector = platform === 'tiktok' ? tiktok : instagram;
  const listCollector = platform === 'tiktok' ? tiktokBridge : instagram;
  // Read once so the fame threshold used to pre-skip candidates and the one
  // used to flag them after a full visit stay consistent for this run, even
  // if Bağlantılar is edited mid-scan.
  const candidateSettings = settings();
  // Elenen adayları da (fotoğraf + sebep ile) görünür tut, sonradan yalnızca
  // hedef listeden değil bu kayıttan da kaldırılabilsin. source tags which
  // filter stage excluded a candidate — only 'ai' ones are worth a cheap
  // re-screen later (see /rescreen-excluded); the others are deterministic
  // and re-running them changes nothing.
  const recordExcluded = (u, info, reason, source) => {
    job.excludedCandidates = {
      ...job.excludedCandidates,
      [u.toLowerCase()]: {
        username: u,
        fullName: info?.fullName || null,
        photoUrl: info?.photoUrl || info?.photos?.[0] || null,
        reason,
        source,
      },
    };
  };
  try {
    const ensureLogin = async () => {
      if (platform === 'tiktok') return;
      await instagram.recover(() => instagram.prepare());
      if (process.env.IG_HEADLESS === 'true') await instagram.browser();
      if (!(await instagram.loggedIn())) {
        const e = new Error(
          'Önce Instagram oturumunu açın. Şifrenizi açılan Instagram penceresine girin.',
        );
        e.blocked = true;
        throw e;
      }
    };
    // Only requires resumeRequested, not a non-empty remainingUsers: a job
    // interrupted before its first source finished reading has nothing in
    // remainingUsers yet, but resumeRequested still means "keep sourcesDone
    // and sourceLists, don't reset and re-read everything from scratch."
    const resuming = job.resumeRequested;
    job.resumeRequested = false;
    if (!resuming) {
      job.cachedCount = 0;
      job.sourceLists = {};
      job.sourcesDone = [];
    }
    // Sources already fully read (this run or an earlier one, before a stop)
    // are skipped on resume instead of being re-read from scratch — this is
    // what makes a scan stopped mid-discovery (not just mid-visit) resumable.
    const sourcesDone = new Set(job.sourcesDone || []);
    const targets = new Set(resuming ? job.remainingUsers : []);
    // discoveredUsers is the running total across the job's whole life
    // (including already-visited users); targets only ever holds users not
    // yet visited, so this merges rather than overwrites.
    const addDiscovered = (users) => {
      job.discoveredUsers = [
        ...new Set([...(job.discoveredUsers || []), ...users]),
      ];
    };
    if (resuming) job.message = 'Kalan kullanıcılarla devam ediliyor…';
    if (job.mode === 'search') {
      for (const term of job.sources) {
        if (sourcesDone.has(term)) continue;
        signal.throwIfAborted();
        if (targets.size >= 5000) break;
        job.message = 'TikTok araması: ' + term;
        await save();
        const result = await tiktokBridge.search(
          term,
          Math.min(job.limit, 5000 - targets.size),
          signal,
          (count) => {
            job.message = term + ': ' + count + ' hesap bulundu';
          },
        );
        result.users.forEach((handle) => targets.add(handle));
        addDiscovered(targets);
        sourcesDone.add(term);
        job.sourcesDone = [...sourcesDone];
        await save();
        if (result.warning) job.warnings.push(term + ': ' + result.warning);
      }
    } else if (job.mode === 'following') {
      for (const source of job.sources) {
        if (sourcesDone.has(source)) continue;
        signal.throwIfAborted();
        if (targets.size >= 5000) {
          job.warnings.push(
            'Toplam 5.000 farklı hesap sınırına ulaşıldı; kalan kaynaklar açılmadı.',
          );
          break;
        }
        job.message = `@${source} takip listesi açılıyor…`;
        await save();
        try {
          let result = cachedFollowing(
            jobs.filter((j) => j.id !== job.id),
            source,
            job.limit,
            platform,
          );
          if (!result) {
            await ensureLogin();
            result = await listCollector.following(
              source,
              job.limit,
              signal,
              (count) => {
                job.message = `@${source}: ${count} hesap bulundu…`;
              },
              async (counts) => {
                job.warnings.push(
                  ...sourceLimitWarnings(
                    source,
                    counts.followers,
                    counts.following,
                    job.limit,
                  ),
                );
                await save();
              },
              titlePrefixFilterFor(job, candidateSettings),
            );
          } else {
            job.warnings.push(
              ...sourceLimitWarnings(
                source,
                result.followers,
                result.following,
                job.limit,
              ),
            );
          }
          job.sourceLists[source] = { ...result, requestedLimit: job.limit };
          job.candidates = { ...job.candidates, ...result.candidates };
          // The scan's own AI assessment (job.model) is a separate, manually
          // triggered step run after scanning; it's unset during a live scan.
          // This pre-screen instead checks the app-wide OpenAI connection
          // configured in Bağlantılar, independent of that later step.
          const aiConfig = candidateSettings;
          const screenByPhoto = platform === 'instagram' && aiConfig.openaiKey;
          const titlePrefix = titlePrefixFilterFor(job, aiConfig);
          // Cheap, synchronous filters first (free, no network at all).
          // rejected: usernames the user (or AI) already marked "Uygun
          // değil" in any earlier job — recomputed per source so a
          // rejection made earlier in this same multi-source scan counts
          // too, not just past jobs.
          const rejected = rejectedUsernames(jobs, platform);
          const excludedUsernames = excludedUsernameSet(
            aiConfig.excludedUsernames,
          );
          const pending = [];
          for (const u of result.users) {
            if (targets.size + pending.length >= 5000) break;
            const info = job.candidates?.[u.toLowerCase()];
            if (excludedUsernames.has(u.toLowerCase())) {
              recordExcluded(
                u,
                info,
                'Hariç tutulacak kullanıcılar listesinde.',
                'excluded-list',
              );
              continue;
            }
            if (rejected.has(u.toLowerCase())) {
              recordExcluded(
                u,
                info,
                'Daha önce "Uygun değil" olarak işaretlenmiş.',
                'previously-rejected',
              );
              continue;
            }
            if (titlePrefix.test(info?.fullName || '')) {
              recordExcluded(u, info, 'Unvan öneki nedeniyle elendi.', 'title');
              continue;
            }
            // Gizli hesaplar takip listesinden anlaşılıyor; hiç ziyaret
            // edilmeden sonuç listesine de yazılmasın.
            if (info?.private === true) {
              recordExcluded(u, info, 'Kilitli (gizli) hesap.', 'private');
              continue;
            }
            // Read from Instagram's own hover-preview card (see instagram.mjs)
            // when available, so this skip happens before any profile visit.
            if (typeof info?.followers === 'number') {
              if (info.followers > aiConfig.fameFollowerThreshold) {
                recordExcluded(
                  u,
                  info,
                  `${aiConfig.fameFollowerThreshold.toLocaleString('tr-TR')}+ takipçili (ünlü olarak değerlendirildi).`,
                  'fame',
                );
                continue;
              }
              if (info.followers < aiConfig.minFollowerThreshold) {
                recordExcluded(
                  u,
                  info,
                  `${aiConfig.minFollowerThreshold.toLocaleString('tr-TR')} takipçi altında (minimum eşiğin altında).`,
                  'min',
                );
                continue;
              }
            }
            pending.push({ u, info });
          }
          // AI screening never touches Instagram (only OpenAI), so running
          // several at once is free of the pacing/detection concerns that
          // keep profile visits sequential — just a handful in flight so a
          // single source's screening doesn't take one call per candidate.
          const excluded = new Map();
          if (screenByPhoto && pending.length) {
            let done = 0;
            const concurrency = Math.min(6, pending.length);
            const next = pending.values();
            const worker = async () => {
              for (const { u, info } of next) {
                signal.throwIfAborted();
                // On OpenAI rate limiting (429), wait and retry the same
                // candidate a few times before giving up on it — other
                // workers' lanes keep progressing meanwhile.
                for (let attempt = 0; ; attempt++) {
                  try {
                    // The real profile photo (from Instagram's own following-
                    // list data) is what determines whether the account
                    // *looks like* a person — a post thumbnail can be a
                    // screenshot, product shot or quote card that has
                    // nothing to do with the account owner's appearance, and
                    // wrongly excluding on that basis was the bug here.
                    const screen = await screenPhoto(
                      info?.fullName,
                      info?.photoUrl || info?.photos?.[0],
                      aiConfig,
                      signal,
                    );
                    if (screen.isPerson === false)
                      excluded.set(u, {
                        reason:
                          'Fotoğrafta gerçek bir kişi tespit edilemedi (AI).',
                        source: 'ai-person',
                      });
                    else if (
                      aiConfig.genderExclude !== 'kapalı' &&
                      screen.genderGuess === aiConfig.genderExclude
                    )
                      excluded.set(u, {
                        reason: `Cinsiyet tahmini "${aiConfig.genderExclude}" ile eşleşti (AI, kesin değil).`,
                        source: 'ai-gender',
                      });
                    break;
                  } catch (e) {
                    if (signal.aborted) throw e;
                    if (e.status === 429 && attempt < 3) {
                      await delay(1000 * 2 ** attempt, null, { signal });
                      continue;
                    }
                    // Not rate-limited, or retries exhausted: fall through
                    // and include the candidate for a full read rather than
                    // blocking the source on one persistent failure.
                    break;
                  }
                }
                done++;
                job.message = `@${source}: adaylar taranıyor (${done}/${pending.length})…`;
                await save();
              }
            };
            await Promise.all(
              Array.from({ length: concurrency }, () => worker()),
            );
          }
          for (const { u, info } of pending) {
            const entry = excluded.get(u);
            if (entry) {
              recordExcluded(u, info, entry.reason, entry.source);
              continue;
            }
            if (targets.size >= 5000) break;
            targets.add(u);
          }
          addDiscovered(targets);
          await save();
          if (targets.size >= 5000 && job.sources.length > 1)
            job.warnings.push(
              'Bu taramada toplam en fazla 5.000 farklı profil incelenir.',
            );
          if (result.warning) job.warnings.push(result.warning);
          sourcesDone.add(source);
          job.sourcesDone = [...sourcesDone];
        } catch (e) {
          if (signal.aborted || e.blocked) throw e;
          job.warnings.push(`@${source}: ${e.message}`);
          sourcesDone.add(source);
          job.sourcesDone = [...sourcesDone];
        }
      }
    } else if (!resuming) {
      job.sources.forEach((s) => targets.add(s));
      addDiscovered(targets);
    }
    job.remainingUsers = [...targets];
    job.total = job.done + targets.size;
    await save();
    if (!targets.size)
      throw new Error(
        job.warnings.length
          ? `Takip listesi alınamadı. ${job.warnings[0]}`
          : 'Takip listesi boş; incelenecek hesap bulunamadı.',
      );
    // Each run() start (fresh or resumed) is already a natural gap, so the
    // clock for the next rest break starts here rather than being persisted
    // across runs.
    let lastBreakAt = Date.now();
    for (const handle of targets) {
      signal.throwIfAborted();
      if (
        candidateSettings.restBreakEnabled &&
        Date.now() - lastBreakAt >=
          candidateSettings.restBreakEveryMinutes * 60_000
      ) {
        const mins = candidateSettings.restBreakDurationMinutes;
        job.message = `Dinlenme molası (${mins} dk) — sonra @${handle} ile devam edilecek…`;
        await save();
        await delay(mins * 60_000, null, { signal });
        lastBreakAt = Date.now();
      }
      job.message = `@${handle} inceleniyor (${job.done + 1}/${job.total})`;
      let row;
      try {
        row = cachedProfile(
          jobs.filter((j) => j.id !== job.id),
          handle,
          platform,
        );
        if (row) job.cachedCount++;
        else if (job.candidates?.[handle.toLowerCase()]?.private === true) {
          row = {
            username: handle,
            email: null,
            followers: null,
            following: null,
            private: true,
            bio: null,
            ai: null,
            error:
              'Takip listesinden gizli hesap olarak tespit edildi; profil ziyaret edilmedi.',
            collectedAt: new Date().toISOString(),
            reused: true,
          };
        } else {
          await ensureLogin();
          row = await collector.profile(handle, signal);
        }
        if (job.model) {
          try {
            row.ai = await assess(row, job.model, signal);
          } catch (e) {
            if (signal.aborted) throw e;
            row.aiError = e.message;
          }
        } else if (
          candidateSettings.autoAssess &&
          (row.email || row.dmForCollaboration) &&
          (job.autoAssessedCount || 0) < candidateSettings.autoAssessLimit
        ) {
          // Bağlantılar → "Otomatik AI değerlendirmesi": profiles with an
          // email or DM-collaboration signal get their suitability verdict
          // right here instead of needing a separate manual pass afterward.
          // Capped per job so an unattended multi-account run can't rack up
          // unbounded OpenAI spend/time.
          try {
            row.ai = await assess(row, candidateSettings, signal);
            job.autoAssessedCount = (job.autoAssessedCount || 0) + 1;
          } catch (e) {
            if (signal.aborted) throw e;
            row.aiError = e.message;
          }
        }
      } catch (e) {
        if (platform === 'tiktok') e.blocked = true;
        if (!signal.aborted && e.partialProfile) {
          job.rows = job.rows.filter((r) => r.username !== handle);
          job.rows.push(e.partialProfile);
          await save();
        }
        if (signal.aborted || e.blocked) throw e;
        row = {
          username: handle,
          email: null,
          followers: null,
          following: null,
          private: null,
          bio: null,
          ai: null,
          error: e.message,
          collectedAt: new Date().toISOString(),
        };
      }
      if (job.mode === 'profiles')
        job.warnings.push(
          ...sourceLimitWarnings(handle, row.followers, null, job.limit),
        );
      if (
        typeof row.followers === 'number' &&
        row.followers > candidateSettings.fameFollowerThreshold
      )
        // Informational only — the profile was read successfully, this just
        // flags it as over the fame threshold. Kept off row.error so it
        // doesn't look like a failed read or push the job into "partial".
        row.note = `${candidateSettings.fameFollowerThreshold.toLocaleString('tr-TR')}+ takipçili (ünlü olarak değerlendirildi).`;
      row.platform = platform;
      job.rows = job.rows.filter((r) => r.username !== handle);
      job.rows.push(row);
      job.done++;
      job.remainingUsers = job.remainingUsers.filter((h) => h !== handle);
      await save();
      if (!row.reused && job.done < job.total)
        // Randomized instead of a fixed interval so the pacing between
        // profile visits doesn't look like a mechanically regular script.
        await delay(3000 + Math.floor(Math.random() * 5000), null, {
          signal,
        });
    }
    // Warnings (following-list truncation, follower-count notes, etc.) stay
    // visible in "Tarama notları" regardless — they no longer downgrade the
    // headline status, which now reflects actual per-profile read failures
    // only. Otherwise routine, expected notices made nearly every scan read
    // "partial" even when every profile was collected successfully.
    job.status = job.rows.some((r) => r.error || r.aiError)
      ? 'partial'
      : 'completed';
    job.message = `${job.done} hesap işlendi; ${job.cachedCount} profil kayıtlı veriden kullanıldı.${job.status === 'partial' ? ' Eksik alanlar ve tarama notlarını inceleyin.' : ''}`;
  } catch (e) {
    if (e.restrictedUntil) job.restrictedUntil = e.restrictedUntil;
    job.status = signal.aborted
      ? 'cancelled'
      : e.blocked
        ? 'blocked'
        : 'failed';
    job.message = signal.aborted
      ? 'Tarama durduruldu. Toplanan sonuçlar kaydedildi.'
      : e.message;
    if (e.restrictedUntil && !signal.aborted)
      await notifyRestriction(job, settings(), save);
  } finally {
    job.finishedAt = new Date().toISOString();
    try {
      await save();
    } finally {
      active = null;
    }
  }
}
async function reanalyze(job, model, controller, handles) {
  try {
    job.done = 0;
    const targets = job.rows.filter((row) => handles.includes(row.username));
    job.total = targets.length;
    for (const row of targets) {
      controller.signal.throwIfAborted();
      job.message = `@${row.username} için AI değerlendirmesi…`;
      if (row.bio !== null) {
        try {
          row.ai = await assess(row, model, controller.signal);
          row.aiError = null;
        } catch (e) {
          if (controller.signal.aborted) throw e;
          row.aiError = e.message;
        }
      }
      job.done++;
      await save();
    }
    // Warnings (following-list truncation, follower-count notes, etc.) stay
    // visible in "Tarama notları" regardless — they no longer downgrade the
    // headline status, which now reflects actual per-profile read failures
    // only. Otherwise routine, expected notices made nearly every scan read
    // "partial" even when every profile was collected successfully.
    job.status = job.rows.some((r) => r.error || r.aiError)
      ? 'partial'
      : 'completed';
    job.message = 'AI değerlendirmesi tamamlandı.';
  } catch (e) {
    job.status = controller.signal.aborted ? 'cancelled' : 'failed';
    job.message = controller.signal.aborted
      ? 'AI değerlendirmesi durduruldu.'
      : e.message;
  } finally {
    job.finishedAt = new Date().toISOString();
    try {
      await save();
    } finally {
      active = null;
    }
  }
}
// Re-runs the AI photo/gender screen for candidates it previously excluded
// (source: 'ai' only — title/private/threshold exclusions are deterministic
// and re-running them changes nothing). Uses the photo/name already saved
// in job.candidates from the original scan, so it never re-visits Instagram
// — this exists specifically so a photo-priority fix like the one that
// caused this screen to look at post thumbnails instead of the real profile
// photo can be applied to a job's already-excluded candidates without
// re-scanning the whole following list.
async function rescreenExcluded(job, controller) {
  const signal = controller.signal;
  try {
    const aiConfig = settings();
    if (!aiConfig.openaiKey)
      throw new Error('Bağlantılar bölümünde OpenAI API key ayarlayın.');
    const entries = Object.entries(job.excludedCandidates || {}).filter(
      ([, c]) => c.source?.startsWith('ai'),
    );
    job.done = 0;
    job.total = entries.length;
    let restored = 0;
    const targets = new Set(job.remainingUsers || []);
    const next = entries.values();
    const worker = async () => {
      for (const [key, candidate] of next) {
        signal.throwIfAborted();
        const info = job.candidates?.[key];
        const photo = info?.photoUrl || info?.photos?.[0] || candidate.photoUrl;
        for (let attempt = 0; ; attempt++) {
          try {
            const screen = await screenPhoto(
              candidate.fullName,
              photo,
              aiConfig,
              signal,
            );
            const stillExcluded =
              screen.isPerson === false ||
              (aiConfig.genderExclude !== 'kapalı' &&
                screen.genderGuess === aiConfig.genderExclude);
            if (!stillExcluded) {
              const rest = { ...job.excludedCandidates };
              delete rest[key];
              job.excludedCandidates = rest;
              targets.add(candidate.username);
              restored++;
            }
            break;
          } catch (e) {
            if (signal.aborted) throw e;
            if (e.status === 429 && attempt < 3) {
              await delay(1000 * 2 ** attempt, null, { signal });
              continue;
            }
            // Leave it excluded; a later rescreen can retry.
            break;
          }
        }
        job.done++;
        job.message = `Elenenler yeniden taranıyor (${job.done}/${job.total})…`;
        await save();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(6, entries.length) || 1 }, () => worker()),
    );
    job.remainingUsers = [...targets];
    job.discoveredUsers = [
      ...new Set([...(job.discoveredUsers || []), ...targets]),
    ];
    job.status = job.rows.some((r) => r.error || r.aiError)
      ? 'partial'
      : 'completed';
    job.message = restored
      ? `Elenenler yeniden tarandı; ${restored} aday geri eklendi. Taramayı "Devam et" ile sürdürüp bu adayları ziyaret edebilirsiniz.`
      : 'Elenenler yeniden tarandı; geri eklenen aday olmadı.';
  } catch (e) {
    job.status = signal.aborted ? 'cancelled' : 'failed';
    job.message = signal.aborted ? 'Yeniden tarama durduruldu.' : e.message;
  } finally {
    job.finishedAt = new Date().toISOString();
    try {
      await save();
    } finally {
      active = null;
    }
  }
}

const queue = await new WorkQueue(
  '.local',
  async (task, controller) => {
    controller.signal.throwIfAborted();
    const actor = auth.users.find((u) => u.id === task.ownerId && !u.disabled);
    if (!actor) throw new Error('İş sahibi devre dışı veya bulunamadı.');
    if (task.kind === 'email') {
      const sender = resolveSender(actor, task.payload.fromEmail, settings());
      if (
        sender.replyTo !== task.payload.replyTo ||
        sender.fromName !== task.payload.fromName
      )
        throw new Error(
          'Gönderen bilgileri değişti; emaili yeniden önizleyin.',
        );
      return outreach.sendMessages(
        task.payload.messages,
        sender,
        controller.signal,
      );
    }
    const job = jobs.find((j) => j.id === task.jobId);
    if (!job) throw new Error('Tarama bulunamadı.');
    if (task.kind === 'scan') {
      const until = Math.max(
        0,
        ...jobs
          .filter((j) => (j.platform || 'instagram') === task.platform)
          .map((j) => j.restrictedUntil || 0),
      );
      const needs =
        job.mode === 'search' ||
        needsInstagram(jobs, job.sources, job.mode, job.limit, task.platform);
      if (until > Date.now() && needs) {
        job.status = 'blocked';
        job.message =
          'Platform kısıtı nedeniyle iş çalıştırılmadı. Kısıt kalkınca yeni iş oluşturun.';
        await save();
        throw Object.assign(new Error(job.message), { blocked: true });
      }
    }
    active = { id: job.id, controller };
    job.status = 'running';
    try {
      await save();
    } catch (e) {
      active = null;
      throw e;
    }
    if (task.kind === 'scan') await run(job, controller);
    else if (task.kind === 'rescreen') await rescreenExcluded(job, controller);
    else {
      const config =
        task.payload.provider === 'ollama' ? task.payload.model : settings();
      await reanalyze(job, config, controller, task.payload.handles);
    }
    if (['failed', 'blocked'].includes(job.status))
      throw Object.assign(new Error(job.message), {
        blocked: job.status === 'blocked',
      });
    return { status: job.status, processed: job.rows.length };
  },
  async (task) => {
    if (task.kind === 'email') await outreach.release(task.payload.messages);
    else {
      const job = jobs.find((j) => j.id === task.jobId);
      if (job?.status === 'queued') {
        job.status = task.status;
        job.message = task.error || 'Kuyruktaki iş iptal edildi.';
        await save();
      }
    }
  },
).init();
for (const c of outreach.state.contacts) {
  if (
    c.status === 'queued' &&
    !queue.tasks.some(
      (t) =>
        t.status === 'queued' &&
        t.kind === 'email' &&
        t.payload.messages.some((m) => m.id === c.id),
    )
  )
    c.status = 'draft';
}
for (const job of jobs) {
  if (
    job.status === 'queued' &&
    !queue.tasks.some((t) => t.jobId === job.id && t.status === 'queued')
  ) {
    job.status = 'interrupted';
    job.message = 'Kuyruk kaydı bulunamadı; otomatik yeniden başlatılmadı.';
  }
}
await save();
await outreach.save();
const queueTimer = setInterval(() => {
  void queue.drain().catch(console.error);
}, 1000);
// Lets an unattended, multi-account run recover on its own from the two
// things that otherwise leave a scan sitting blocked until a human notices:
// every account's daily quota being hit (clears at midnight) and an
// Instagram restriction expiring. Rather than duplicating the blocking
// checks the queue worker already does at dispatch time, this just retries
// — if still actually blocked, the worker immediately re-blocks it, so this
// can never resume something that isn't really ready.
async function autoResumeBlocked() {
  for (const job of jobs) {
    // 'blocked' = quota/restriction; 'interrupted' = server restart or a
    // recovered uncaughtException (see the handler above) — both are
    // abnormal stops worth automatically retrying, not just the first kind.
    if (
      !['blocked', 'interrupted'].includes(job.status) ||
      !hasResumableWork(job)
    )
      continue;
    if (
      queue.tasks.some(
        (t) =>
          t.jobId === job.id &&
          ['queued', 'running', 'stopping'].includes(t.status),
      )
    )
      continue;
    const lastTask = queue.tasks
      .filter((t) => t.jobId === job.id && t.kind === 'scan')
      .at(-1);
    if (!lastTask) continue;
    job.resumeRequested = true;
    job.status = 'queued';
    try {
      await save();
      await queue.enqueue({
        kind: 'scan',
        jobId: job.id,
        ownerId: lastTask.ownerId,
        ownerName: lastTask.ownerName,
        platform: lastTask.platform,
        title: 'Otomatik devam · ' + lastTask.title,
      });
    } catch {
      job.status = 'blocked';
      await save();
    }
  }
}
const autoResumeTimer = setInterval(
  () => void autoResumeBlocked().catch(console.error),
  60 * 60_000,
);
void autoResumeBlocked().catch(console.error);

const server = http.createServer(async (req, res) => {
  try {
    // Loopback binding + Host/Origin checks protect local sessions from other websites.
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || ''))
      return send(res, 403, { error: 'Geçersiz sunucu adresi.' });
    if (req.url?.startsWith('/api/tiktok/bridge/')) {
      if (
        req.method !== 'POST' ||
        !req.headers['content-type']?.startsWith('application/json')
      )
        return send(res, 415, { error: 'JSON POST bekleniyor.' });
      if (!tiktokBridge.authenticate(req))
        return send(res, 401, { error: 'Eklenti eşleştirmesi geçersiz.' });
      const input = await body(req);
      if (!tiktokBridge.authenticate(req))
        return send(res, 401, { error: 'Eşleştirme değişti.' });
      if (req.url === '/api/tiktok/bridge/poll')
        return send(
          res,
          200,
          await tiktokBridge.poll(
            input.clientId,
            req.headers['x-hiwell-extension'],
          ),
        );
      if (req.url === '/api/tiktok/bridge/result')
        return send(res, 200, tiktokBridge.finish(input.clientId, input));
      if (req.url === '/api/tiktok/bridge/disconnect') {
        tiktokBridge.disconnect(input.clientId);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Eklenti işlemi bulunamadı.' });
    }
    const origin = req.headers.origin;
    if (
      (origin || req.method === 'POST') &&
      !allowedOrigin(origin, port, lanOrigin)
    )
      return send(res, 403, {
        error: 'Yalnızca izin verilen uygulama adresinden erişebilirsiniz.',
      });
    if (
      req.method === 'POST' &&
      !req.headers['content-type']?.startsWith('application/json')
    )
      return send(res, 415, { error: 'JSON bekleniyor.' });
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    const user = auth.user(req);
    if (req.method === 'GET' && route === '/api/auth/me')
      return send(res, 200, { user: user ? publicUser(user) : null });
    if (req.method === 'POST' && route === '/api/auth/login')
      return send(res, 200, {
        user: await auth.login(await body(req), req, res),
      });
    if (req.method === 'POST' && route === '/api/auth/logout') {
      auth.logout(req, res);
      return send(res, 200, { ok: true });
    }
    if (!user)
      return send(res, 401, {
        error: 'Oturumunuz sona erdi. Lütfen giriş yapın.',
      });
    if (req.method === 'POST' && route === '/api/auth/password') {
      auth.throttle(`password:${user.id}`, 5);
      const result = await auth.change(user, await body(req));
      auth.cookie(res);
      return send(res, 200, result);
    }
    if (user.mustChangePassword)
      return send(res, 403, {
        error: 'Devam etmek için geçici şifrenizi değiştirin.',
      });
    if (
      (route === '/api/settings' ||
        route === '/api/settings/test-email' ||
        route === '/api/settings/test-notification' ||
        route === '/api/tiktok/pair' ||
        route === '/api/login' ||
        route.startsWith('/api/users')) &&
      user.role !== 'admin'
    )
      return send(res, 403, {
        error: 'Bu işlem yalnızca admin tarafından yapılabilir.',
      });
    if (req.method === 'GET' && route === '/api/users')
      return send(res, 200, { users: auth.users.map(publicUser) });
    if (req.method === 'POST' && route === '/api/users')
      return send(res, 200, await auth.manage(await body(req)));
    if (req.method === 'GET' && route === '/api/settings/test-email')
      return send(res, 200, { latest: testEmail.latest() });
    if (req.method === 'POST' && route === '/api/settings/test-email')
      return send(res, 200, await testEmail.send(await body(req), settings()));
    if (req.method === 'POST' && route === '/api/settings/test-notification')
      return send(res, 200, await notifyTest(settings()));
    if (req.method === 'GET' && route === '/api/settings')
      return send(res, 200, publicSettings());
    if (req.method === 'POST' && route === '/api/settings')
      return send(res, 200, await updateSettings(await body(req)));
    if (req.method === 'POST' && route === '/api/tiktok/pair') {
      if (queue.current)
        return send(res, 409, {
          error: 'Eşleştirmeden önce çalışan işi durdurun.',
        });
      const input = await body(req);
      return send(res, 200, await tiktokBridge.pair(input.revoke === true));
    }
    if (req.method === 'GET' && route === '/api/queue')
      return send(res, 200, {
        tasks: queue.snapshot().map((t) => {
          const job = jobs.find((j) => j.id === t.jobId);
          const remaining = job?.remainingUsers?.length || 0;
          // Only set when remaining is 0 but there's still real work left
          // (see hasResumableWork) — an interrupted-before-first-source scan
          // has unread sources, not queued profiles, to show as "left".
          const sourcesLeft =
            job && !remaining && ['following', 'search'].includes(job.mode)
              ? job.sources.filter((s) => !(job.sourcesDone || []).includes(s))
                  .length
              : 0;
          return {
            ...t,
            remaining,
            sourcesLeft,
            // Not gated on t.status: a completed scan can still gain
            // remainingUsers later (e.g. a candidate restored by
            // rescreen-excluded), and that should be resumable too, not
            // just scans that stopped early.
            canResume:
              t.kind === 'scan' &&
              !!job &&
              hasResumableWork(job) &&
              !queue.tasks.some(
                (other) =>
                  other.jobId === t.jobId &&
                  ['queued', 'running', 'stopping'].includes(other.status),
              ),
          };
        }),
      });
    if (
      req.method === 'POST' &&
      /^\/api\/queue\/[a-f0-9-]+\/cancel$/.test(route)
    ) {
      await queue.cancel(route.split('/')[3], user);
      return send(res, 200, { ok: true });
    }
    if (
      req.method === 'POST' &&
      /^\/api\/queue\/[a-f0-9-]+\/resume$/.test(route)
    ) {
      const task = queue.tasks.find((t) => t.id === route.split('/')[3]);
      if (!task || task.kind !== 'scan')
        throw new Error('Devam ettirilecek tarama bulunamadı.');
      if (user.role !== 'admin' && task.ownerId !== user.id)
        return send(res, 403, {
          error: 'Yalnızca iş sahibi veya admin devam ettirebilir.',
        });
      const job = jobs.find((j) => j.id === task.jobId);
      if (!job || !hasResumableWork(job))
        throw new Error('Devam ettirilecek bir şey yok.');
      if (
        queue.tasks.some(
          (t) =>
            t.jobId === job.id &&
            ['queued', 'running', 'stopping'].includes(t.status),
        )
      )
        throw new Error('Bu iş zaten kuyrukta.');
      job.resumeRequested = true;
      job.status = 'queued';
      try {
        await save();
        await queue.enqueue({
          kind: 'scan',
          jobId: job.id,
          ownerId: task.ownerId,
          ownerName: task.ownerName,
          platform: task.platform,
          title: 'Devam · ' + task.title,
        });
      } catch (e) {
        job.status = 'interrupted';
        await save();
        throw e;
      }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && route === '/api/performance')
      return send(
        res,
        200,
        performanceReport(
          jobs,
          queue.tasks,
          outreach.state.contacts,
          auth.users,
          outreach.state.deliveries,
        ),
      );
    if (route === '/api/instagram/accounts') {
      if (user.role !== 'admin')
        return send(res, 403, { error: 'Yalnızca admin.' });
      if (req.method === 'GET')
        return send(res, 200, instagramAccounts.snapshot());
      if (req.method === 'POST') {
        if (active)
          throw new Error('Hesap ayarları için önce taramayı durdurun.');
        const input = await body(req);
        const result = await instagramAccounts.update(input);
        // Proxy/password changes only take effect on the next browser launch;
        // close the open session for this account so that happens now.
        if (
          !['switch', 'options'].includes(input.action) &&
          input.id &&
          input.id === instagram.sessionAccountId
        )
          await instagram.context?.close().catch(() => {});
        return send(res, 200, result);
      }
    }
    if (
      req.method === 'POST' &&
      route === '/api/instagram/accounts/test-proxy'
    ) {
      if (user.role !== 'admin')
        return send(res, 403, { error: 'Yalnızca admin.' });
      const input = await body(req);
      const server = String(input.server || '').trim();
      if (!server) throw new Error('Proxy adresi girin.');
      let parsed;
      try {
        parsed = new URL(server);
      } catch {
        throw new Error('Proxy adresi geçersiz. Örnek: http://host:port');
      }
      if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(parsed.protocol))
        throw new Error('Proxy şeması http, https, socks5 veya socks4 olmalı.');
      await instagram.testProxy({
        server: `${parsed.protocol}//${parsed.host}`,
        ...(input.username
          ? {
              username: String(input.username),
              password: String(input.password || ''),
            }
          : {}),
      });
      return send(res, 200, { ok: true });
    }
    const genPostMatch = route.match(
      /^\/api\/instagram\/accounts\/([a-f0-9-]+)\/generate-post$/,
    );
    if (req.method === 'POST' && genPostMatch) {
      if (user.role !== 'admin')
        return send(res, 403, { error: 'Yalnızca admin.' });
      const account = instagramAccounts
        .snapshot()
        .accounts.find((a) => a.id === genPostMatch[1]);
      if (!account) throw new Error('Hesap bulunamadı.');
      const base64 = await generatePost(
        account.persona,
        settings(),
        new AbortController().signal,
      );
      const dir = '.local/generated-posts';
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const filename = `${account.id}-${Date.now()}.png`;
      await writeFile(`${dir}/${filename}`, Buffer.from(base64, 'base64'), {
        mode: 0o600,
      });
      return send(res, 200, { image: `data:image/png;base64,${base64}` });
    }
    if (req.method === 'GET' && route === '/api/outreach/history-export') {
      const records = outreach
        .history(auth.users)
        .filter((d) => ['accepted', 'imported', 'unknown'].includes(d.status));
      const headers = [
        'Email',
        'İsim',
        'Durum',
        'Gönderen kullanıcı',
        'Gönderen adres',
        'Gönderim tarihi',
        'Kaynak',
        'Kaydı ekleyen',
        'İçe aktarım tarihi',
      ];
      const values = records.map((d) => [
        d.email,
        d.name,
        d.status,
        d.actorName,
        d.fromEmail || null,
        d.date,
        d.source,
        d.recordedByName,
        d.recordedAt || null,
      ]);
      if (url.searchParams.get('format') === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="email-gecmisi.csv"',
        });
        return res.end(
          '\uFEFF' +
            [headers, ...values]
              .map((r) => r.map(csvCell).join(','))
              .join('\r\n'),
        );
      }
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('Email geçmişi');
      sheet.addRow(headers);
      values.forEach((r) => sheet.addRow(r));
      sheet.columns.forEach((c) => (c.width = 28));
      res.writeHead(200, {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="email-gecmisi.xlsx"',
      });
      return res.end(Buffer.from(await book.xlsx.writeBuffer()));
    }
    if (req.method === 'GET' && route === '/api/outreach')
      return send(res, 200, {
        ...outreach.snapshot(),
        history: outreach.history(auth.users),
        contacts: outreach.snapshot().contacts.map((c) => ({
          ...c,
          senderName:
            auth.users.find((u) => u.id === c.lastMessage?.actorId)?.name ||
            null,
          fromEmail: c.lastMessage?.fromEmail || null,
        })),
        mailIdentity: senderIdentity(user, settings()),
      });
    if (req.method === 'POST' && route.startsWith('/api/outreach/')) {
      const b = await body(req);
      if (route === '/api/outreach/suppress') {
        const { rows, rejected } = parseContacts(b);
        return send(res, 200, {
          ...(await outreach.suppress(rows, user)),
          rejected,
        });
      }
      if (route === '/api/outreach/import') {
        const { rows, rejected } = parseContacts(b);
        const result = rows.length
          ? await outreach.add(rows, null)
          : { added: 0, skipped: [] };
        return send(res, 200, { ...result, rejected });
      }
      if (route === '/api/outreach/templates')
        return send(res, 200, await outreach.template(b));
      if (route === '/api/outreach/add') {
        const job = jobs.find((j) => j.id === b.jobId);
        if (!job) throw new Error('Tarama bulunamadı.');
        if (!Array.isArray(b.usernames) || !b.usernames.length)
          throw new Error('Listeye eklenecek hesapları seçin.');
        const rows = job.rows.filter((r) => b.usernames.includes(r.username));
        if (!rows.length) throw new Error('Seçilen hesaplar bulunamadı.');
        return send(res, 200, await outreach.add(rows, job.id, !!job.demo));
      }
      if (route === '/api/outreach/assign')
        return send(res, 200, await outreach.assign(b.ids, b.templateId));
      if (route === '/api/outreach/edit')
        return send(res, 200, await outreach.edit(b));
      if (route === '/api/outreach/archive')
        return send(res, 200, await outreach.archive(b.ids));
      if (route === '/api/outreach/preview')
        return send(
          res,
          200,
          outreach.preview(
            b.ids,
            resolveSender(
              auth.users.find((u) => u.id === user.id),
              b.fromEmail,
              settings(),
            ),
          ),
        );
      if (route === '/api/outreach/send') {
        const sender = resolveSender(
          auth.users.find((u) => u.id === user.id),
          b.fromEmail,
          settings(),
        );
        const messages = outreach.reserve(b.previewId, sender);
        try {
          await outreach.save();
          const task = await queue.enqueue({
            kind: 'email',
            ownerId: user.id,
            ownerName: user.name,
            platform: 'mixed',
            platforms: [
              ...new Set(
                messages.map(
                  (m) =>
                    outreach.state.contacts.find((c) => c.id === m.id)
                      ?.platform || 'instagram',
                ),
              ),
            ],
            title: messages.length + ' email gönderimi',
            payload: {
              messages,
              fromEmail: sender.fromEmail,
              fromName: sender.fromName,
              replyTo: sender.replyTo,
            },
          });
          return send(res, 202, { queued: true, taskId: task.id });
        } catch (e) {
          await outreach.release(messages);
          throw e;
        }
      }
    }
    if (req.method === 'GET' && route === '/api/photo') {
      // Instagram's CDN URLs (profile_pic_url etc.) are signed and expire —
      // a browser hotlinking them directly can show a broken image once the
      // signature is stale, or Instagram can reject a cross-origin fetch
      // outright. Proxying + caching here means the fetch happens once, from
      // our server (closer to a normal client than a browser <img> tag), and
      // every later view is served from disk regardless of the original
      // URL's fate.
      let target;
      try {
        target = new URL(url.searchParams.get('u') || '');
      } catch {
        return send(res, 400, { error: 'Geçersiz fotoğraf adresi.' });
      }
      if (
        target.protocol !== 'https:' ||
        !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(target.hostname)
      )
        return send(res, 400, {
          error: 'Yalnızca Instagram CDN adresleri desteklenir.',
        });
      const cacheKey = createHash('sha256').update(target.href).digest('hex');
      const cachePath = `.local/photo-cache/${cacheKey}.jpg`;
      try {
        const cached = await readFile(cachePath);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, max-age=604800',
        });
        return res.end(cached);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      try {
        const upstream = await fetch(target.href, {
          signal: AbortSignal.timeout(10000),
        });
        if (!upstream.ok) throw new Error('upstream ' + upstream.status);
        const bytes = Buffer.from(await upstream.arrayBuffer());
        await mkdir('.local/photo-cache', { recursive: true, mode: 0o700 });
        await writeFile(cachePath, bytes, { mode: 0o600 }).catch(() => {});
        res.writeHead(200, {
          'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
          'Cache-Control': 'private, max-age=604800',
        });
        return res.end(bytes);
      } catch {
        return send(res, 404, { error: 'Fotoğraf alınamadı.' });
      }
    }
    if (req.method === 'GET' && route === '/api/status')
      return send(res, 200, {
        tiktokBrowserOpen: !!tiktok.context,
        tiktokBridge: tiktokBridge.status(),
        loggedIn: await instagram.loggedIn(),
        browserOpen: !!instagram.context,
        networkOrigin: lanOrigin || null,
        models: await models(),
        activeJob: active?.id ?? null,
        queuedCount: queue.tasks.filter((t) => t.status === 'queued').length,
        openaiConfigured: publicSettings().openaiConfigured,
        openaiModel: publicSettings().openaiModel,
        restrictionActive: jobs.some(
          (j) =>
            (j.platform || 'instagram') === 'instagram' &&
            (j.restrictedUntil || 0) > Date.now(),
        ),
        restrictedUntil: Math.max(
          0,
          ...jobs
            .filter((j) => (j.platform || 'instagram') === 'instagram')
            .map((j) => j.restrictedUntil || 0),
        ),
      });
    if (req.method === 'POST' && route === '/api/login') {
      if (active)
        return send(res, 409, {
          error:
            'Tarama sırasında oturum penceresi açılamaz. Önce taramayı durdurun.',
        });
      const b = await body(req);
      const platform = platformName(b.platform);
      if (platform === 'tiktok')
        throw new Error(
          'TikTok için normal Chrome eklentisindeki Agent ekranını kullanın.',
        );
      await instagram.login();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && route === '/api/jobs')
      return send(
        res,
        200,
        jobs.map(({ rows, ...j }) => ({ ...j, count: rows.length })),
      );
    if (req.method === 'GET' && route === '/api/export-all') {
      // Strictly scoped to the scans the user picked — no implicit "export
      // everything" fallback, so an empty/missing selection is refused
      // rather than silently aggregating every job ever run.
      const jobIds = (url.searchParams.get('jobIds') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!jobIds.length)
        throw new Error('Dışa aktarmak için en az bir tarama seçin.');
      const selectedJobs = jobs.filter((j) => jobIds.includes(j.id));
      if (!selectedJobs.length)
        throw new Error('Seçilen taramalar bulunamadı.');
      // Every profile collected in the selected scans, deduped by
      // platform+username keeping the most recently collected copy — and
      // every candidate excluded pre-visit in those same scans, deduped the
      // same way.
      const excludedCategoryLabels = {
        title: 'Unvan öneki',
        private: 'Kilitli hesap',
        fame: 'Çok takipçili',
        min: 'Az takipçili',
        'ai-person': 'Gerçek kişi değil (AI)',
        'ai-gender': 'Cinsiyet (AI)',
        'previously-rejected': 'Daha önce uygun değil',
      };
      // Which single source account (within a job that may read several)
      // actually turned up this username — following-mode jobs record each
      // source's own discovered list in sourceLists, so this is precise
      // rather than just naming every source the job had.
      const sourceFor = (j, username) => {
        if (j.mode === 'following' && j.sourceLists) {
          for (const [source, list] of Object.entries(j.sourceLists))
            if (
              list.users?.some(
                (u) => u.toLowerCase() === username.toLowerCase(),
              )
            )
              return `@${source}`;
        }
        return j.sources.join(', ');
      };
      const rowsByKey = new Map();
      const excludedByKey = new Map();
      for (const j of selectedJobs) {
        if (j.demo) continue;
        for (const row of j.rows) {
          const key = `${row.platform || j.platform || 'instagram'}:${row.username.toLowerCase()}`;
          const prior = rowsByKey.get(key);
          if (
            !prior ||
            (Date.parse(row.collectedAt) || 0) >
              (Date.parse(prior.collectedAt) || 0)
          )
            rowsByKey.set(key, {
              ...row,
              sourceLabel: sourceFor(j, row.username),
            });
        }
        for (const [key, c] of Object.entries(j.excludedCandidates || {}))
          if (!excludedByKey.has(key))
            excludedByKey.set(key, {
              ...c,
              sourceLabel: sourceFor(j, c.username),
            });
      }
      const rows = [...rowsByKey.values()];
      const excluded = [...excludedByKey.values()];
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Taranan Profiller', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      sheet.addRow([
        'Kullanıcı adı',
        'Platform',
        'Tarama kaynağı',
        'Email',
        'Email durumu',
        'İş birliği için DM',
        'DM kanıtı',
        'Takipçi',
        'Takip edilen',
        'Hesap durumu',
        'Bio dili',
        'AI değerlendirmesi',
        'AI gerekçesi',
        'Tarandığı tarih',
      ]);
      sheet.columns.forEach(
        (c, i) =>
          (c.width = [22, 12, 22, 32, 16, 10, 40, 12, 14, 14, 14, 18, 60, 22][
            i
          ]),
      );
      for (const row of rows) {
        const r = sheet.addRow([
          row.username,
          row.platform === 'tiktok' ? 'TikTok' : 'Instagram',
          row.sourceLabel || '',
          row.email || 'null',
          row.email ? 'Bulundu' : 'Bulunamadı',
          row.dmForCollaboration ? 'Evet' : 'Hayır',
          row.dmEvidence || '',
          row.followers ?? 'null',
          row.following ?? 'null',
          row.private === null
            ? 'Bilinmiyor'
            : row.private
              ? 'Kilitli'
              : 'Açık',
          row.language || 'Bilinmiyor',
          row.ai?.verdict || 'Değerlendirilmedi',
          row.ai?.reason || '',
          row.collectedAt || '',
        ]);
        r.getCell(1).value = {
          text: row.username,
          hyperlink: profileUrl(row.username, row.platform),
        };
        r.getCell(1).font = { color: { argb: 'FF146D62' }, underline: true };
        r.alignment = { vertical: 'top', wrapText: true };
      }
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF155B51' },
      };
      sheet.getRow(1).height = 28;
      sheet.autoFilter = { from: 'A1', to: 'N1' };
      const excludedSheet = workbook.addWorksheet('Elenen Adaylar', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      excludedSheet.addRow([
        'Kullanıcı adı',
        'İsim',
        'Eleme sebebi',
        'Kategori',
        'Tarama kaynağı',
      ]);
      excludedSheet.columns.forEach(
        (c, i) => (c.width = [22, 26, 60, 24, 22][i]),
      );
      for (const c of excluded) {
        const r = excludedSheet.addRow([
          c.username,
          c.fullName || '',
          c.reason,
          excludedCategoryLabels[c.source] || c.source || 'Diğer',
          c.sourceLabel || '',
        ]);
        r.getCell(1).value = {
          text: c.username,
          hyperlink: profileUrl(c.username, 'instagram'),
        };
        r.getCell(1).font = { color: { argb: 'FF146D62' }, underline: true };
        r.alignment = { vertical: 'top', wrapText: true };
      }
      excludedSheet.getRow(1).font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      excludedSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF8A2F2F' },
      };
      excludedSheet.getRow(1).height = 28;
      excludedSheet.autoFilter = { from: 'A1', to: 'E1' };
      const withEmail = rows.filter((r) => r.email).length;
      const withDm = rows.filter((r) => r.dmForCollaboration).length;
      const excludedByCategory = {};
      for (const c of excluded)
        excludedByCategory[c.source || 'other'] =
          (excludedByCategory[c.source || 'other'] || 0) + 1;
      const summary = workbook.addWorksheet('Özet');
      summary.columns = [{ width: 44 }, { width: 16 }];
      summary.addRow(['Toplam taranan profil', rows.length]).font = {
        bold: true,
      };
      summary.addRow(['Email bulunan', withEmail]);
      summary.addRow(['Email bulunamayan', rows.length - withEmail]);
      summary.addRow(['İş birliği için DM bulunan', withDm]);
      summary.addRow(['Toplam elenen aday', excluded.length]).font = {
        bold: true,
      };
      for (const [key, count] of Object.entries(excludedByCategory))
        summary.addRow([`  · ${excludedCategoryLabels[key] || key}`, count]);
      const file = await workbook.xlsx.writeBuffer();
      res.writeHead(200, {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition':
          'attachment; filename="hiwell-tum-kayitlar.xlsx"',
      });
      res.end(Buffer.from(file));
      return;
    }
    if (req.method === 'POST' && route === '/api/demo') {
      if (active)
        return send(res, 409, {
          error: 'Önce çalışan işlemin bitmesini bekleyin.',
        });
      const existing = jobs.find((j) => j.demo);
      if (existing) return send(res, 200, existing);
      const job = {
        id: randomUUID(),
        sources: ['ornek.hesap'],
        mode: 'profiles',
        limit: 6,
        model: null,
        rows: demoRows(),
        status: 'completed',
        done: 6,
        total: 6,
        message:
          'Örnek veri. Gerçek Instagram verisi veya gerçek AI yorumu içermez.',
        warnings: [],
        createdAt: new Date().toISOString(),
        demo: true,
      };
      jobs.unshift(job);
      await save();
      return send(res, 201, job);
    }
    if (req.method === 'POST' && route === '/api/tiktok/import') {
      const row = importTikTok(await body(req));
      const existing = jobs.find(
        (j) =>
          !j.demo &&
          j.platform === 'tiktok' &&
          j.rows.some((r) => r.username === row.username && !r.error),
      );
      if (existing) return send(res, 200, { job: existing, reused: true });
      const job = {
        id: randomUUID(),
        platform: 'tiktok',
        sources: [row.username],
        mode: 'import',
        limit: 1,
        model: null,
        rows: [row],
        status: 'completed',
        done: 1,
        total: 1,
        message: 'TikTok profili Chrome eklentisinden aktarıldı.',
        warnings: [
          row.bio === null ||
          row.followers === null ||
          row.following === null ||
          row.private === null
            ? 'Bazı profil alanları okunamadı; bilinmeyen değerler tahmin edilmedi.'
            : null,
        ].filter(Boolean),
        createdAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        importedBy: user.id,
        ownerId: user.id,
        ownerName: user.name,
      };
      jobs.unshift(job);
      await save();
      return send(res, 201, { job, reused: false });
    }
    if (req.method === 'POST' && route === '/api/parse') {
      const b = await body(req);
      return send(res, 200, {
        usernames: parseInput(b.text || '', !!b.csv, platformName(b.platform)),
      });
    }
    if (req.method === 'POST' && route === '/api/jobs') {
      const b = await body(req);
      const platform = platformName(b.platform);
      const sources =
        b.mode === 'search' && platform === 'tiktok'
          ? searchTerms(b.text || '')
          : parseInput(b.text || '', !!b.csv, platform);
      // Optional per-source "following" CSV column (see followingCounts) —
      // when present, smaller sources are read first so results and any
      // rest breaks land sooner instead of a huge source blocking everyone
      // behind it; absent entirely, this is a no-op and order is untouched.
      const orderedSources =
        b.mode === 'following' && b.csv
          ? sortSourcesByFollowing(
              sources,
              followingCounts(b.text || '', platform),
            )
          : sources;
      if (
        !(
          platform === 'tiktok'
            ? ['following', 'search', 'profiles']
            : ['following', 'profiles']
        ).includes(b.mode)
      )
        throw new Error('Geçersiz tarama türü.');
      const limit = Number(b.limit ?? 5000);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
        throw new Error('Kaynak başına sınır 1–5.000 olmalı.');
      if (b.market !== undefined && !MARKETS.includes(b.market))
        throw new Error('Geçersiz hedef pazar.');
      const market = MARKETS.includes(b.market) ? b.market : 'tr';
      const until = Math.max(
        0,
        ...jobs
          .filter((j) => (j.platform || 'instagram') === platform)
          .map((j) => j.restrictedUntil || 0),
      );
      if (
        until > Date.now() &&
        (b.mode === 'search' ||
          needsInstagram(jobs, orderedSources, b.mode, limit, platform))
      )
        return send(res, 429, {
          error: `${platform === 'tiktok' ? 'TikTok' : 'Instagram'} kısıtı nedeniyle ${new Date(until).toLocaleString('tr-TR')} tarihine kadar yeni tarama kapalı. Kısıtın kalktığını ayrıca kontrol edin.`,
        });
      const job = {
        id: randomUUID(),
        sources: orderedSources,
        platform,
        mode: b.mode,
        market,
        limit,
        model: null,
        rows: [],
        status: 'queued',
        ownerId: user.id,
        ownerName: user.name,
        done: 0,
        total: 0,
        message: 'Tarama hazırlanıyor…',
        warnings: [],
        createdAt: new Date().toISOString(),
      };
      jobs.unshift(job);
      try {
        await save();
        await queue.enqueue({
          kind: 'scan',
          jobId: job.id,
          ownerId: user.id,
          ownerName: user.name,
          platform,
          title: orderedSources.join(', ').slice(0, 120),
        });
      } catch (e) {
        jobs = jobs.filter((j) => j.id !== job.id);
        await save();
        throw e;
      }
      send(res, 201, job);
      return;
    }
    const match = route.match(
      /^\/api\/jobs\/([a-f0-9-]+)(?:\/(stop|export|analyze|usernames|rescreen-excluded|restore-excluded|mark-verdict))?$/,
    );
    if (match) {
      const job = jobs.find((j) => j.id === match[1]);
      if (!job) return send(res, 404, { error: 'Tarama bulunamadı.' });
      if (req.method === 'GET' && !match[2]) return send(res, 200, job);
      if (req.method === 'GET' && match[2] === 'usernames') {
        const handles = [
          ...new Set(
            job.discoveredUsers ||
              Object.values(job.sourceLists || {}).flatMap(
                (s) => s.users || [],
              ),
          ),
        ];
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="hiwell-usernames.csv"',
          'Cache-Control': 'no-store',
        });
        res.end('\uFEFF' + ['username', ...handles].map(csvCell).join('\r\n'));
        return;
      }

      if (req.method === 'POST' && match[2] === 'stop') {
        const task = queue.tasks.find(
          (t) =>
            t.jobId === job.id &&
            ['queued', 'running', 'stopping'].includes(t.status),
        );
        if (task) await queue.cancel(task.id, user);
        else if (user.role !== 'admin' && job.ownerId !== user.id)
          return send(res, 403, {
            error: 'Yalnızca iş sahibi veya admin durdurabilir.',
          });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && match[2] === 'analyze') {
        const b = await body(req);
        const config = b.provider === 'ollama' ? b.model : settings();
        if (b.provider === 'ollama' && !(await models()).includes(b.model))
          throw new Error('Yerel AI modeli bulunamadı.');
        if (b.provider !== 'ollama' && !config.openaiKey)
          throw new Error('Bağlantılar bölümünde OpenAI API key ayarlayın.');
        if (!job.rows.length)
          throw new Error('Değerlendirilecek sonuç bulunamadı.');
        if (job.demo)
          throw new Error('Örnek veriye gerçek AI değerlendirmesi uygulanmaz.');
        const handles = b.usernames;
        if (
          !Array.isArray(handles) ||
          !handles.length ||
          handles.some((u) => !job.rows.some((r) => r.username === u))
        )
          throw new Error('Değerlendirilecek hesapları seçin.');
        if (
          queue.tasks.some(
            (t) =>
              t.jobId === job.id &&
              ['queued', 'running', 'stopping'].includes(t.status),
          )
        )
          return send(res, 409, {
            error: 'Bu tarama için zaten bekleyen veya çalışan iş var.',
          });
        await queue.enqueue({
          kind: 'ai',
          jobId: job.id,
          ownerId: user.id,
          ownerName: user.name,
          platform: job.platform || 'instagram',
          title: handles.length + ' profil AI değerlendirmesi',
          payload: { handles, provider: b.provider, model: b.model },
        });
        send(res, 202, { ok: true, queued: true });
        return;
      }
      if (req.method === 'POST' && match[2] === 'rescreen-excluded') {
        const aiExcludedCount = Object.values(
          job.excludedCandidates || {},
        ).filter((c) => c.source?.startsWith('ai')).length;
        if (!aiExcludedCount)
          throw new Error('AI tarafından elenmiş, yeniden taranacak aday yok.');
        if (
          queue.tasks.some(
            (t) =>
              t.jobId === job.id &&
              ['queued', 'running', 'stopping'].includes(t.status),
          )
        )
          return send(res, 409, {
            error: 'Bu tarama için zaten bekleyen veya çalışan iş var.',
          });
        await queue.enqueue({
          kind: 'rescreen',
          jobId: job.id,
          ownerId: user.id,
          ownerName: user.name,
          platform: job.platform || 'instagram',
          title: aiExcludedCount + ' elenen adayı yeniden tarama',
          payload: {},
        });
        send(res, 202, { ok: true, queued: true });
        return;
      }
      if (req.method === 'POST' && match[2] === 'restore-excluded') {
        const b = await body(req);
        const key = String(b.username || '')
          .trim()
          .toLowerCase();
        const candidate = job.excludedCandidates?.[key];
        if (!candidate) throw new Error('Aday bulunamadı.');
        if (
          queue.tasks.some(
            (t) =>
              t.jobId === job.id &&
              ['queued', 'running', 'stopping'].includes(t.status),
          )
        )
          return send(res, 409, {
            error: 'Tarama çalışırken aday eklenemez; önce durdurun.',
          });
        const rest = { ...job.excludedCandidates };
        delete rest[key];
        job.excludedCandidates = rest;
        job.remainingUsers = [
          ...new Set([...(job.remainingUsers || []), candidate.username]),
        ];
        job.discoveredUsers = [
          ...new Set([...(job.discoveredUsers || []), candidate.username]),
        ];
        await save();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && match[2] === 'mark-verdict') {
        const b = await body(req);
        const verdict = b.verdict;
        if (!['Uygun aday', 'Uygun değil'].includes(verdict))
          throw new Error('Geçersiz değerlendirme.');
        const usernames = Array.isArray(b.usernames) ? b.usernames : [];
        if (!usernames.length)
          throw new Error('İşaretlenecek hesapları seçin.');
        if (
          queue.tasks.some(
            (t) =>
              t.jobId === job.id &&
              ['queued', 'running', 'stopping'].includes(t.status),
          )
        )
          return send(res, 409, {
            error: 'Tarama çalışırken işaretlenemez; önce durdurun.',
          });
        let marked = 0;
        for (const username of usernames) {
          const row = job.rows.find((r) => r.username === username);
          if (!row) continue;
          row.ai = {
            verdict,
            reason: `Kullanıcı tarafından manuel olarak "${verdict}" işaretlendi.`,
            model: 'manual',
            assessedAt: new Date().toISOString(),
          };
          marked++;
        }
        await save();
        return send(res, 200, { ok: true, marked });
      }
      if (req.method === 'POST' && match[2] === 'export') {
        const b = await body(req);
        const rows = filterRows(job.rows, b.filters);
        if (b.format === 'csv') {
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition':
              'attachment; filename="hiwell-affiliate.csv"',
          });
          res.end(
            '\uFEFF' +
              [HEADERS, ...rows.map(rowValues)]
                .map((r) => r.map(csvCell).join(','))
                .join('\r\n'),
          );
          return;
        }
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Hiwell Affiliate', {
          views: [{ state: 'frozen', ySplit: 1 }],
        });
        sheet.addRow(HEADERS);
        sheet.columns.forEach(
          (c, i) =>
            (c.width = [
              28, 34, 18, 24, 18, 65, 80, 45, 20, 40, 25, 40, 18, 28, 40, 65,
              40,
            ][i]),
        );
        for (const row of rows) {
          const r = sheet.addRow(rowValues(row).map((v) => v ?? 'null'));
          r.getCell(1).value = {
            text: row.username,
            hyperlink: profileUrl(row.username, row.platform),
          };
          r.getCell(1).font = { color: { argb: 'FF146D62' }, underline: true };
          r.alignment = { vertical: 'top', wrapText: true };
        }
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF155B51' },
        };
        sheet.getRow(1).height = 28;
        sheet.autoFilter = { from: 'A1', to: 'M1' };
        const notes = workbook.addWorksheet('Tarama notları');
        notes.columns = [{ width: 110 }];
        [
          job.message,
          `Kaynaklar: ${job.sources.join(', ')}`,
          `Tarih: ${job.createdAt}`,
          `AI modeli: ${job.model ?? 'Bağlı değil'}`,
          ...job.warnings,
          ...rows
            .filter((r) => r.error || r.aiError)
            .map(
              (r) =>
                `@${r.username}: ${[r.error, r.aiError].filter(Boolean).join(' | ')}`,
            ),
        ].forEach((n) => notes.addRow([n]));
        const file = await workbook.xlsx.writeBuffer();
        res.writeHead(200, {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="hiwell-affiliate.xlsx"',
        });
        res.end(Buffer.from(file));
        return;
      }
    }
    send(res, 404, { error: 'İşlem bulunamadı.' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 400, { error: e.message });
    else res.end();
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Instagram service: http://127.0.0.1:${server.address().port}`),
);
async function shutdown() {
  clearInterval(queueTimer);
  clearInterval(autoResumeTimer);
  queue.close();
  active?.controller.abort();
  await instagram.context?.close();
  await tiktok.context?.close();
  await saveQueue;
  await queue.writes;
  await outreach.writeQueue;
  await unlink('.local/server.lock').catch(() => {});
  server.close(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
