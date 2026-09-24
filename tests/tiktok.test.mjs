import test from 'node:test';
import assert from 'node:assert/strict';
import { tiktokProfile, TikTok } from '../server/tiktok.mjs';
import { parseInput, rowValues } from '../server/domain.mjs';
import { cachedProfile } from '../server/profile-cache.mjs';
import { profileUrl, platformName, searchTerms } from '../server/platform.mjs';
import { Outreach } from '../server/outreach.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

void test('TikTok input, search phrases and profile URLs remain platform specific', () => {
  assert.deepEqual(
    parseInput(
      'https://www.tiktok.com/@creator?lang=en @creator',
      false,
      'tiktok',
    ),
    ['creator'],
  );
  assert.deepEqual(parseInput('tiktok\n@creator', true, 'tiktok'), ['creator']);
  assert.throws(() =>
    parseInput('https://instagram.com/creator', false, 'tiktok'),
  );
  assert.throws(() =>
    parseInput('https://tiktok.com/@creator/video/123', false, 'tiktok'),
  );
  assert.throws(() => parseInput('https://tiktok.com/@creator'));
  assert.throws(() => platformName('youtube'));
  assert.deepEqual(searchTerms(' yoga instructor\nwellness\nyoga instructor'), [
    'yoga instructor',
    'wellness',
  ]);
  assert.equal(
    profileUrl('creator', 'tiktok'),
    'https://www.tiktok.com/@creator',
  );
});

void test('TikTok hydration extracts matching exact counts, bio contacts, privacy; missing facts remain null', () => {
  const profile = tiktokProfile(
    {
      __DEFAULT_SCOPE__: {
        'webapp.user-detail': {
          userInfo: {
            user: {
              uniqueId: 'creator',
              nickname: 'Example',
              signature: 'Business inquiries DM or hello@example.com',
              privateAccount: false,
            },
            stats: { followerCount: '15001', followingCount: 42 },
          },
        },
      },
    },
    'creator',
  );
  assert.equal(profile.platform, 'tiktok');
  assert.equal(profile.email, 'hello@example.com');
  assert.equal(profile.followers, 15001);
  assert.equal(profile.following, 42);
  assert.equal(profile.private, false);
  assert.equal(rowValues(profile)[12], 'TikTok');
  assert.equal(
    tiktokProfile({ user: { uniqueId: 'other' }, stats: {} }, 'creator'),
    null,
  );
  const missing = tiktokProfile(
    { user: { uniqueId: 'creator' }, stats: { followerCount: '1.5K' } },
    'creator',
  );
  assert.equal(missing.followers, null);
  assert.equal(missing.bio, null);
  assert.equal(missing.private, null);
});

void test('TikTok cache and outreach do not confuse matching Instagram usernames', async () => {
  const row = {
    username: 'creator',
    bio: 'Contact DM for collaboration',
    dmForCollaboration: true,
    private: false,
    followers: 12,
    following: 1,
  };
  const jobs = [{ id: 'ig', rows: [row] }];
  assert.equal(cachedProfile(jobs, 'creator', 'tiktok'), null);
  assert.ok(cachedProfile(jobs, 'creator'));
  jobs.push({
    id: 'tt',
    platform: 'tiktok',
    rows: [{ ...row, platform: 'tiktok', followers: 100 }],
  });
  assert.equal(cachedProfile(jobs, 'creator', 'tiktok').followers, 100);
  const dir = await mkdtemp(tmpdir() + '/tiktok-outreach-');
  try {
    const outreach = await new Outreach(dir).init();
    assert.equal((await outreach.add([row], 'ig')).added, 1);
    assert.equal(
      (await outreach.add([{ ...row, platform: 'tiktok' }], 'tt')).added,
      1,
    );
    assert.equal(
      (await outreach.add([{ ...row, platform: 'tiktok' }], 'tt')).added,
      0,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test('TikTok restrictions and challenges stop the scan; cancelled scan never opens a browser', async () => {
  const tiktok = new TikTok();
  const page = (text) => ({
    url: () => 'https://www.tiktok.com/search/user',
    locator: () => ({ innerText: async () => text, count: async () => 0 }),
  });
  await assert.rejects(
    tiktok.guard(page('Too many requests')),
    (e) => e.blocked && e.restrictedUntil > Date.now(),
  );
  await assert.rejects(
    tiktok.guard(page('Verify to continue')),
    (e) => e.blocked && !e.restrictedUntil,
  );
  const controller = new AbortController();
  controller.abort();
  tiktok.browser = () => {
    throw new Error('must not open');
  };
  await assert.rejects(
    tiktok.profile('creator', controller.signal),
    (e) => e.name === 'AbortError',
  );
});
