import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { username, normalizeProfile } from './domain.mjs';
import { profileUrl } from './platform.mjs';
import { readDOM, mergeProfile, externalFallback } from './tiktok-hybrid.mjs';

export function tiktokProfile(payload, handle) {
  const stack = [payload];
  let visited = 0;
  while (stack.length && visited++ < 50000) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const u = node.user || node.userInfo?.user;
    const stats = node.stats || node.statsV2 || node.userInfo?.stats;
    if (u?.uniqueId?.toLowerCase() === handle.toLowerCase()) {
      const count = (n) =>
        typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n;
      return {
        ...normalizeProfile({
          username: handle,
          full_name: u.nickname,
          biography: typeof u.signature === 'string' ? u.signature : null,
          follower_count: count(stats?.followerCount),
          following_count: count(stats?.followingCount),
          is_private: u.privateAccount,
        }),
        platform: 'tiktok',
        bioSource: 'TikTok JSON',
      };
    }
    stack.push(...Object.values(node));
  }
  return null;
}

export class TikTok {
  context = null;
  /** @type {Promise<import('playwright').BrowserContext> | null} */
  opening = null;
  async browser() {
    if (this.context) return this.context;
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const dir = path.resolve('.local/tiktok-session');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const channel =
        process.env.TIKTOK_BROWSER_CHANNEL || process.env.IG_BROWSER_CHANNEL;
      const context = await chromium.launchPersistentContext(dir, {
        headless: false,
        locale: 'en-US',
        viewport: { width: 1280, height: 900 },
        ...(channel ? { channel } : {}),
      });
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
  async login() {
    const context = await this.browser();
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://www.tiktok.com/login', {
      waitUntil: 'domcontentloaded',
    });
    await page.bringToFront();
  }
  async guard(page, restricted = false) {
    const text = await page.locator('body').innerText({ timeout: 10000 });
    if (
      restricted ||
      /too many requests|too many attempts|çok fazla istek|çok fazla deneme/i.test(
        text,
      )
    ) {
      throw Object.assign(
        new Error(
          'TikTok işlem kısıtı bildirdi. Tarama durduruldu; en az 30 dakika sonra kısıtın kalktığını kontrol edin.',
        ),
        {
          blocked: true,
          restrictedUntil: Date.now() + 30 * 60000,
        },
      );
    }
    const challenge = await page
      .locator('[id*="captcha"]:visible, iframe[src*="captcha"]:visible')
      .count();
    if (
      challenge ||
      /\/login|\/challenge/.test(page.url()) ||
      /verify to continue|drag the slider|complete the puzzle|log in to search|continue with.*log in/i.test(
        text,
      )
    )
      throw Object.assign(
        new Error(
          'TikTok giriş veya doğrulama istiyor. Admin, TikTok oturum penceresinde işlemi tamamladıktan sonra taramayı yeniden başlatın.',
        ),
        { blocked: true },
      );
  }
  async withPage(signal, task) {
    signal.throwIfAborted();
    const context = await this.browser();
    signal.throwIfAborted();
    const page = await context.newPage();
    const abort = () => {
      void page.close().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    let restricted = false;
    page.on('response', (r) => {
      if (
        r.status() === 429 &&
        /^https:\/\/([a-z0-9-]+\.)*tiktok\.com\//.test(r.url())
      )
        restricted = true;
    });
    try {
      signal.throwIfAborted();
      return await task(page, () => this.guard(page, restricted));
    } finally {
      signal.removeEventListener('abort', abort);
      await page.close().catch(() => {});
    }
  }
  async profile(handle, signal) {
    handle = username(handle, 'tiktok');
    return this.withPage(signal, async (page, guard) => {
      let found = null;
      const pending = new Set();
      const capture = (response) => {
        if (
          !/^https:\/\/([a-z0-9-]+\.)*tiktok\.com\//.test(response.url()) ||
          !response.headers()['content-type']?.includes('json')
        )
          return;
        const promise = response
          .json()
          .then((data) => {
            found = mergeProfile(found, tiktokProfile(data, handle));
          })
          .catch(() => {});
        pending.add(promise);
        void promise.finally(() => pending.delete(promise));
      };
      page.on('response', capture);
      await page
        .goto(profileUrl(handle, 'tiktok'), {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        })
        .catch(() => {
          signal.throwIfAborted();
        });
      await page.waitForTimeout(2500);
      const payloads = await page
        .locator(
          'script[type="application/json"], script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE',
        )
        .allTextContents();
      for (const text of payloads) {
        try {
          found = mergeProfile(found, tiktokProfile(JSON.parse(text), handle));
        } catch {}
      }
      page.off('response', capture);
      await Promise.allSettled(pending);
      // DOM can provide a link or bio absent from hydration, without replacing exact JSON counts.
      if (page.evaluate) {
        for (let attempt = 0; attempt < 3; attempt++) {
          signal.throwIfAborted();
          try {
            found = mergeProfile(found, await readDOM(page, handle));
          } catch {
            signal.throwIfAborted();
          }
          if (typeof found?.bio === 'string') break;
          if (attempt < 2) await page.waitForTimeout(1500);
        }
      }
      if (found && typeof found.bio === 'string') return found;
      const backup = await externalFallback(handle, signal);
      found = mergeProfile(found, backup.profile);
      if (typeof found?.bio === 'string') return found;
      const evidence = backup.evidence;
      const partial = evidence
        ? {
            ...normalizeProfile({ username: handle }),
            platform: 'tiktok',
            searchEvidence: evidence,
            error: 'Bio doğrulanamadı; yalnızca arama özeti bulundu.',
          }
        : null;
      try {
        await guard();
      } catch (e) {
        e.partialProfile = partial;
        throw e;
      }

      throw Object.assign(
        new Error(
          'TikTok bio okunamadı. Kalan kullanıcılar korundu; daha sonra devam edebilirsiniz.',
        ),
        { blocked: true, partialProfile: partial },
      );
    });
  }
  async search(term, limit, signal, progress) {
    return this.withPage(signal, async (page, guard) => {
      await page.goto(
        'https://www.tiktok.com/search/user?q=' + encodeURIComponent(term),
        { waitUntil: 'domcontentloaded', timeout: 45000 },
      );
      await page.waitForTimeout(2500);
      const users = new Set();
      let stale = 0;
      for (
        let round = 0;
        round < 250 && users.size < limit && stale < 3;
        round++
      ) {
        signal.throwIfAborted();
        await guard();
        const before = users.size;
        const hrefs = await page
          .locator('a[href]')
          .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
        for (const href of hrefs) {
          try {
            const url = new URL(href, 'https://www.tiktok.com');
            if (!/^\/@[^/]+\/?$/.test(url.pathname)) continue;
            const handle = username(url.href, 'tiktok');
            if (users.size < limit) users.add(handle);
          } catch {}
        }
        progress(users.size);
        stale = users.size === before ? stale + 1 : 0;
        if (users.size >= limit) break;
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        await page.waitForTimeout(2000);
      }
      await guard();
      return {
        users: [...users],
        warning: users.size
          ? 'TikTok aramasında yüklenen hesaplar alındı; sonuçlar oturuma göre değişebilir ve tüm hesapları kapsamayabilir.'
          : 'TikTok aramasında hesap bulunamadı. Giriş/doğrulama durumunu ve arama metnini kontrol edin.',
      };
    });
  }
}
