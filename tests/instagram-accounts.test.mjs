import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { InstagramAccounts } from '../server/instagram-accounts.mjs';
import { Instagram } from '../server/instagram.mjs';
void test('account passwords encrypted, snapshots redacted, bounded failover persists suspension', async () => {
  const dir = await mkdtemp(tmpdir() + '/ig-accounts-');
  try {
    const store = await new InstagramAccounts(dir).init();
    await store.update({ username: 'first', password: 'secret-first' });
    await store.update({ username: 'second', password: 'secret-second' });
    assert.equal(
      (await readFile(dir + '/ig-accounts.json', 'utf8')).includes(
        'secret-first',
      ),
      false,
    );
    assert.equal(JSON.stringify(store.snapshot()).includes('secret'), false);
    assert.equal(store.password(store.current()), 'secret-first');
    await store.update({ action: 'options', autoSwitch: true });
    const ig = new Instagram();
    ig.accounts = store;
    const prepared = [];
    ig.prepare = async () => prepared.push(store.current().username);
    let runs = 0;
    const result = await ig.recover(async () => {
      runs++;
      if (store.current().username === 'first')
        throw Object.assign(new Error('suspended'), { suspended: true });
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(runs, 2);
    assert.deepEqual(prepared, ['second']);
    const restored = await new InstagramAccounts(dir).init();
    assert.equal(restored.state.accounts[0].status, 'suspended');
    assert.equal(restored.current().username, 'second');
    // 'first' is already suspended, so 'second' (current) has nowhere to
    // switch to — the restriction is still recorded, but recover() has to
    // give up and surface the original error, same as with no accounts at
    // all configured.
    await assert.rejects(
      ig.recover(async () => {
        throw Object.assign(new Error('rate limit'), {
          blocked: true,
          restrictedUntil: 1,
        });
      }),
      /rate limit/,
    );
    assert.equal(store.current().username, 'second');
    assert.equal(store.current().restrictedUntil, 1);
    await assert.rejects(
      ig.recover(async () => {
        throw Object.assign(new Error('suspended'), { suspended: true });
      }),
      /suspended/,
    );
    assert.equal(
      store.state.accounts.every((a) => a.status === 'suspended'),
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
void test('a temporary restriction switches to the next available account and excludes it until it passes, unlike a permanent suspension', async () => {
  const dir = await mkdtemp(tmpdir() + '/ig-accounts-');
  try {
    const store = await new InstagramAccounts(dir).init();
    await store.update({ username: 'first', password: 'secret-first' });
    await store.update({ username: 'second', password: 'secret-second' });
    await store.update({ action: 'options', autoSwitch: true });
    const ig = new Instagram();
    ig.accounts = store;
    ig.prepare = async () => {};
    const until = Date.now() + 60_000;
    let runs = 0;
    const result = await ig.recover(async () => {
      runs++;
      if (store.current().username === 'first')
        throw Object.assign(new Error('restricted'), {
          blocked: true,
          restrictedUntil: until,
        });
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(runs, 2);
    assert.equal(store.current().username, 'second');
    // Restricted, not suspended — stays enabled, just excluded while
    // restrictedUntil hasn't passed yet.
    const first = store.state.accounts.find((a) => a.username === 'first');
    assert.equal(first.status, 'ready');
    assert.equal(first.restrictedUntil, until);
    assert.equal(store.nextAvailable(null)?.username, 'second');
    first.restrictedUntil = Date.now() - 1;
    assert.equal(store.nextAvailable(store.current().id)?.username, 'first');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
void test('rotateNext cycles through every eligible account in order, skips unusable ones, and is a no-op with nowhere to rotate to', async () => {
  const dir = await mkdtemp(tmpdir() + '/ig-accounts-');
  try {
    const store = await new InstagramAccounts(dir).init();
    await store.update({ username: 'first', password: 'secret-first' });
    await store.update({ username: 'second', password: 'secret-second' });
    await store.update({ username: 'third', password: 'secret-third' });
    const third = store.state.accounts.find((a) => a.username === 'third');
    third.status = 'suspended'; // unusable — rotation must skip it
    store.state.activeId = store.state.accounts[0].id;
    const first = await store.rotateNext();
    assert.equal(first.username, 'second');
    assert.equal(store.current().username, 'second');
    // 'third' is suspended, so this wraps all the way back to 'first'
    // instead of stopping at the next account in array order.
    const second = await store.rotateNext();
    assert.equal(second.username, 'first');
    assert.equal(
      store.state.events[0].message,
      'Periyodik rotasyon ile sonraki hesaba geçildi.',
    );
    // Only one usable account left (current excluded, third suspended) —
    // rotating away from it has nowhere to go.
    const secondAcc = store.state.accounts.find((a) => a.username === 'second');
    secondAcc.enabled = false;
    const stuck = await store.rotateNext();
    assert.equal(stuck, null);
    assert.equal(store.current().username, 'first');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
void test('suspension text in target bio never triggers account rotation; actual suspension screen does', async () => {
  const ig = new Instagram();
  const page = (url) => ({
    url: () => url,
    locator: () => ({
      innerText: async () => 'Your account has been suspended',
    }),
  });
  await ig.guard(page('https://www.instagram.com/target/'));
  await assert.rejects(
    ig.guard(page('https://www.instagram.com/accounts/suspended/')),
    (e) => e.suspended === true,
  );
});
