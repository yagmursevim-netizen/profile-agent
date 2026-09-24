import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
// Common real-world desktop/laptop resolutions; each account gets a stable
// (but distinct-looking) one derived from its id, so accounts sharing one
// machine don't all present an identical, easily correlated viewport.
const VIEWPORTS = [
  [1920, 1080],
  [1536, 864],
  [1440, 900],
  [1366, 768],
  [1280, 800],
  [1512, 982],
  [1680, 1050],
  [1600, 900],
];
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
export class InstagramAccounts {
  constructor(dir = '.local') {
    this.dir = dir;
    this.state = {
      accounts: [],
      activeId: null,
      autoSwitch: false,
      events: [],
    };
    this.writes = Promise.resolve();
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      this.key = await readFile(this.dir + '/ig-accounts.key');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.key = randomBytes(32);
      await writeFile(this.dir + '/ig-accounts.key', this.key, {
        mode: 0o600,
        flag: 'wx',
      });
    }
    try {
      this.state = JSON.parse(
        await readFile(this.dir + '/ig-accounts.json', 'utf8'),
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    return this;
  }
  save() {
    const data = JSON.stringify(this.state);
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        await writeFile(this.dir + '/ig-accounts.tmp', data, { mode: 0o600 });
        await rename(
          this.dir + '/ig-accounts.tmp',
          this.dir + '/ig-accounts.json',
        );
      });
    return this.writes;
  }
  snapshot() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      ...this.state,
      accounts: this.state.accounts.map(({ secret, proxySecret, ...a }) => ({
        ...a,
        scannedToday: a.scanDate === today ? a.scannedToday || 0 : 0,
        configured: !!secret,
        proxyConfigured: !!proxySecret,
      })),
    };
  }
  current() {
    return this.state.accounts.find((a) => a.id === this.state.activeId);
  }
  resetIfNewDay(account) {
    const today = new Date().toISOString().slice(0, 10);
    if (account.scanDate !== today) {
      account.scanDate = today;
      account.scannedToday = 0;
    }
  }
  quotaReached(account) {
    if (!account) return false;
    this.resetIfNewDay(account);
    return !!account.dailyLimit && account.scannedToday >= account.dailyLimit;
  }
  nextAvailable(excludeId) {
    return this.state.accounts.find(
      (a) =>
        a.id !== excludeId &&
        a.enabled &&
        a.status !== 'suspended' &&
        !(a.restrictedUntil > Date.now()) &&
        !this.quotaReached(a),
    );
  }
  async recordScan() {
    const current = this.current();
    if (!current) return;
    this.resetIfNewDay(current);
    current.scannedToday = (current.scannedToday || 0) + 1;
    if (current.dailyLimit && current.scannedToday >= current.dailyLimit) {
      this.state.events.unshift({
        at: new Date().toISOString(),
        username: current.username,
        message: `Günlük ${current.dailyLimit} profil sınırına ulaşıldı.`,
      });
      const next = this.state.autoSwitch
        ? this.nextAvailable(current.id)
        : null;
      if (next) {
        this.state.activeId = next.id;
        this.state.events.unshift({
          at: new Date().toISOString(),
          username: next.username,
          message: 'Günlük sınır nedeniyle sonraki tanımlı hesaba geçildi.',
        });
      }
      this.state.events = this.state.events.slice(0, 100);
    }
    await this.save();
  }
  encrypt(value) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(value), c.final()]);
    return [iv, c.getAuthTag(), data]
      .map((b) => b.toString('base64'))
      .join('.');
  }
  decrypt(secret) {
    const [iv, tag, data] = secret
      .split('.')
      .map((s) => Buffer.from(s, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', this.key, iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString();
  }
  password(account) {
    return this.decrypt(account.secret);
  }
  proxy(account) {
    if (!account.proxyServer) return null;
    return {
      server: account.proxyServer,
      ...(account.proxyUsername
        ? {
            username: account.proxyUsername,
            password: this.decrypt(account.proxySecret),
          }
        : {}),
    };
  }
  viewport(account) {
    const [width, baseHeight] = VIEWPORTS[hash(account.id) % VIEWPORTS.length];
    const jitter = (hash(account.id + 'v') % 21) - 10;
    return { width, height: baseHeight + jitter };
  }
  async update(input) {
    if (input.action === 'switch') {
      const a = this.state.accounts.find(
        (a) => a.id === input.id && a.enabled && a.status !== 'suspended',
      );
      if (!a) throw new Error('Kullanılabilir hesap bulunamadı.');
      this.state.activeId = a.id;
    } else if (input.action === 'options')
      this.state.autoSwitch = input.autoSwitch === true;
    else if (input.action === 'delete') {
      const a = this.state.accounts.find((a) => a.id === input.id);
      if (!a) throw new Error('Hesap bulunamadı.');
      this.state.accounts = this.state.accounts.filter((x) => x.id !== a.id);
      if (this.state.activeId === a.id)
        this.state.activeId =
          this.state.accounts.find((x) => x.enabled && x.status !== 'suspended')
            ?.id ||
          this.state.accounts[0]?.id ||
          null;
      this.state.events.unshift({
        at: new Date().toISOString(),
        username: a.username,
        message: 'Hesap silindi.',
      });
      this.state.events = this.state.events.slice(0, 100);
      await rm(this.dir + '/instagram-sessions/' + a.id, {
        recursive: true,
        force: true,
      });
    } else {
      let a = this.state.accounts.find((a) => a.id === input.id);
      if (input.id && !a) throw new Error('Hesap bulunamadı.');
      if (
        a &&
        a.username.toLowerCase() !== String(input.username).toLowerCase()
      )
        throw new Error(
          'Farklı kullanıcı adı için yeni hesap ekleyin; oturumlar karıştırılmaz.',
        );
      if (!/^[a-zA-Z0-9._]{1,30}$/.test(input.username || ''))
        throw new Error('Geçerli Instagram kullanıcı adı girin.');
      if (
        this.state.accounts.some(
          (x) =>
            x.id !== a?.id &&
            x.username.toLowerCase() === input.username.toLowerCase(),
        )
      )
        throw new Error('Bu hesap zaten kayıtlı.');
      if (
        (!a && !input.password) ||
        (input.password &&
          (typeof input.password !== 'string' || input.password.length > 500))
      )
        throw new Error('Geçerli şifre girin.');
      if (!a) {
        if (this.state.accounts.length >= 10)
          throw new Error('En fazla 10 hesap.');
        a = { id: randomUUID(), status: 'ready' };
        this.state.accounts.push(a);
      }
      a.username = input.username;
      a.enabled = input.enabled !== false;
      if (input.password) a.secret = this.encrypt(input.password);
      if (typeof input.proxyServer === 'string') {
        const value = input.proxyServer.trim();
        if (!value) {
          delete a.proxyServer;
          delete a.proxyUsername;
          delete a.proxySecret;
        } else {
          let parsed;
          try {
            parsed = new URL(value);
          } catch {
            throw new Error('Proxy adresi geçersiz. Örnek: http://host:port');
          }
          if (
            !['http:', 'https:', 'socks5:', 'socks4:'].includes(parsed.protocol)
          )
            throw new Error(
              'Proxy şeması http, https, socks5 veya socks4 olmalı.',
            );
          if (!parsed.hostname || !parsed.port)
            throw new Error('Proxy adresinde host ve port belirtin.');
          if (
            (parsed.pathname && parsed.pathname !== '/') ||
            parsed.search ||
            parsed.username ||
            parsed.password
          )
            throw new Error(
              'Proxy adresi yalnızca şema, host ve port içermeli; kullanıcı adı/şifreyi ayrı alanlara girin.',
            );
          a.proxyServer = `${parsed.protocol}//${parsed.host}`;
        }
      }
      if (a.proxyServer) {
        if (typeof input.proxyUsername === 'string')
          a.proxyUsername = input.proxyUsername.trim() || undefined;
        if (input.proxyPassword) {
          if (
            typeof input.proxyPassword !== 'string' ||
            input.proxyPassword.length > 500
          )
            throw new Error('Geçerli proxy şifresi girin.');
          a.proxySecret = this.encrypt(input.proxyPassword);
        }
        if (a.proxyUsername && !a.proxySecret)
          throw new Error('Proxy kullanıcı adı girildiyse şifre de gerekir.');
      }
      if (typeof input.dailyLimit !== 'undefined') {
        if (input.dailyLimit === null || input.dailyLimit === '')
          delete a.dailyLimit;
        else {
          const n = Number(input.dailyLimit);
          if (!Number.isInteger(n) || n < 1 || n > 100000)
            throw new Error('Günlük profil sınırı 1-100000 arasında olmalı.');
          a.dailyLimit = n;
        }
      }
      if (typeof input.persona === 'string') {
        if (input.persona.length > 500)
          throw new Error('Persona açıklaması en fazla 500 karakter olmalı.');
        if (input.persona.trim()) a.persona = input.persona.trim();
        else delete a.persona;
      }
      if (!this.state.activeId) this.state.activeId = a.id;
    }
    await this.save();
    return this.snapshot();
  }
  async suspendAndNext() {
    const current = this.current();
    if (!current) return null;
    current.status = 'suspended';
    this.state.events.unshift({
      at: new Date().toISOString(),
      username: current.username,
      message: 'Oturum sahibi hesabın askıya alındığı tespit edildi.',
    });
    const next = this.state.autoSwitch ? this.nextAvailable(current.id) : null;
    if (next) {
      this.state.activeId = next.id;
      this.state.events.unshift({
        at: new Date().toISOString(),
        username: next.username,
        message: 'Sonraki tanımlı hesaba geçildi.',
      });
    }
    this.state.events = this.state.events.slice(0, 100);
    await this.save();
    return next;
  }
  // A restriction is temporary (unlike suspension) — the account stays
  // enabled, just excluded from nextAvailable() until `until` passes, so
  // it's naturally eligible again later without any manual reset.
  async restrictAndNext(until) {
    const current = this.current();
    if (!current) return null;
    current.restrictedUntil = until;
    this.state.events.unshift({
      at: new Date().toISOString(),
      username: current.username,
      message: `İşlem kısıtlaması algılandı; ${new Date(until).toLocaleString('tr-TR')} tarihine kadar bu hesap kullanılmayacak.`,
    });
    const next = this.state.autoSwitch ? this.nextAvailable(current.id) : null;
    if (next) {
      this.state.activeId = next.id;
      this.state.events.unshift({
        at: new Date().toISOString(),
        username: next.username,
        message: 'Kısıt nedeniyle sonraki tanımlı hesaba geçildi.',
      });
    }
    this.state.events = this.state.events.slice(0, 100);
    await this.save();
    return next;
  }
}
