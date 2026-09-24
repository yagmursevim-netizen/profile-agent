import { chromium } from 'playwright';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  normalizeProfile,
  username,
  exactCount,
  parseAbbreviatedCount,
} from './domain.mjs';
import {
  parseInstagramPayload,
  findProfileObjects,
  FOLLOWING_NAME,
} from './instagram-data.mjs';
// Fallback default (Bağlantılar's configurable list) for readFollowing's
// titlePrefixHint param — used only to skip the extra hover cost for names
// already known to be dropped later; not the source of truth for that
// filter (index.mjs owns and passes the real, user-configured pattern).
const TITLE_PREFIX_HINT = /^\s*(dr|dyt|psk|av|prof)(\.|\s)/i;

export class Instagram {
  context = null;
  headlessMode = false;
  restrictedPages = new WeakMap();
  /** @type {Promise<import('playwright').BrowserContext> | null} */
  opening = null;
  async browser(visible = false) {
    const account = this.accounts?.current();
    const accountId = account?.id || 'legacy';
    if (
      this.context &&
      this.sessionAccountId !== accountId &&
      this.sessionAccountId !== undefined
    )
      await this.context.close();
    const headless = !visible && process.env.IG_HEADLESS === 'true';
    if (this.context && this.headlessMode !== headless)
      await this.context.close();
    if (this.context) return this.context;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const dir = path.resolve(
        account
          ? `.local/instagram-sessions/${account.id}`
          : '.local/instagram-session',
      );
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const proxy = account ? this.accounts?.proxy(account) : null;
      const viewport = account
        ? this.accounts?.viewport(account)
        : { width: 1280, height: 900 };
      const context = await chromium.launchPersistentContext(dir, {
        headless,
        locale: 'en-US',
        viewport,
        ...(proxy ? { proxy } : {}),
        ...(process.env.IG_BROWSER_CHANNEL
          ? { channel: process.env.IG_BROWSER_CHANNEL }
          : {}),
      });
      context.on('page', (page) =>
        page.on('response', (response) => {
          if (
            response.status() === 429 &&
            /^https:\/\/([a-z0-9-]+\.)*instagram\.com\//.test(response.url())
          ) {
            const retry = response.headers()['retry-after'];
            const until = /^\d+$/.test(retry || '')
              ? Date.now() + Number(retry) * 1000
              : Date.parse(retry || '');
            this.restrictedPages.set(
              page,
              Math.max(
                Date.now() + 30 * 60_000,
                Number.isFinite(until) ? until : 0,
              ),
            );
          }
        }),
      );
      this.sessionAccountId = accountId;
      this.headlessMode = headless;
      this.context = context;
      context.on('close', () => {
        this.context = null;
      });
      return context;
    })();
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }
  async testProxy(proxy) {
    const browser = await chromium.launch({ proxy, timeout: 20000 });
    try {
      const page = await browser.newPage();
      const response = await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      if (!response || !response.ok())
        throw new Error('Proxy üzerinden Instagram’a ulaşılamadı.');
    } finally {
      await browser.close();
    }
  }
  async login() {
    const context = await this.browser(true);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
    });
    await page.bringToFront();
  }
  async loggedIn() {
    if (!this.context) return false;
    return (await this.context.cookies('https://www.instagram.com')).some(
      (c) => c.name === 'sessionid' && c.value,
    );
  }
  async prepare() {
    const account = this.accounts?.current();
    if (!account) return;
    if (!account.enabled || account.status === 'suspended')
      throw Object.assign(
        new Error(
          'Aktif Instagram hesabı kullanılamıyor. Admin hesap seçmeli.',
        ),
        { blocked: true },
      );
    if (this.accounts.quotaReached(account))
      throw Object.assign(
        new Error(
          'Tanımlı hesapların tümü günlük profil sınırına ulaştı veya kullanılamıyor. Tarama durduruldu; sonuçlar korundu.',
        ),
        { blocked: true },
      );
    await this.browser();
    if (await this.loggedIn()) return;
    // Login happens in a visible window so 2FA/CAPTCHA can be completed by the admin.
    const context = await this.browser(true);
    const page = await context.newPage();
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    try {
      await page
        .locator('input[name="username"]')
        .fill(account.username, { timeout: 15000 });
      await page
        .locator('input[name="password"]')
        .fill(this.accounts.password(account));
      await page.locator('button[type="submit"]').click();
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await this.loggedIn()) {
          await page
            .waitForURL((url) => !url.pathname.includes('/accounts/login'), {
              timeout: 10000,
            })
            .catch(() => {});
          await this.guard(page);
          await page.close();
          return;
        }
        await page.waitForTimeout(500);
      }
      await this.guard(page);
    } catch (e) {
      if (e.suspended || e.blocked) throw e;
    }
    await page.bringToFront();
    throw Object.assign(
      new Error(
        'Instagram girişi tamamlanamadı. Ana Mac’te açılan pencerede şifre/2FA/doğrulamayı kontrol edin; sonra işi devam ettirin.',
      ),
      { blocked: true },
    );
  }
  async recover(operation) {
    const tried = new Set();
    while (true) {
      try {
        if (tried.size) await this.prepare();
        return await operation();
      } catch (e) {
        const id = this.accounts?.current()?.id;
        if (!e.suspended || !id || tried.has(id)) throw e;
        tried.add(id);
        if (!(await this.accounts.suspendAndNext())) throw e;
        await this.context?.close();
      }
    }
  }
  async guard(page) {
    const url = page.url();
    const text = await page.locator('body').innerText({ timeout: 10000 });
    if (
      /\/(?:accounts|challenge|checkpoint|suspended|disabled)(?:\/|$)/.test(
        new URL(url).pathname,
      ) &&
      /we suspended your account|your account has been suspended|we disabled your account|hesabını askıya aldık|hesabınız askıya alındı|hesabın askıya alındı/i.test(
        text,
      )
    ) {
      throw Object.assign(
        new Error(
          'Instagram oturum sahibi hesabı askıya aldı. Kalan kullanıcılar korundu.',
        ),
        { blocked: true, suspended: true },
      );
    }
    const restricted =
      this.restrictedPages.has(page) ||
      /try again later|we restrict certain activity|daha sonra tekrar dene|çok fazla istek|too many requests|temporarily blocked|geçici olarak engellendi/i.test(
        text,
      );
    if (restricted) {
      const error = new Error(
        'Instagram işlem kısıtlaması bildirdi. Tarama durduruldu; sonuçlar korundu. En az 30 dakika bekleyin ve Instagram’daki kısıtın kalktığını kontrol edin. Saatlik otomatik kontrol tekrar deneyecek; elle "Devam et" ile de sürdürebilirsiniz.',
      );
      error.blocked = true;
      error.restrictedUntil =
        this.restrictedPages.get(page) || Date.now() + 30 * 60_000;
      throw error;
    }
    if (
      /\/accounts\/login|\/challenge|\/checkpoint/.test(url) ||
      /confirm it.s you|şüpheli giriş/i.test(text)
    ) {
      const error = new Error(
        'Instagram giriş veya doğrulama istiyor. Admin, Bağlantılar bölümünden Instagram penceresini açıp kontrol etmeli.',
      );
      error.blocked = true;
      throw error;
    }
    if (
      /page isn.t available|page isn't available|sayfa kullanılamıyor|sorry, this page/i.test(
        text,
      )
    )
      throw new Error('Profil bulunamadı veya erişilemiyor.');
  }
  async profile(handle, signal) {
    const result = await this.recover(() => {
      signal.throwIfAborted();
      return this.readProfile(handle, signal);
    });
    await this.accounts?.recordScan();
    return result;
  }
  async readProfile(handle, signal) {
    signal.throwIfAborted();
    const context = await this.browser();
    const page = await context.newPage();
    let found = null;
    const consider = (obj) => {
      for (const profile of findProfileObjects(obj, handle)) {
        found = {
          ...found,
          ...Object.fromEntries(
            Object.entries(profile).filter(
              ([, v]) => v !== null && v !== undefined,
            ),
          ),
        };
      }
    };
    const diagnostic = [];
    const pending = new Set();
    const listener = (response) => {
      if (
        !/^https:\/\/([a-z0-9-]+\.)*instagram\.com\//.test(response.url()) ||
        !/json|javascript|text\/plain/.test(
          response.headers()['content-type'] ?? '',
        ) ||
        !['xhr', 'fetch'].includes(response.request().resourceType())
      )
        return;
      const p = response
        .text()
        .then((raw) => {
          const payloads = parseInstagramPayload(raw);
          diagnostic.push({
            path: new URL(response.url()).pathname,
            type: response.headers()['content-type'],
            status: response.status(),
            parsed: payloads.length,
            keys: payloads.map((p) => Object.keys(p ?? {})),
          });
          payloads.forEach(consider);
        })
        .catch(() => {})
        .finally(() => pending.delete(p));
      pending.add(p);
    };
    page.on('response', listener);
    const abort = () => void page.close().catch(() => {});
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (process.env.IG_FAST_SCAN !== 'false') {
        await page.route('**/*', (route) => {
          const request = route.request();
          // Keep verification assets available; only profile media is unnecessary.
          return ['image', 'media'].includes(request.resourceType()) &&
            !/captcha|challenge|verify/i.test(request.url())
            ? route.abort()
            : route.continue();
        });
      }
      await page.goto(`https://www.instagram.com/${handle}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      // Read hydration immediately; keep waiting only while required fields are missing.
      let scripts = [];
      const fast = process.env.IG_FAST_SCAN !== 'false';
      if (!fast) await page.waitForTimeout(2500);
      for (let attempt = 0; attempt <= 42; attempt++) {
        signal.throwIfAborted();
        scripts = await page
          .locator('script[type="application/json"]')
          .allTextContents();
        for (const raw of scripts) {
          try {
            consider(JSON.parse(raw));
          } catch {}
        }
        if (found) {
          const profile = normalizeProfile(found);
          if (
            profile.bio !== null &&
            profile.followers !== null &&
            profile.following !== null &&
            profile.private !== null
          )
            break;
        }
        if (attempt === 42) break;
        await page.waitForTimeout(250);
      }
      await this.guard(page);
      await Promise.allSettled(pending);
      if (process.env.IG_DUMP_PAYLOAD === 'true' && found)
        await writeFile(
          `.local/payload-${handle}.json`,
          JSON.stringify({ handle, found, responses: diagnostic }, null, 2),
          { mode: 0o600 },
        );
      if (!found)
        await writeFile(
          '.local/profile-diagnostic.json',
          JSON.stringify(
            { handle, scriptCount: scripts.length, responses: diagnostic },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      if (!found)
        throw new Error(
          'Profil verisi okunamadı. Instagram sayfa yapısı değişmiş veya erişimi sınırlamış olabilir.',
        );
      const result = normalizeProfile(found);
      if (
        result.followers === null ||
        result.following === null ||
        result.bio === null ||
        result.private === null
      )
        result.error =
          'Bazı profil alanları Instagram tarafından verilmedi; eksik alanlar null bırakıldı.';
      result.partialRead = result.bio !== null && !!result.error;
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
      page.off('response', listener);
      await page.close().catch(() => {});
    }
  }
  async following(...args) {
    return this.recover(() => {
      args[2].throwIfAborted();
      return this.readFollowing(...args);
    });
  }
  async readFollowing(
    handle,
    limit,
    signal,
    onProgress,
    onSource = async () => {},
    titlePrefixHint = TITLE_PREFIX_HINT,
  ) {
    signal.throwIfAborted();
    const context = await this.browser();
    const page = await context.newPage();
    const counts = { followers: null, following: null };
    // Instagram's following-list response includes a lightweight object per
    // listed user (username, full_name, is_private, profile_pic_url, ...);
    // capturing those here lets the caller skip a full profile visit for
    // accounts already known private, and pre-screen the rest by name/photo
    // before ever loading their profile.
    const candidates = {};
    const pending = [];
    const dump = process.env.IG_DUMP_PAYLOAD === 'true';
    let dumpIndex = 0;
    const consider = (data) => {
      for (const p of findProfileObjects(data, handle)) {
        const followers = exactCount(
          p.follower_count ?? p.edge_followed_by?.count,
        );
        const following = exactCount(p.following_count ?? p.edge_follow?.count);
        if (followers !== null) counts.followers = followers;
        if (following !== null) counts.following = following;
      }
      for (const u of Array.isArray(data?.users) ? data.users : []) {
        if (typeof u?.username !== 'string') continue;
        const key = u.username.toLowerCase();
        const prior = candidates[key] || {};
        candidates[key] = {
          private:
            typeof u.is_private === 'boolean'
              ? u.is_private
              : (prior.private ?? null),
          fullName:
            typeof u.full_name === 'string'
              ? u.full_name
              : (prior.fullName ?? ''),
          photoUrl:
            typeof u.profile_pic_url === 'string'
              ? u.profile_pic_url
              : (prior.photoUrl ?? null),
        };
      }
    };
    const listener = (response) => {
      if (
        !/^https:\/\/([a-z0-9-]+\.)*instagram\.com\//.test(response.url()) ||
        !['xhr', 'fetch'].includes(response.request().resourceType()) ||
        !/json|javascript|text\/plain/.test(
          response.headers()['content-type'] || '',
        )
      )
        return;
      pending.push(
        response
          .text()
          .then((raw) => {
            for (const payload of parseInstagramPayload(raw)) consider(payload);
            if (dump)
              return writeFile(
                `.local/payload-following-${handle}-${dumpIndex++}.json`,
                JSON.stringify(
                  { url: response.url(), body: raw.slice(0, 200_000) },
                  null,
                  2,
                ),
                { mode: 0o600 },
              ).catch(() => {});
          })
          .catch(() => {}),
      );
    };
    page.on('response', listener);
    const abort = () => void page.close().catch(() => {});
    signal.addEventListener('abort', abort, { once: true });
    try {
      await page.goto(`https://www.instagram.com/${handle}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(2000);
      await this.guard(page);
      for (const raw of await page
        .locator('script[type="application/json"]')
        .allTextContents()) {
        try {
          consider(JSON.parse(raw));
        } catch {}
      }
      await Promise.allSettled(pending);
      await onSource(counts);
      // Keep `listener` attached (candidates map above needs the following-list
      // responses that arrive while scrolling below); it's removed in `finally`.
      // Instagram's current profile links use href="#" and open a modal.
      // Keep the older URL selector, but identify the current control by its name.
      const link = page
        .locator(
          `a[href="/${handle}/following/"], a[href="/${handle}/following"]`,
        )
        .or(page.getByRole('link', { name: FOLLOWING_NAME }))
        .or(page.getByRole('button', { name: FOLLOWING_NAME }))
        .first();
      try {
        await link.click({ timeout: 20000 });
      } catch (e) {
        if (signal.aborted) throw e;
        await this.guard(page);
        throw new Error(
          'Profil açıldı ancak takip edilenler kontrolü bulunamadı veya tıklanamadı.',
        );
      }
      // The new modal does not expose role="dialog". Its heading and search
      // input identify the smallest common container without including the feed.
      const heading = page
        .getByRole('heading', { name: /^(Following|Takip|Takip edilenler)$/i })
        .last();
      const dialog = page
        .getByRole('dialog')
        .last()
        .or(heading.locator('xpath=ancestor::*[.//input][1]'))
        .last();
      try {
        await dialog.waitFor({ timeout: 20000 });
        await dialog.locator('a[href]').first().waitFor({ timeout: 20000 });
      } catch (e) {
        if (signal.aborted) throw e;
        await this.guard(page);
        throw new Error(
          'Takip edilenler penceresi açıldı ancak profil listesi yüklenmedi.',
        );
      }
      const users = new Set();
      let stable = 0;
      let reachedEnd = false;
      // Hovering a row's link opens Instagram's own preview card, which
      // shows an exact/abbreviated follower count and up to 3 recent post
      // thumbnails — data otherwise only available after a full profile
      // visit. Reading it here lets callers skip that visit for accounts
      // already over the fame threshold. The post thumbnails are only a
      // fallback for the AI photo pre-screen (see index.mjs) — the real
      // profile photo (from the following-list JSON's profile_pic_url,
      // captured separately above) is what should be screened whenever it's
      // available, since a post can be a screenshot/product shot/quote card
      // unrelated to what the account owner looks like.
      // The card's own class names are Instagram's obfuscated, unstable
      // build hashes, so it's located by its inline `translate(...)`
      // tooltip positioning and by content instead.
      const enrichFromHover = async (href, key) => {
        const link = dialog.locator(`a[href="${href}"]`).first();
        await link.hover({ timeout: 3000 });
        // Card content (follower count, post thumbnails) loads in after the
        // hover fires; too short a wait here reads it before it's settled,
        // leaving those fields empty for that candidate.
        await page.waitForTimeout(1300);
        const card = page.locator('div[style*="translate("]').last();
        await card.waitFor({ timeout: 2000 });
        const text = await card.innerText();
        const followers = parseAbbreviatedCount(text, 'followers');
        const photos = await card
          .locator('img[height="120"][width="120"]')
          .evaluateAll((nodes) => nodes.slice(0, 3).map((n) => n.src))
          .catch(() => []);
        const prior = candidates[key] || {};
        candidates[key] = {
          ...prior,
          followers: followers ?? prior.followers ?? null,
          photos: photos.length ? photos : (prior.photos ?? []),
        };
      };
      for (
        let i = 0;
        i < Math.max(500, limit * 2) && users.size < limit && stable < 5;
        i++
      ) {
        signal.throwIfAborted();
        await this.guard(page);
        const hrefs = await dialog
          .locator('a[href]')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
        const before = users.size;
        for (const href of hrefs) {
          if (!href) continue;
          try {
            const url = new URL(href, 'https://www.instagram.com');
            if (url.hash || !/^\/[a-zA-Z0-9._]+\/?$/.test(url.pathname))
              continue;
            const u = username(url.href);
            if (u === handle || users.size >= limit || users.has(u)) continue;
            users.add(u);
            const key = u.toLowerCase();
            if (!titlePrefixHint.test(candidates[key]?.fullName || '')) {
              try {
                await enrichFromHover(href, key);
              } catch {
                // Hover/preview failures are non-fatal; the candidate is
                // still collected, just without the extra follower/photo data.
              }
            }
          } catch {}
        }
        onProgress(users.size);
        stable = before === users.size ? stable + 1 : 0;
        reachedEnd = await dialog.evaluate((el) => {
          const nodes = [el, ...el.querySelectorAll('*')];
          const scroll = nodes
            .filter(
              (n) =>
                n.scrollHeight > n.clientHeight + 10 &&
                /auto|scroll/.test(getComputedStyle(n).overflowY),
            )
            .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
          if (!scroll) return true;
          const bottom =
            scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 5;
          scroll.scrollBy(0, Math.max(400, scroll.clientHeight * 0.8));
          return bottom;
        });
        await page.waitForTimeout(1500);
      }
      if (!users.size)
        throw new Error('Takip edilenler listesi boş veya okunamıyor.');
      await Promise.allSettled(pending);
      return {
        users: [...users],
        ...counts,
        limited: users.size >= limit,
        endObserved: reachedEnd,
        candidates,
        warning:
          users.size >= limit
            ? `@${handle}: ${limit} hesap sınırına ulaşıldı; liste kısmi.`
            : `@${handle}: görünür listeden ${users.size} hesap alındı. Instagram listeyi sınırlayabildiği için tamlık garanti edilmez.`,
      };
    } finally {
      signal.removeEventListener('abort', abort);
      page.off('response', listener);
      await page.close().catch(() => {});
    }
  }
}
