import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Auth } from '../server/auth.mjs';
import { Outreach, sendgridPayload } from '../server/outreach.mjs';
import {
  defaultMailIdentity,
  validateMailIdentity,
  resolveSender,
} from '../server/sender-identity.mjs';

void test('sender aliases keep personal Reply-To and reject other users addresses', () => {
  for (const [username, personal, alias] of [
    ['melisa', 'melisa.onen@hiwellapp.com', 'melisa@hiwellapp.com'],
    ['isil', 'isil.budak@hiwellapp.com', 'isil@hiwellapp.com'],
  ]) {
    const user = {
      id: username,
      name: username,
      mailIdentity: defaultMailIdentity(username),
    };
    for (const email of [personal, alias]) {
      const sender = resolveSender(user, email, {});
      const payload = sendgridPayload(
        { email: 'recipient@example.com', subject: 'Test', body: 'Test' },
        sender,
      );
      assert.equal(payload.from.email, email);
      assert.equal(payload.reply_to.email, personal);
    }
    assert.throws(() => resolveSender(user, 'other@hiwellapp.com', {}));
  }
  assert.throws(() =>
    validateMailIdentity({
      personalEmail: 'a@example.com,b@example.com',
      senderEmails: [],
    }),
  );
  assert.throws(() =>
    validateMailIdentity({
      personalEmail: '',
      senderEmails: ['a@example.com'],
    }),
  );
  assert.deepEqual(
    validateMailIdentity({
      personalEmail: ' A@example.com ',
      senderEmails: ['a@example.com', 'alias@example.com'],
    }).senderEmails,
    ['a@example.com', 'alias@example.com'],
  );
});

void test('migration preserves passwords, identities persist and admin email editing cannot change roles', async () => {
  const dir = await mkdtemp(tmpdir() + '/sender-auth-');
  try {
    await writeFile(
      dir + '/users.json',
      JSON.stringify([
        {
          id: 'm',
          username: 'melisa',
          name: 'Melisa',
          role: 'member',
          hash: 'unchanged',
        },
        {
          id: 'a',
          username: 'admin',
          name: 'Admin',
          role: 'admin',
          hash: 'unchanged',
        },
      ]),
    );
    const auth = await new Auth(dir).init();
    assert.equal(
      auth.users[0].mailIdentity.personalEmail,
      'melisa.onen@hiwellapp.com',
    );
    assert.equal(auth.users[0].hash, 'unchanged');
    await auth.manage({
      action: 'email',
      id: 'm',
      personalEmail: 'new@example.com',
      senderEmails: [],
      role: 'admin',
    });
    await auth.manage({
      action: 'email',
      id: 'a',
      personalEmail: 'admin@example.com',
      senderEmails: [],
    });
    const restored = await new Auth(dir).init();
    assert.equal(restored.users[0].role, 'member');
    assert.equal(
      restored.users[0].mailIdentity.personalEmail,
      'new@example.com',
    );
    assert.equal(
      restored.users[1].mailIdentity.personalEmail,
      'admin@example.com',
    );
    await assert.rejects(auth.manage({ action: 'toggle', id: 'a' }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test('previews bind sender, personal Reply-To and acting user before any network request', async () => {
  const dir = await mkdtemp(tmpdir() + '/sender-outreach-');
  const sent = [];
  try {
    const o = await new Outreach(dir, async (_, options) => {
      sent.push(JSON.parse(options.body));
      return new Response(null, { status: 202 });
    }).init();
    const t = await o.template({
      name: 'Test',
      subject: 'Hi',
      body: 'Hi {{isim}}',
    });
    await o.add(
      [{ username: 'test', fullName: 'Test', email: 'recipient@example.com' }],
      'job',
    );
    const ids = o.snapshot().contacts.map((c) => c.id);
    await o.assign(ids, t.id);
    const sender = resolveSender(
      {
        id: 'melisa',
        name: 'Melisa',
        mailIdentity: defaultMailIdentity('melisa'),
      },
      'melisa@hiwellapp.com',
      { sendgridKey: 'fake' },
    );
    const p = o.preview(ids, sender);
    for (const change of [
      { actorId: 'isil' },
      { replyTo: 'other@example.com' },
      { fromEmail: 'melisa.onen@hiwellapp.com' },
    ])
      await assert.rejects(
        o.send(p.id, { ...sender, ...change }),
        /yeniden önizleyin/,
      );
    assert.equal(sent.length, 0);
    await o.send(p.id, sender);
    assert.equal(sent[0].from.email, 'melisa@hiwellapp.com');
    assert.equal(sent[0].reply_to.email, 'melisa.onen@hiwellapp.com');
    assert.equal(o.snapshot().contacts[0].lastMessage.actorId, 'melisa');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
