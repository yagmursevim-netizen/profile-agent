import {
  defaultMailIdentity,
  validateMailIdentity,
} from './sender-identity.mjs';
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const digest = (s) => createHash('sha256').update(s).digest('hex');
export const publicUser = ({
  id,
  username,
  name,
  role,
  disabled,
  mustChangePassword,
  mailIdentity,
}) => ({
  id,
  username,
  name,
  role,
  disabled,
  mustChangePassword,
  mailIdentity,
});
export function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
async function hash(password, salt = randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: (await derive(password, salt, 64, options)).toString('hex'),
  };
}
function validPassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 128
  )
    throw fail('Şifre 12–128 karakter olmalı.');
}
export class Auth {
  constructor(dir = '.local', secure = false) {
    this.secure = secure;
    this.dir = dir;
    this.users = [];
    this.sessions = new Map();
    this.attempts = new Map();
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      this.users = JSON.parse(await readFile(`${this.dir}/users.json`, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const lines = [
        'Hiwell Partner Studio — geçici giriş bilgileri',
        'İlk girişte şifre değişikliği zorunludur. Bilgileri ilgili kişiye güvenli şekilde ilettikten sonra bu dosyayı silin.',
        '',
      ];
      for (const [username, name, role] of [
        ['admin', 'Admin', 'admin'],
        ['melisa', 'Melisa', 'member'],
        ['isil', 'Işıl', 'member'],
      ]) {
        const password = randomBytes(18).toString('base64url');
        this.users.push({
          id: randomUUID(),
          username,
          name,
          role,
          disabled: false,
          mustChangePassword: true,
          ...(await hash(password)),
        });
        lines.push(
          `${name}: kullanıcı adı ${username} | geçici şifre ${password}`,
        );
      }
      await writeFile(`${this.dir}/ilk-giris.txt`, lines.join('\n'), {
        mode: 0o600,
      });
      await this.save();
    }
    let migrated = false;
    for (const user of this.users) {
      if (!Object.hasOwn(user, 'mailIdentity')) {
        user.mailIdentity = defaultMailIdentity(user.username);
        migrated = true;
      }
    }
    if (migrated) await this.save();
    this.dummy = await hash(randomBytes(24).toString('hex'));
    return this;
  }
  async save() {
    await writeFile(`${this.dir}/users.tmp`, JSON.stringify(this.users), {
      mode: 0o600,
    });
    await rename(`${this.dir}/users.tmp`, `${this.dir}/users.json`);
  }
  serialize(fn) {
    const next = this.queue.catch(() => {}).then(fn);
    this.queue = next;
    return next;
  }
  async verify(user, password) {
    if (typeof password !== 'string' || password.length > 128) return false;
    const value = await hash(password, user.salt);
    return timingSafeEqual(
      Buffer.from(value.hash, 'hex'),
      Buffer.from(user.hash, 'hex'),
    );
  }
  token(req) {
    return (
      (req.headers.cookie || '')
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('hiwell_session='))
        ?.slice(15) || ''
    );
  }
  user(req) {
    const key = digest(this.token(req));
    const s = this.sessions.get(key);
    if (!s) return null;
    if (s.expires < Date.now() || s.seen < Date.now() - 30 * 60_000) {
      this.sessions.delete(key);
      return null;
    }
    const user = this.users.find((u) => u.id === s.userId && !u.disabled);
    if (!user) {
      this.sessions.delete(key);
      return null;
    }
    s.seen = Date.now();
    return user;
  }
  cookie(res, token = '') {
    res.setHeader(
      'Set-Cookie',
      `hiwell_session=${token}; HttpOnly; SameSite=Strict; Path=/api; ${this.secure ? 'Secure; ' : ''}Max-Age=${token ? 28800 : 0}`,
    );
  }
  revoke(id) {
    for (const [key, s] of this.sessions)
      if (s.userId === id) this.sessions.delete(key);
  }
  logout(req, res) {
    this.sessions.delete(digest(this.token(req)));
    this.cookie(res);
  }
  throttle(key, max) {
    const now = Date.now();
    for (const [k, a] of this.attempts)
      if (a.until < now) this.attempts.delete(k);
    const a = this.attempts.get(key) || { count: 0, until: now + 15 * 60_000 };
    if (++a.count > max)
      throw fail(
        'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.',
        429,
      );
    this.attempts.set(key, a);
  }
  async login(input, req, res) {
    const username = String(input.username || '')
      .trim()
      .toLowerCase()
      .slice(0, 64);
    this.throttle('global', 40);
    this.throttle(`user:${username}`, 5);
    const user = this.users.find((u) => u.username === username);
    const ok = await this.verify(user || this.dummy, input.password);
    if (!ok || !user || user.disabled)
      throw fail('Kullanıcı adı veya şifre hatalı.', 401);
    this.attempts.delete(`user:${username}`);
    // Re-check after async hashing in case an admin disabled or reset the user.
    if (!this.users.includes(user) || user.disabled)
      throw fail('Tekrar giriş yapın.', 401);
    this.logout(req, res);
    for (const [k, s] of this.sessions)
      if (s.expires < Date.now()) this.sessions.delete(k);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(digest(token), {
      userId: user.id,
      expires: Date.now() + 8 * 3600_000,
      seen: Date.now(),
    });
    this.cookie(res, token);
    return publicUser(user);
  }
  change(user, input) {
    return this.serialize(async () => {
      if (
        !this.users.includes(user) ||
        !(await this.verify(user, input.currentPassword))
      )
        throw fail('Mevcut şifre hatalı.');
      validPassword(input.password);
      if (input.password === input.currentPassword)
        throw fail('Yeni şifre mevcut şifreden farklı olmalı.');
      const next = {
        ...user,
        ...(await hash(input.password)),
        mustChangePassword: false,
      };
      this.users = this.users.map((u) => (u.id === user.id ? next : u));
      await this.save();
      this.revoke(user.id);
      return { ok: true };
    });
  }
  manage(input) {
    return this.serialize(async () => {
      if (input.action === 'create') {
        const username = String(input.username || '')
          .trim()
          .toLowerCase();
        const name = String(input.name || '').trim();
        if (!/^[a-z0-9._-]{3,40}$/.test(username) || !name || name.length > 80)
          throw fail(
            'Kullanıcı adı 3–40 harf/rakam içermeli; ad alanı zorunludur.',
          );
        if (this.users.some((u) => u.username === username))
          throw fail('Bu kullanıcı adı zaten var.');
        const password = randomBytes(18).toString('base64url');
        const user = {
          id: randomUUID(),
          username,
          name,
          role: 'member',
          mailIdentity: defaultMailIdentity(''),
          disabled: false,
          mustChangePassword: true,
          ...(await hash(password)),
        };
        this.users.push(user);
        await this.save();
        return { user: publicUser(user), temporaryPassword: password };
      }
      const user = this.users.find((u) => u.id === input.id);
      if (user && input.action === 'email') {
        const next = { ...user, mailIdentity: validateMailIdentity(input) };
        this.users = this.users.map((u) => (u.id === user.id ? next : u));
        await this.save();
        return { user: publicUser(next) };
      }
      if (!user || user.role === 'admin')
        throw fail('Tek admin hesabı bu ekrandan değiştirilemez.');
      let next = { ...user };
      let password;
      if (input.action === 'reset') {
        password = randomBytes(18).toString('base64url');
        next = { ...next, ...(await hash(password)), mustChangePassword: true };
      } else if (input.action === 'toggle') next.disabled = !user.disabled;
      else throw fail('Geçersiz kullanıcı işlemi.');
      this.users = this.users.map((u) => (u.id === user.id ? next : u));
      await this.save();
      this.revoke(user.id);
      return { user: publicUser(next), temporaryPassword: password };
    });
  }
}
