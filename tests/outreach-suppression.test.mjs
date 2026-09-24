import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Outreach } from '../server/outreach.mjs';
void test('historical import blocks queued sends across users and survives restart; importer is not sender', async () => {
  const dir = await mkdtemp(tmpdir() + '/suppression-');
  try {
    let calls = 0;
    const o = await new Outreach(dir, async () => {
      calls++;
      return new Response(null, { status: 202 });
    }).init();
    await o.add(
      [{ username: 'one', email: 'one@example.com', fullName: 'One' }],
      null,
    );
    const t = await o.template({
      name: 'Test',
      subject: 'Hi',
      body: 'Hello {{isim}}',
    });
    const c = o.state.contacts[0];
    await o.assign([c.id], t.id);
    const sender = {
      fromEmail: 'from@example.com',
      sendgridKey: 'fake',
      actorId: 'melisa',
    };
    const messages = o.reserve(o.preview([c.id], sender).id, sender);
    await o.suppress([{ email: 'ONE@example.com', fullName: 'One' }], {
      id: 'isil',
    });
    const result = await o.sendMessages(messages, sender);
    assert.equal(result.skipped, 1);
    assert.equal(calls, 0);
    assert.equal(c.status, 'suppressed');
    await assert.rejects(
      o.edit({ id: c.id, name: 'One', email: 'other@example.com' }),
    );
    const restored = await new Outreach(dir).init();
    assert.equal(
      (
        await restored.add(
          [{ username: 'another', email: 'one@example.com' }],
          null,
        )
      ).added,
      0,
    );
    const h = restored.history([{ id: 'isil', name: 'Işıl' }])[0];
    assert.equal(h.actorName, 'Bilinmiyor');
    assert.equal(h.recordedByName, 'Işıl');
    assert.equal(h.date, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
void test('delivery stores immutable recipient and actor, archived contacts cannot be resent', async () => {
  const dir = await mkdtemp(tmpdir() + '/sent-history-');
  try {
    const o = await new Outreach(
      dir,
      async () => new Response(null, { status: 202 }),
    ).init();
    await o.add(
      [{ username: 'one', email: 'one@example.com', fullName: 'One' }],
      null,
    );
    const c = o.state.contacts[0];
    const t = await o.template({ name: 'Test', subject: 'Hi', body: 'Hi' });
    await o.assign([c.id], t.id);
    const sender = {
      fromEmail: 'melisa@example.com',
      sendgridKey: 'fake',
      actorId: 'm',
    };
    await o.send(o.preview([c.id], sender).id, sender);
    await o.archive([c.id]);
    const h = o.history([{ id: 'm', name: 'Melisa' }])[0];
    assert.equal(h.email, 'one@example.com');
    assert.equal(h.actorName, 'Melisa');
    assert.equal(h.status, 'accepted');
    assert.equal(
      (await o.add([{ username: 'two', email: 'ONE@example.com' }], null))
        .added,
      0,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
