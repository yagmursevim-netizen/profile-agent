import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Auth } from '../server/auth.mjs';
import { Instagram } from '../server/instagram.mjs';
void test('auth rejects forgery, limits guesses, revokes reset sessions and expires sessions', async () => {
  const dir = await mkdtemp(tmpdir() + '/hiwell-auth-');
  try {
    const auth = await new Auth(dir).init();
    const text = await readFile(dir + '/ilk-giris.txt', 'utf8');
    const password = text
      .split('\n')
      .find((l) => l.includes('kullanıcı adı isil |'))
      .split('geçici şifre ')[1];
    let cookie;
    const res = {
      setHeader: (_, value) => {
        cookie = value.split(';')[0];
      },
    };
    await auth.login({ username: 'isil', password }, { headers: {} }, res);
    const req = { headers: { cookie } };
    assert.equal(auth.user(req).name, 'Işıl');
    assert.equal(
      auth.user({ headers: { cookie: 'hiwell_session=forged' } }),
      null,
    );
    await auth.manage({
      action: 'reset',
      id: auth.users.find((u) => u.username === 'isil').id,
    });
    assert.equal(auth.user(req), null);
    const next = await new Auth(dir).init();
    assert.equal(next.user(req), null);
    for (let i = 0; i < 5; i++)
      await assert.rejects(
        auth.login(
          { username: 'no-user', password: 'bad' },
          { headers: {} },
          res,
        ),
        (e) => e.status === 401,
      );
    await assert.rejects(
      auth.login(
        { username: 'no-user', password: 'bad' },
        { headers: {} },
        res,
      ),
      (e) => e.status === 429,
    );
    const session = { userId: auth.users[0].id, seen: 0, expires: 0 };
    const { createHash } = await import('node:crypto');
    auth.sessions.set(
      createHash('sha256').update('expired').digest('hex'),
      session,
    );
    assert.equal(
      auth.user({ headers: { cookie: 'hiwell_session=expired' } }),
      null,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
void test('Instagram guard distinguishes rate restrictions from login challenges and honors retry time', async () => {
  const ig = new Instagram();
  const page = (url, text) => ({
    url: () => url,
    locator: () => ({ innerText: async () => text }),
  });
  await assert.rejects(
    ig.guard(page('https://www.instagram.com/example/', 'Try again later')),
    (e) => e.blocked && e.restrictedUntil > Date.now(),
  );
  await assert.rejects(
    ig.guard(page('https://www.instagram.com/challenge/', 'Confirm it is you')),
    (e) => e.blocked && !e.restrictedUntil,
  );
  const limited = page('https://www.instagram.com/example/', '');
  const until = Date.now() + 3600_000;
  ig.restrictedPages.set(limited, until);
  await assert.rejects(ig.guard(limited), (e) => e.restrictedUntil === until);
});
