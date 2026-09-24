import test from 'node:test';
import assert from 'node:assert/strict';
import { Instagram } from '../server/instagram.mjs';
import { cachedProfile } from '../server/profile-cache.mjs';
void test('ready hydration skips delay, delayed fields are awaited, media-only interception preserves data and challenge', async () => {
  for (const late of [false, true]) {
    const ig = new Instagram();
    let waits = 0,
      handler,
      closed = false,
      guarded = false;
    const page = {
      on() {},
      off() {},
      route: async (_, h) => {
        handler = h;
      },
      goto: async () => {},
      waitForTimeout: async () => {
        waits++;
      },
      close: async () => {
        closed = true;
      },
      locator: () => ({
        allTextContents: async () => [
          JSON.stringify({
            username: 'example',
            biography: '',
            follower_count: late && !waits ? null : 12,
            following_count: 2,
            is_private: false,
          }),
        ],
      }),
    };
    ig.browser = async () => ({ newPage: async () => page });
    ig.guard = async () => {
      guarded = true;
    };
    const row = await ig.profile('example', new AbortController().signal);
    assert.equal(waits, late ? 1 : 0);
    assert.equal(row.followers, 12);
    assert.ok(closed && guarded);
    for (const [type, url, expected] of [
      ['image', 'https://cdn.example/avatar.jpg', 'abort'],
      ['fetch', 'https://instagram.com/graphql', 'continue'],
      ['image', 'https://instagram.com/challenge/image', 'continue'],
    ]) {
      let action;
      await handler({
        request: () => ({ resourceType: () => type, url: () => url }),
        abort: () => {
          action = 'abort';
        },
        continue: () => {
          action = 'continue';
        },
      });
      assert.equal(action, expected);
    }
  }
});
void test('readable partial profiles reuse known facts without inventing missing fields', () => {
  const row = {
    username: 'example',
    bio: 'hello',
    followers: null,
    following: 2,
    private: null,
    partialRead: true,
    error: 'missing fields',
  };
  assert.equal(
    cachedProfile([{ id: 'a', rows: [row] }], 'example').reused,
    true,
  );
  assert.equal(
    cachedProfile([{ id: 'a', rows: [row] }], 'example').followers,
    null,
  );
  assert.equal(
    cachedProfile([{ id: 'a', rows: [{ ...row, bio: null }] }], 'example'),
    null,
  );
});
