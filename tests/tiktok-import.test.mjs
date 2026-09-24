import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { importTikTok } from '../server/tiktok-import.mjs';
const source = await readFile(
  new URL('../chrome-extension/extract.js', import.meta.url),
  'utf8',
);
function extract(payload, href = 'https://www.tiktok.com/@creator') {
  const context = vm.createContext({
    URL,
    location: { href },
    document: {
      body: { innerText: 'Profile' },
      querySelectorAll: () => [{ textContent: JSON.stringify(payload) }],
      querySelector: () => null,
    },
  });
  return JSON.parse(
    JSON.stringify(
      vm.runInContext(source + '\nextractTikTokProfile()', context),
    ),
  );
}
void test('extension extracts only profile fields and import recomputes email and signals', () => {
  const exported = extract({
    userInfo: {
      user: {
        uniqueId: 'creator',
        nickname: 'Creator',
        signature: 'Business inquiries DM hello@example.com',
        privateAccount: false,
        secret: 'never-export',
      },
      stats: { followerCount: 2300, followingCount: 50 },
    },
    token: 'never-export',
  });
  assert.ok(!JSON.stringify(exported).includes('never-export'));
  const row = importTikTok({
    ...exported,
    profile: {
      ...exported.profile,
      ai: { verdict: 'forged' },
      email: 'forged@example.com',
    },
  });
  assert.equal(row.email, 'hello@example.com');
  assert.equal(row.ai, null);
  assert.equal(row.platform, 'tiktok');
  assert.equal(row.followers, 2300);
  assert.equal(row.imported, true);
});
void test('extension rejects non-profile pages; import rejects forged structure, URL and rounded counts', () => {
  assert.throws(() => extract({}, 'https://www.tiktok.com/search?q=yoga'));
  assert.throws(() => extract({}, 'https://example.com/@creator'));
  assert.throws(() => extract({}));
  const value = extract({
    user: {
      uniqueId: 'creator',
      nickname: 'Creator',
      signature: '',
      privateAccount: false,
    },
    stats: { followerCount: 10, followingCount: 2 },
  });
  assert.throws(() =>
    importTikTok({ ...value, sourceUrl: 'https://example.com/@creator' }),
  );
  assert.throws(() =>
    importTikTok({
      ...value,
      profile: { ...value.profile, followers: '2.3K' },
    }),
  );
  assert.throws(() => importTikTok({ ...value, collectedAt: 'invalid' }));
  assert.throws(() => importTikTok({ format: 'unknown' }));
});
