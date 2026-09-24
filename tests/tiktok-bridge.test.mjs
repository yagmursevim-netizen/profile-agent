import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { TikTokBridge } from '../server/tiktok-bridge.mjs';
const ext = 'a'.repeat(32);
const client = '11111111-1111-4111-8111-111111111111';
const req = (token) => ({
  headers: {
    authorization: 'Bearer ' + token,
    origin: 'chrome-extension://' + ext,
    'x-hiwell-extension': ext,
  },
});
const profile = (handle) => ({
  format: 'hiwell-tiktok-profile',
  version: 1,
  collectedAt: new Date().toISOString(),
  sourceUrl: 'https://www.tiktok.com/@' + handle,
  profile: {
    username: handle,
    fullName: 'Creator',
    bio: 'Business contact hello@example.com',
    followers: 1001,
    following: 10,
    private: false,
  },
});
async function fixture(fn) {
  const dir = await mkdtemp(tmpdir() + '/tiktok-bridge-');
  try {
    await fn(await new TikTokBridge(dir).init(), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
void test('bridge pairing is hashed, origin scoped, revocable and only one runner can claim work', () =>
  fixture(async (bridge, dir) => {
    const { token } = await bridge.pair();
    assert.ok(bridge.authenticate(req(token)));
    assert.equal(bridge.authenticate(req('wrong')), false);
    assert.equal(
      bridge.authenticate({
        headers: { ...req(token).headers, origin: 'https://evil.example' },
      }),
      false,
    );
    assert.ok(
      !(await readFile(dir + '/tiktok-bridge.json', 'utf8')).includes(token),
    );
    await bridge.poll(client, ext);
    await assert.rejects(
      bridge.poll('22222222-2222-4222-8222-222222222222', ext),
      (e) => e.status === 409,
    );
    const restored = await new TikTokBridge(dir).init();
    assert.equal(restored.status().connected, false);
    assert.ok(restored.authenticate(req(token)));
    await bridge.pair(true);
    assert.equal(bridge.authenticate(req(token)), false);
  }));
void test('five profiles transfer automatically and duplicate responses do not append or resolve new commands', () =>
  fixture(async (bridge) => {
    await bridge.pair();
    await bridge.poll(client, ext);
    for (let i = 0; i < 5; i++) {
      const handle = 'creator' + i;
      const pending = bridge.profile(handle, new AbortController().signal);
      const { command } = await bridge.poll(client, ext);
      assert.equal(command.kind, 'profile');
      assert.equal(command.handle, handle);
      assert.equal(
        bridge.finish(client, { id: command.id, result: profile(handle) })
          .accepted,
        true,
      );
      assert.equal(
        bridge.finish(client, { id: command.id, result: profile(handle) })
          .accepted,
        false,
      );
      const row = await pending;
      assert.equal(row.email, 'hello@example.com');
      assert.equal(row.collectedVia, 'chrome-extension');
      assert.equal(row.imported, undefined);
    }
  }));
void test('search batches deduplicate and enforce limit; cancellation and restrictions stop commands', () =>
  fixture(async (bridge) => {
    await bridge.pair();
    await bridge.poll(client, ext);
    const controller = new AbortController();
    const search = bridge.search('wellness', 2, controller.signal, () => {});
    const first = (await bridge.poll(client, ext)).command;
    bridge.finish(client, {
      id: first.id,
      result: { users: ['one', 'one', 'two', 'three'] },
    });
    assert.deepEqual((await search).users, ['one', 'two']);
    const pending = bridge.profile('one', controller.signal);
    const rejected = assert.rejects(pending, (e) => e.name === 'AbortError');
    controller.abort();
    await rejected;
    assert.equal((await bridge.poll(client, ext)).command, null);
    const limited = bridge.profile('one', new AbortController().signal);
    const failed = assert.rejects(
      limited,
      (e) => e.blocked && e.restrictedUntil > Date.now(),
    );
    const command = (await bridge.poll(client, ext)).command;
    bridge.finish(client, {
      id: command.id,
      error: 'Too many attempts',
      restricted: true,
    });
    await failed;
  }));
void test('offline and incorrect profile responses fail without guessing data', () =>
  fixture(async (bridge) => {
    await assert.rejects(
      bridge.profile('one', new AbortController().signal),
      (e) => e.blocked,
    );
    await bridge.pair();
    await bridge.poll(client, ext);
    const pending = bridge.profile('one', new AbortController().signal);
    const failed = assert.rejects(pending, /yanlış profil/);
    const command = (await bridge.poll(client, ext)).command;
    bridge.finish(client, { id: command.id, result: profile('other') });
    await failed;
  }));
