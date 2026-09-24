import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { TikTokBridge } from '../server/tiktok-bridge.mjs';
import { cachedFollowing, needsInstagram } from '../server/profile-cache.mjs';

void test('following collector scrolls source list, deduplicates and enforces source limit', async () => {
  const bridge = new TikTokBridge();
  const commands = [];
  bridge.request = async (command) => {
    commands.push(command);
    return {
      users:
        commands.length === 1
          ? ['source', 'one', 'one']
          : ['one', 'two', 'three'],
    };
  };
  const result = await bridge.following(
    'source',
    2,
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(result.users, ['one', 'two']);
  assert.deepEqual(
    commands.map((c) => c.kind),
    ['following', 'following-next'],
  );
  assert.ok(commands.every((c) => c.handle === 'source'));
});
void test('unreadable following is not treated as empty; exact zero is explicit', async () => {
  const bridge = new TikTokBridge();
  bridge.request = async () => ({ users: [] });
  await assert.rejects(
    bridge.following('source', 10, new AbortController().signal, () => {}),
    /kullanıcı okunamadı/,
  );
  bridge.request = async () => ({ users: [], following: 0, complete: true });
  assert.equal(
    (
      await bridge.following(
        'source',
        10,
        new AbortController().signal,
        () => {},
      )
    ).following,
    0,
  );
});
void test('TikTok following cache never reuses Instagram lists with the same handle', () => {
  const rows = [
    {
      username: 'one',
      bio: 'Hello',
      followers: 1,
      following: 1,
      private: false,
    },
  ];
  const job = {
    id: 'a',
    mode: 'following',
    sources: ['source'],
    rows,
    limit: 10,
    sourceLists: { source: { users: ['one'], requestedLimit: 10 } },
  };
  assert.equal(cachedFollowing([job], 'source', 10, 'tiktok'), null);
  const tt = { ...job, platform: 'tiktok' };
  assert.equal(
    needsInstagram([tt], ['source'], 'following', 10, 'tiktok'),
    false,
  );
  assert.equal(
    needsInstagram([job], ['source'], 'following', 10, 'tiktok'),
    true,
  );
});
void test('extension opens following control, reads only popup and reports hidden or absent list', async () => {
  const source = await readFile(
    new URL('../chrome-extension/following.js', import.meta.url),
    'utf8',
  );
  let clicked = false;
  const control = {
    getBoundingClientRect: () => ({ height: 10 }),
    click: () => {
      clicked = true;
    },
  };
  const root = {
    innerText: 'Following',
    getBoundingClientRect: () => ({ height: 100 }),
    querySelectorAll: (selector) =>
      selector === 'a[href]'
        ? [
            { href: 'https://www.tiktok.com/@one' },
            { href: 'https://www.tiktok.com/@one/video/123' },
          ]
        : [],
  };
  let roots = [root];
  const context = vm.createContext({
    URL,
    location: { origin: 'https://www.tiktok.com' },
    getComputedStyle: () => ({ visibility: 'visible' }),
    document: {
      querySelector: () => ({ textContent: '12', closest: () => control }),
      querySelectorAll: () => roots,
    },
  });
  vm.runInContext(source, context);
  vm.runInContext("tikTokFollowing('open')", context);
  assert.equal(clicked, true);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(vm.runInContext("tikTokFollowing('read')", context)),
    ).users,
    ['one'],
  );
  root.innerText = 'Following list is private';
  assert.match(
    vm.runInContext("tikTokFollowing('read')", context).error,
    /gizli/,
  );
  roots = [];
  assert.match(
    vm.runInContext("tikTokFollowing('read')", context).error,
    /açılamadı/,
  );
});
