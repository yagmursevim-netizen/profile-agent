import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { importTikTok } from './tiktok-import.mjs';
import { username } from './domain.mjs';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const blocked = (message) =>
  Object.assign(new Error(message), { blocked: true });
export class TikTokBridge {
  constructor(dir = '.local') {
    this.dir = dir;
    this.state = {};
    this.pending = null;
    this.lastSeen = 0;
    this.client = null;
  }
  async init() {
    try {
      this.state = JSON.parse(
        await readFile(this.dir + '/tiktok-bridge.json', 'utf8'),
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    return this;
  }
  async save() {
    await writeFile(
      this.dir + '/tiktok-bridge.tmp',
      JSON.stringify(this.state),
      { mode: 0o600 },
    );
    await rename(
      this.dir + '/tiktok-bridge.tmp',
      this.dir + '/tiktok-bridge.json',
    );
  }
  status() {
    return {
      paired: !!this.state.keyHash,
      connected: !!this.client && Date.now() - this.lastSeen < 45000,
      lastSeen: this.lastSeen || null,
    };
  }
  async pair(revoke = false) {
    this.pending?.reject(blocked('TikTok eklenti eşleştirmesi değiştirildi.'));
    const token = revoke ? null : randomBytes(32).toString('base64url');
    this.state = token ? { keyHash: hash(token) } : {};
    this.client = null;
    this.lastSeen = 0;
    await this.save();
    return { token, ...this.status() };
  }
  authenticate(req) {
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
      return false;
    const id = req.headers['x-hiwell-extension'];
    if (
      !/^[a-p]{32}$/.test(id || '') ||
      (origin && origin !== 'chrome-extension://' + id)
    )
      return false;
    if (this.state.extensionId && this.state.extensionId !== id) return false;
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!this.state.keyHash || !token || token.length > 200) return false;
    return timingSafeEqual(
      Buffer.from(hash(token), 'hex'),
      Buffer.from(this.state.keyHash, 'hex'),
    );
  }
  async poll(client, extensionId) {
    if (typeof client !== 'string' || !/^[a-f0-9-]{36}$/.test(client))
      throw new Error('Geçersiz eklenti oturumu.');
    if (
      this.client &&
      this.client !== client &&
      Date.now() - this.lastSeen < 45000
    )
      throw Object.assign(
        new Error('Başka bir agent sekmesi bağlı. Önce onu durdurun.'),
        { status: 409 },
      );
    this.client = client;
    this.lastSeen = Date.now();
    if (!this.state.extensionId) {
      this.state.extensionId = extensionId;
      await this.save();
    }
    return { command: this.pending?.command || null };
  }
  finish(client, input) {
    if (client !== this.client) throw new Error('Eklenti oturumu eşleşmiyor.');
    this.lastSeen = Date.now();
    if (!this.pending || input.id !== this.pending.command.id)
      return { accepted: false };
    if (input.error) {
      const error = new Error(String(input.error).slice(0, 500));
      if (input.blocked) error.blocked = true;
      if (input.restricted) {
        error.blocked = true;
        error.restrictedUntil = Date.now() + 30 * 60000;
      }
      if (error.blocked) {
        this.client = null;
        this.lastSeen = 0;
      }
      this.pending.reject(error);
    } else this.pending.resolve(input.result);
    return { accepted: true };
  }
  disconnect(client) {
    if (client === this.client) {
      this.client = null;
      this.lastSeen = 0;
      this.pending?.reject(
        blocked('TikTok agent durduruldu. Toplanan sonuçlar korundu.'),
      );
    }
  }
  request(input, signal) {
    signal.throwIfAborted();
    if (this.pending) throw new Error('TikTok eklentisinde başka işlem var.');
    if (!this.status().connected)
      return Promise.reject(
        blocked(
          'TikTok agent bağlı değil. Ana bilgisayarda Chrome eklentisinden Agent ekranını açıp bağlanın.',
        ),
      );
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.pending = null;
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      this.pending = {
        command: { ...input, id: randomUUID() },
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(
        () =>
          this.pending?.reject(
            blocked(
              'TikTok eklentisi yanıt vermedi. Agent sekmesini açık tutun; sonuçlar kaydedildi.',
            ),
          ),
        90000,
      );
    });
  }
  async profile(handle, signal) {
    const data = await this.request(
      { kind: 'profile', handle: username(handle, 'tiktok') },
      signal,
    );
    const row = importTikTok(data);
    if (row.username !== handle)
      throw new Error('TikTok yanlış profil yanıtı verdi.');
    delete row.imported;
    row.collectedVia = 'chrome-extension';
    return row;
  }
  async following(handle, limit, signal, progress, counts = async () => {}) {
    handle = username(handle, 'tiktok');
    const users = new Set();
    let stale = 0;
    for (
      let round = 0;
      round < 250 && users.size < limit && stale < 3;
      round++
    ) {
      const result = await this.request(
        { kind: round === 0 ? 'following' : 'following-next', handle },
        signal,
      );
      if (!Array.isArray(result?.users) || result.users.length > 5000)
        throw new Error('Takip edilenler yanıtı geçersiz.');
      if (round === 0 && result.following === 0) {
        await counts({ following: 0, followers: null });
        return {
          users: [],
          following: 0,
          warning: 'Kaynak hesap 0 kullanıcı takip ediyor.',
        };
      }
      const before = users.size;
      for (const raw of result.users) {
        const name = username(raw, 'tiktok');
        if (users.size < limit && name !== handle) users.add(name);
      }
      stale = before === users.size ? stale + 1 : 0;
      progress(users.size);
      if (result.complete) break;
    }
    if (!users.size)
      throw new Error(
        'Takip edilenler listesinde kullanıcı okunamadı. Liste erişimini kontrol edin; boş olduğu varsayılmadı.',
      );
    return {
      users: [...users],
      warning:
        users.size >= limit
          ? 'Kaynak başına sınıra ulaşıldı.'
          : 'TikTok takip edilenler listesinde yüklenen kullanıcılar alındı; listenin tamamı doğrulanamadı.',
    };
  }
  async search(term, limit, signal, progress) {
    const users = new Set();
    let stale = 0;
    for (
      let round = 0;
      round < 250 && users.size < limit && stale < 3;
      round++
    ) {
      const result = await this.request(
        { kind: round === 0 ? 'search' : 'search-next', term },
        signal,
      );
      if (!Array.isArray(result?.users) || result.users.length > 5000)
        throw new Error('TikTok arama sonucu geçersiz.');
      const before = users.size;
      for (const raw of result.users) {
        const handle = username(raw, 'tiktok');
        if (users.size < limit) users.add(handle);
      }
      stale = before === users.size ? stale + 1 : 0;
      progress(users.size);
    }
    return {
      users: [...users],
      warning: users.size
        ? 'TikTok’ta yüklenen arama sonuçları alındı; sonuçlar oturuma göre değişebilir.'
        : 'TikTok aramasında hesap bulunamadı.',
    };
  }
}
