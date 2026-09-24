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
