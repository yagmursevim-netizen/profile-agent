import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { TestEmail, TEST_SUBJECT } from '../server/test-email.mjs';
const config = {
  sendgridKey: 'fake-test-key',
  fromEmail: 'hello@example.com',
  fromName: 'Hiwell',
};
async function fixture(fetcher, fn) {
  const dir = await mkdtemp(tmpdir() + '/hiwell-mail-test-');
  try {
    await fn(await new TestEmail(dir, fetcher).init(), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
void test('test email sends one explicit recipient and preserves result across restart without exposing key', () =>
  fixture(
    async (url, init) => {
      assert.equal(url, 'https://api.sendgrid.com/v3/mail/send');
      assert.equal(init.headers.Authorization, 'Bearer fake-test-key');
      const p = JSON.parse(init.body);
      assert.deepEqual(p.personalizations[0].to, [
        { email: 'recipient@example.com' },
      ]);
      assert.equal(p.personalizations[0].subject, TEST_SUBJECT);
      assert.equal(p.from.email, config.fromEmail);
      return new Response(null, { status: 202 });
    },
    async (service, dir) => {
      const input = { email: 'recipient@example.com', requestId: randomUUID() };
      const result = await service.send(input, config);
      assert.equal(result.status, 'accepted');
      assert.match(result.message, /teslimat onayı değildir/);
      const restored = await new TestEmail(dir, () =>
        assert.fail('No duplicate sending'),
      ).init();
      assert.equal((await restored.send(input, config)).status, 'accepted');
      assert.equal(
        (await readFile(dir + '/email-tests.json', 'utf8')).includes(
          config.sendgridKey,
        ),
        false,
      );
      await assert.rejects(
        restored.send({ ...input, requestId: randomUUID() }, config),
        /30 saniye/,
      );
    },
  ));
void test('test email rejects invalid recipient or missing key without a network request', () =>
  fixture(
    () => assert.fail('No network'),
    async (service) => {
      await assert.rejects(
        service.send(
          { email: 'recipient@example.com', requestId: randomUUID() },
          {},
        ),
        /token/,
      );
      await assert.rejects(
        service.send(
          { email: 'a@example.com,b@example.com', requestId: randomUUID() },
          config,
        ),
        /Geçerli/,
      );
      assert.equal(service.latest(), null);
    },
  ));
void test('test email distinguishes authentication rejection from ambiguous delivery and does not auto retry', async () => {
  for (const code of [401, 403, 500])
    await fixture(
      async () => new Response(null, { status: code }),
      async (service) => {
        const result = await service.send(
          { email: 'r@example.com', requestId: randomUUID() },
          config,
        );
        assert.equal(result.status, code === 500 ? 'unknown' : 'failed');
        assert.match(result.message, new RegExp(String(code)));
      },
    );
  await fixture(
    async () => {
      throw new Error('timeout');
    },
    async (service, dir) => {
      const input = { email: 'r@example.com', requestId: randomUUID() };
      assert.equal((await service.send(input, config)).status, 'unknown');
      const restored = await new TestEmail(dir, () =>
        assert.fail('No retry'),
      ).init();
      assert.equal((await restored.send(input, config)).status, 'unknown');
    },
  );
});
