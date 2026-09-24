import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTok } from '../server/tiktok.mjs';
function fixture(bio) {
  const tiktok = new TikTok();
  let guards = 0;
  const payload = {
    user: {
      uniqueId: 'creator',
      nickname: 'Creator',
      signature: bio,
      privateAccount: false,
    },
    stats: { followerCount: 10, followingCount: 2 },
  };
  const page = {
    on() {},
    off() {},
    goto: async () => {},
    waitForTimeout: async () => {},
    locator: () => ({ allTextContents: async () => [JSON.stringify(payload)] }),
  };
  tiktok.withPage = async (_, run) =>
    run(page, async () => {
      guards++;
      throw Object.assign(new Error('CAPTCHA'), { blocked: true });
    });
  return { tiktok, guards: () => guards };
}
void test('already delivered bio is saved despite overlay; next profile can be read', async () => {
  const { tiktok, guards } = fixture('Contact hello@example.com');
  for (let i = 0; i < 2; i++) {
    const row = await tiktok.profile('creator', new AbortController().signal);
    assert.equal(row.bio, 'Contact hello@example.com');
    assert.equal(row.email, 'hello@example.com');
  }
  assert.equal(guards(), 0);
});
void test('missing bio stops on verification; an explicitly empty bio is valid', async () => {
  const missing = fixture(undefined);
  await assert.rejects(
    missing.tiktok.profile('creator', new AbortController().signal),
    (e) => e.blocked,
  );
  assert.equal(missing.guards(), 1);
  const empty = fixture('');
  assert.equal(
    (await empty.tiktok.profile('creator', new AbortController().signal)).bio,
    '',
  );
  assert.equal(empty.guards(), 0);
});
void test('HTML bio keeps scan moving when JSON is missing and a login overlay exists', async () => {
  const tiktok = new TikTok();
  let guardCalls = 0;
  tiktok.withPage = async (_, run) =>
    run(
      {
        on() {},
        off() {},
        goto: async () => {},
        waitForTimeout: async () => {},
        locator: () => ({ allTextContents: async () => [] }),
        evaluate: async () => ({
          username: 'creator',
          bio: 'Business hello@example.com',
          followers: '1200',
          following: '20',
          link: 'https://example.com/',
        }),
      },
      async () => {
        guardCalls++;
        throw new Error('Login');
      },
    );
  const row = await tiktok.profile('creator', new AbortController().signal);
  assert.equal(row.email, 'hello@example.com');
  assert.equal(row.bioSource, 'TikTok HTML');
  assert.equal(row.bioLink, 'https://example.com/');
  assert.equal(guardCalls, 0);
});
