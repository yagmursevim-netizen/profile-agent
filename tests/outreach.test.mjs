import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Outreach, renderTemplate } from '../server/outreach.mjs';
const sender = {
  sendgridKey: 'test-only-token',
  fromEmail: 'hello@example.com',
  fromName: 'Test',
};
const row = (n) => ({
  username: `aday${n}`,
  fullName: `İsim ${n}`,
  email: `aday${n}@example.com`,
});
async function fixture(fn, fetcher) {
  const dir = await mkdtemp(path.join(tmpdir(), 'outreach-test-'));
  try {
    await fn(await new Outreach(dir, fetcher).init(), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
void test('50 profiles receive 30/20 template assignments and personalized previews persist', () =>
  fixture(async (o, dir) => {
    const a = await o.template({
      name: 'Şablon 1',
      subject: 'Merhaba {{ad}}',
      body: 'Merhaba {{isim}}, @{{kullanici_adi}} için iş birliği.',
    });
    const b = await o.template({
      name: 'Şablon 2',
      subject: 'Hiwell',
      body: 'Sayın {{isim}}',
    });
    assert.equal(
      (
        await o.add(
          Array.from({ length: 50 }, (_, i) => row(i)),
          'job',
        )
      ).added,
      50,
    );
    const ids = o.snapshot().contacts.map((c) => c.id);
    await o.assign(ids.slice(0, 30), a.id);
    await o.assign(ids.slice(30), b.id);
    const preview = o.preview(ids, sender);
    assert.equal(
      preview.messages.filter((m) => m.templateName === 'Şablon 1').length,
      30,
    );
    assert.equal(
      preview.messages.filter((m) => m.templateName === 'Şablon 2').length,
      20,
    );
    assert.equal(
      preview.messages[0].body,
      'Merhaba İsim 0, @aday0 için iş birliği.',
    );
    const restored = await new Outreach(dir).init();
    assert.equal(restored.snapshot().contacts.length, 50);
    assert.equal(restored.snapshot().templates.length, 2);
    assert.equal((await o.add([row(0)], 'other')).added, 0);
    assert.equal(
      (
        await o.add(
          [{ username: 'dm', email: null, dmForCollaboration: true }],
          'job',
        )
      ).added,
      1,
    );
    assert.throws(
      () => renderTemplate({ subject: '{{bilinmeyen}}', body: 'test' }, row(1)),
      /Bilinmeyen/,
    );
  }));
void test('SendGrid uses isolated recipients and accepted records cannot be resent', () =>
  fixture(
    async (o) => {
      const t = await o.template({
        name: 'Test',
        subject: 'Hi {{isim}}',
        body: 'Hello {{ad}}',
      });
      await o.add([row(1)], 'job');
      const id = o.snapshot().contacts[0].id;
      await o.assign([id], t.id);
      const p = o.preview([id], sender);
      assert.deepEqual(await o.send(p.id, sender), {
        accepted: 1,
        failed: 0,
        unknown: 0,
      });
      assert.equal(o.snapshot().contacts[0].status, 'accepted');
      await assert.rejects(o.send(p.id, sender), /Önizleme/);
      assert.throws(() => o.preview([id], sender), /Yeniden gönderilemez/);
    },
    async (url, options) => {
      assert.equal(url, 'https://api.sendgrid.com/v3/mail/send');
      assert.equal(options.headers.Authorization, 'Bearer test-only-token');
      const b = JSON.parse(options.body);
      assert.equal(b.personalizations.length, 1);
      assert.equal(b.personalizations[0].to.length, 1);
      assert.equal(b.personalizations[0].subject, 'Hi İsim 1');
      assert.equal(b.content[0].type, 'text/plain');
      return new Response(null, {
        status: 202,
        headers: { 'x-message-id': 'fake-message' },
      });
    },
  ));
void test('changed templates invalidate preview and ambiguous sends stay blocked', () =>
  fixture(
    async (o) => {
      const t = await o.template({
        name: 'Test',
        subject: 'Hello',
        body: 'Hi {{isim}}',
      });
      await o.add([row(2)], 'job');
      const id = o.snapshot().contacts[0].id;
      await o.assign([id], t.id);
      const p = o.preview([id], sender);
      await o.template({ ...t, body: 'Changed' });
      await assert.rejects(o.send(p.id, sender), /değişti/);
      const p2 = o.preview([id], sender);
      assert.deepEqual(await o.send(p2.id, sender), {
        accepted: 0,
        failed: 0,
        unknown: 1,
      });
      assert.throws(() => o.preview([id], sender), /Yeniden gönderilemez/);
    },
    async () => {
      throw new Error('timeout');
    },
  ));
void test('demo contacts can be previewed but never sent', () =>
  fixture(
    async (o) => {
      const t = await o.template({
        name: 'Test',
        subject: 'Hello',
        body: 'Hi {{isim}}',
      });
      await o.add([row(3)], 'demo', true);
      const id = o.snapshot().contacts[0].id;
      await o.assign([id], t.id);
      const p = o.preview([id], sender);
      assert.equal(p.canSend, false);
      await assert.rejects(o.send(p.id, sender), /Örnek/);
    },
    async () => {
      assert.fail('No network request permitted');
    },
  ));
void test('DM-only contacts persist separately, deduplicate and cannot receive email', () =>
  fixture(async (o, dir) => {
    const profiles = [1, 2].map((n) => ({
      username: `dm${n}`,
      email: null,
      dmForCollaboration: true,
      dmEvidence: 'İş birliği için DM',
    }));
    assert.equal((await o.add(profiles, 'job')).added, 2);
    assert.equal((await o.add(profiles, 'job')).added, 0);
    const ids = o.snapshot().contacts.map((c) => c.id);
    assert.equal(o.snapshot().contacts[0].channel, 'dm');
    assert.throws(() => o.preview(ids, sender), /DM adayı/);
    const template = await o.template({
      name: 't',
      subject: 'hello',
      body: 'Hi {{isim}}',
    });
    await assert.rejects(o.assign(ids, template.id), /DM adaylarına/);
    await o.edit({ id: ids[0], name: 'DM Name', email: '' });
    const restored = await new Outreach(dir).init();
    assert.equal(restored.snapshot().contacts.length, 2);
    await o.edit({ id: ids[0], name: 'DM Name', email: 'new@example.com' });
    assert.equal(o.snapshot().contacts[0].channel, 'email');
    await o.assign([ids[0]], template.id);
    assert.equal(
      o.preview([ids[0]], sender).messages[0].email,
      'new@example.com',
    );
  }));
