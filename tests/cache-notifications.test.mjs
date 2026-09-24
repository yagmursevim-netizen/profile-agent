import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cachedProfile,
  cachedFollowing,
  needsInstagram,
  rejectedUsernames,
} from '../server/profile-cache.mjs';
import {
  notifyRestriction,
  notifyCrash,
  notifyTest,
  NOTIFICATION_RECIPIENTS,
} from '../server/notifications.mjs';
const row = {
  username: 'example',
  bio: 'İşbirliği için DM',
  followers: 100,
  following: 20,
  private: false,
  error: null,
  collectedAt: '2026-01-01T00:00:00Z',
};
void test('cache preserves dates, reuses real profiles and source lists, excludes demo and unreadable profiles', () => {
  const jobs = [
    {
      id: 'real',
      mode: 'following',
      sources: ['source'],
      limit: 1,
      total: 1,
      status: 'completed',
      rows: [row],
      warnings: [],
    },
  ];
  assert.equal(cachedProfile(jobs, 'EXAMPLE').collectedAt, row.collectedAt);
  assert.equal(cachedProfile(jobs, 'example').reused, true);
  assert.equal(cachedProfile(jobs, 'example').dmForCollaboration, true);
  assert.equal(cachedProfile([{ ...jobs[0], demo: true }], 'example'), null);
  assert.equal(
    cachedProfile(
      [{ ...jobs[0], rows: [{ ...row, error: 'missing' }] }],
      'example',
    ),
    null,
  );
  assert.equal(
    cachedProfile(
      [{ ...jobs[0], rows: [{ ...row, followers: null }] }],
      'example',
    ).followers,
    null,
  );
  assert.equal(needsInstagram(jobs, ['example'], 'profiles', 1), false);
  assert.equal(needsInstagram(jobs, ['source'], 'following', 1), false);
  assert.equal(needsInstagram(jobs, ['source'], 'following', 2), true);
  assert.deepEqual(cachedFollowing(jobs, 'source', 1).users, ['example']);
  assert.equal(row.reused, undefined);
});
void test('rejectedUsernames collects past "Uygun değil" verdicts across jobs, case-insensitively, excluding demo and other platforms', () => {
  const jobs = [
    {
      id: 'a',
      demo: false,
      platform: 'instagram',
      rows: [
        { username: 'Kicked', ai: { verdict: 'Uygun değil' } },
        { username: 'kept', ai: { verdict: 'Uygun aday' } },
        { username: 'unassessed', ai: null },
      ],
    },
    {
      id: 'demo',
      demo: true,
      platform: 'instagram',
      rows: [{ username: 'demoperson', ai: { verdict: 'Uygun değil' } }],
    },
    {
      id: 'tiktok',
      platform: 'tiktok',
      rows: [{ username: 'tiktokperson', ai: { verdict: 'Uygun değil' } }],
    },
  ];
  const rejected = rejectedUsernames(jobs, 'instagram');
  assert.equal(rejected.has('kicked'), true);
  assert.equal(rejected.has('kept'), false);
  assert.equal(rejected.has('unassessed'), false);
  assert.equal(rejected.has('demoperson'), false);
  assert.equal(rejected.has('tiktokperson'), false);
});
void test('restriction notification goes only to authorized recipients once, persists before send, no secrets or bios', async () => {
  const job = {
    id: 'test',
    sources: ['example'],
    rows: [{ bio: 'private-test-bio' }],
    message: 'Instagram kısıtı',
    restrictedUntil: Date.now() + 60_000,
  };
  let saves = 0,
    calls = 0;
  const config = { gmailAppPassword: 'fakeapppasswordxx' };
  const send = async (mail) => {
    calls++;
    assert.equal(saves, 1);
    assert.deepEqual(
      mail.to,
      NOTIFICATION_RECIPIENTS.map((r) => `"${r.name}" <${r.email}>`),
    );
    assert.equal(mail.text.includes('private-test-bio'), false);
    assert.equal(mail.text.includes('fakeapppasswordxx'), false);
    return { accepted: mail.to };
  };
  await notifyRestriction(
    job,
    config,
    async () => {
      saves++;
    },
    send,
  );
  await notifyRestriction(
    job,
    config,
    async () => {
      saves++;
    },
    send,
  );
  assert.equal(calls, 1);
  assert.equal(job.restrictionNotification.status, 'accepted');
  const unavailable = { ...job, restrictionNotification: undefined };
  await notifyRestriction(
    unavailable,
    {},
    async () => {},
    () => assert.fail('No send without app password'),
  );
  assert.equal(unavailable.restrictionNotification.status, 'unconfigured');
  const uncertain = { ...job, restrictionNotification: undefined };
  await notifyRestriction(
    uncertain,
    config,
    async () => {},
    async () => {
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    },
  );
  assert.equal(uncertain.restrictionNotification.status, 'unknown');
  await notifyRestriction(
    uncertain,
    config,
    async () => {},
    () => assert.fail('No duplicate on uncertainty'),
  );
});
void test('crash notification goes to the authorized recipients, includes no bio text, and never throws even if sending fails', async () => {
  const job = {
    id: 'crashed-job',
    sources: ['example'],
    rows: [{ bio: 'private-test-bio' }],
  };
  const config = { gmailAppPassword: 'fakeapppasswordxx' };
  let calls = 0;
  const send = async (mail) => {
    calls++;
    assert.deepEqual(
      mail.to,
      NOTIFICATION_RECIPIENTS.map((r) => `"${r.name}" <${r.email}>`),
    );
    assert.equal(mail.text.includes('private-test-bio'), false);
    assert.equal(mail.text.includes('crashed-job'), true);
    return { accepted: mail.to };
  };
  await notifyCrash(new Error('boom'), job, config, send);
  assert.equal(calls, 1);
  // No app password: skipped entirely, never throws.
  await notifyCrash(new Error('boom'), job, {}, () =>
    assert.fail('No send without app password'),
  );
  // The send itself failing must not propagate — this runs inside an
  // uncaughtException handler, where a throw would be fatal.
  await notifyCrash(new Error('boom'), null, config, async () => {
    throw new Error('smtp rejected');
  });
});
void test('notifyTest sends to both configured recipients and reports the outcome without throwing', async () => {
  const config = { gmailAppPassword: 'fakeapppasswordxx' };
  const accepted = await notifyTest(config, async (mail) => {
    assert.deepEqual(
      mail.to,
      NOTIFICATION_RECIPIENTS.map((r) => `"${r.name}" <${r.email}>`),
    );
    return { accepted: mail.to };
  });
  assert.equal(accepted.status, 'accepted');
  const failed = await notifyTest(config, async () => {
    throw Object.assign(new Error('Invalid login'), { responseCode: 535 });
  });
  assert.equal(failed.status, 'failed');
  const unknown = await notifyTest(config, async () => {
    throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  });
  assert.equal(unknown.status, 'unknown');
  const unconfigured = await notifyTest({}, () =>
    assert.fail('No send without app password'),
  );
  assert.equal(unconfigured.status, 'failed');
});
