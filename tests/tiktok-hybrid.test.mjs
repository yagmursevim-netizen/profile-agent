import test from 'node:test';
import assert from 'node:assert/strict';
import {
  domProfile,
  mergeProfile,
  searchEvidence,
  externalFallback,
} from '../server/tiktok-hybrid.mjs';
import { tiktokProfile } from '../server/tiktok.mjs';
void test('DOM validates identity, preserves empty bio and refuses rounded counts and unsafe links', () => {
  assert.equal(
    domProfile({ username: 'other', bio: 'wrong' }, 'creator'),
    null,
  );
  const row = domProfile(
    {
      username: '@creator',
      bio: '',
      followers: '2.3K',
      following: '10',
      link: 'javascript:alert(1)',
    },
    'creator',
  );
  assert.equal(row.bio, '');
  assert.equal(row.followers, null);
  assert.equal(row.following, 10);
  assert.equal(row.private, null);
  assert.equal(row.bioLink, null);
});
void test('JSON without stats remains readable; HTML fills missing bio and signals without losing exact counts', () => {
  assert.equal(
    tiktokProfile(
      { user: { uniqueId: 'creator', signature: 'hello' } },
      'creator',
    ).bio,
    'hello',
  );
  const json = tiktokProfile(
    { user: { uniqueId: 'creator' }, stats: { followerCount: 12345 } },
    'creator',
  );
  const html = domProfile(
    { username: 'creator', bio: 'Contact hello@example.com', followers: '12K' },
    'creator',
  );
  const row = mergeProfile(json, html);
  assert.equal(row.followers, 12345);
  assert.equal(row.email, 'hello@example.com');
  assert.equal(row.bioSource, 'TikTok HTML');
});
void test('search evidence accepts only exact TikTok profile URLs, never video or similar handles', () => {
  const payload = {
    organic_results: [
      { url: 'https://www.tiktok.com/@creator/video/1', description: 'wrong' },
      { url: 'https://www.tiktok.com/@creator2', description: 'wrong' },
      {
        url: 'https://www.tiktok.com/@creator',
        description: 'possibly old snippet',
      },
    ],
  };
  assert.equal(searchEvidence(payload, 'creator').text, 'possibly old snippet');
});
void test('external services are opt-in; fallback is bounded and secret never in URL', async () => {
  let calls = 0;
  const signal = new AbortController().signal;
  await externalFallback(
    'creator',
    signal,
    () => {
      calls++;
    },
    {},
  );
  assert.equal(calls, 0);
  const result = await externalFallback(
    'creator',
    signal,
    async (url, options) => {
      calls++;
      assert.ok(!url.href.includes('secret'));
      assert.equal(options.headers.Authorization, 'Bearer secret');
      return {
        ok: true,
        json: async () =>
          calls === 1
            ? { username: 'wrong', bio: 'wrong' }
            : {
                organic_results: [
                  {
                    url: 'https://www.tiktok.com/@creator',
                    description: 'snippet',
                  },
                ],
              },
      };
    },
    {
      SCRAPINGBEE_API_KEY: 'secret',
      TIKTOK_SCRAPINGBEE_ENABLED: 'true',
      TIKTOK_GOOGLE_ENABLED: 'true',
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.profile, undefined);
  assert.equal(result.evidence.text, 'snippet');
});
