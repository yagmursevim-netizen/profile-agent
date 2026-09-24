import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { WorkQueue } from '../server/work-queue.mjs';
import { performanceReport } from '../server/performance.mjs';
import { Outreach } from '../server/outreach.mjs';

void test('FIFO queue is durable, excludes concurrent workers and enforces ownership', async () => {
  const dir = await mkdtemp(tmpdir() + '/queue-');
  try {
    let release;
    let started;
    const gate = new Promise((resolve) => {
      started = resolve;
    });
    const seen = [];
    const q = await new WorkQueue(dir, async (t) => {
      seen.push(t.ownerId);
      if (t.ownerId === 'm') {
        started();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
    }).init();
    const a = await q.enqueue({ ownerId: 'm', kind: 'scan' });
    const b = await q.enqueue({ ownerId: 'i', kind: 'scan' });
    assert.deepEqual(
      q.snapshot().map((t) => t.position),
      [1, 2],
    );
    await assert.rejects(
      q.cancel(a.id, { id: 'i', role: 'member' }),
      (e) => e.status === 403,
    );
    const run = q.drain();
    await gate;
    await q.drain();
    assert.deepEqual(seen, ['m']);
    release();
    await run;
    await q.drain();
    assert.deepEqual(seen, ['m', 'i']);
    assert.equal(q.tasks.find((t) => t.id === b.id).status, 'completed');
    const c = await q.enqueue({ ownerId: 'm', kind: 'scan' });
    const restored = await new WorkQueue(dir, async () => {}).init();
    assert.equal(restored.tasks.at(-1).status, 'queued');
    await restored.cancel(c.id, { id: 'admin', role: 'admin' });
    assert.equal(restored.tasks.at(-1).status, 'cancelled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test('restart interrupts in-flight email instead of replaying; pending work survives', async () => {
  const dir = await mkdtemp(tmpdir() + '/restart-');
  try {
    const q = await new WorkQueue(dir, async () => {}).init();
    await q.enqueue({ kind: 'email' });
    await q.enqueue({ kind: 'scan' });
    q.tasks[0].status = 'running';
    await q.save();
    const seen = [];
    const restored = await new WorkQueue(dir, async (t) => {
      seen.push(t.kind);
    }).init();
    await restored.drain();
    assert.deepEqual(seen, ['scan']);
    assert.equal(restored.tasks[0].status, 'interrupted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test('reserved email is frozen, deduplicated and unsent contacts are released on cancellation', async () => {
  const dir = await mkdtemp(tmpdir() + '/reserved-');
  try {
    const sent = [];
    const o = await new Outreach(dir, async (_, options) => {
      sent.push(JSON.parse(options.body));
      return new Response(null, { status: 202 });
    }).init();
    const t = await o.template({
      name: 'a',
      subject: 'First',
      body: 'Hello {{isim}}',
    });
    await o.add(
      [
        { username: 'one', email: 'one@example.com' },
        { username: 'two', email: 'two@example.com' },
      ],
      'j',
    );
    const ids = o.state.contacts.map((c) => c.id);
    await o.assign(ids, t.id);
    const sender = {
      fromEmail: 'sender@example.com',
      fromName: 'Melisa',
      actorId: 'm',
      replyTo: 'personal@example.com',
      sendgridKey: 'fake',
    };
    const preview = o.preview(ids, sender);
    const messages = o.reserve(preview.id, sender);
    assert.throws(() => o.preview(ids, sender));
    await assert.rejects(o.archive(ids));
    await o.template({ ...t, subject: 'Changed' });
    const controller = new AbortController();
    o.fetcher = async (_, options) => {
      sent.push(JSON.parse(options.body));
      controller.abort();
      return new Response(null, { status: 202 });
    };
    await assert.rejects(o.sendMessages(messages, sender, controller.signal));
    await o.release(messages);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].personalizations[0].subject, 'First');
    assert.equal(o.state.contacts[0].status, 'accepted');
    assert.equal(o.state.contacts[1].status, 'draft');
    assert.equal(o.state.deliveries[0].actorId, 'm');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test('performance separates platform, source counts, cache reuse, unique contacts, unknown owners and email attempts', () => {
  const row = {
    username: 'same',
    email: 'a@example.com',
    dmForCollaboration: true,
  };
  const jobs = [
    {
      id: '1',
      ownerId: 'm',
      platform: 'instagram',
      sources: ['source'],
      mode: 'following',
      rows: [row],
      status: 'completed',
    },
    {
      id: '2',
      ownerId: 'm',
      platform: 'instagram',
      sources: ['same'],
      mode: 'profiles',
      rows: [{ ...row, reused: true }],
      status: 'completed',
    },
    {
      id: '3',
      ownerId: 'i',
      platform: 'tiktok',
      sources: ['wellness'],
      mode: 'search',
      rows: [row],
      status: 'partial',
    },
    { id: 'old', sources: ['old'], rows: [], status: 'completed' },
    { id: 'demo', demo: true, rows: [row] },
  ];
  const report = performanceReport(
    jobs,
    [],
    [],
    [
      { id: 'm', name: 'Melisa' },
      { id: 'i', name: 'Işıl' },
    ],
    [
      { actorId: 'm', platform: 'instagram', status: 'failed' },
      { actorId: 'm', platform: 'instagram', status: 'accepted' },
    ],
  );
  const m = report.rows.find(
    (r) => r.userId === 'm' && r.platform === 'instagram',
  );
  assert.equal(m.submittedAccounts, 2);
  assert.equal(m.processed, 2);
  assert.equal(m.profiles, 1);
  assert.equal(m.cached, 1);
  assert.equal(m.emails, 1);
  assert.equal(m.dm, 1);
  assert.equal(m.accepted, 1);
  assert.equal(m.failed, 1);
  const i = report.rows.find(
    (r) => r.userId === 'i' && r.platform === 'tiktok',
  );
  assert.equal(i.searchTerms, 1);
  assert.equal(i.submittedAccounts, 0);
  assert.equal(report.rows.find((r) => r.userId === 'unknown').jobs, 1);
});

void test('email and scan lanes run independently, preserve FIFO and cancel only their own worker', async () => {
  const dir = await mkdtemp(tmpdir() + '/lanes-');
  try {
    const started = [],
      gates = {},
      signals = {};
    const q = await new WorkQueue(dir, async (task, controller) => {
      started.push(task.title);
      signals[task.title] = controller.signal;
      await new Promise((resolve) => {
        gates[task.title] = resolve;
      });
    }).init();
    const scan = await q.enqueue({
      kind: 'scan',
      title: 'scan1',
      ownerId: 'm',
    });
    await q.enqueue({ kind: 'ai', title: 'ai2', ownerId: 'm' });
    await q.enqueue({ kind: 'email', title: 'email1', ownerId: 'i' });
    await q.enqueue({ kind: 'email', title: 'email2', ownerId: 'i' });
    assert.deepEqual(
      q.snapshot().map((t) => t.position),
      [1, 2, 1, 2],
    );
    const run = q.drain();
    while (started.length < 2) await new Promise((r) => setImmediate(r));
    await q.drain();
    assert.deepEqual(started, ['scan1', 'email1']);
    await q.cancel(scan.id, { id: 'm' });
    assert.equal(signals.scan1.aborted, true);
    assert.equal(signals.email1.aborted, false);
    gates.scan1();
    gates.email1();
    await run;
    const next = q.drain();
    while (started.length < 4) await new Promise((r) => setImmediate(r));
    assert.deepEqual(started, ['scan1', 'email1', 'ai2', 'email2']);
    q.close();
    assert.equal(signals.ai2.aborted, true);
    assert.equal(signals.email2.aborted, true);
    gates.ai2();
    gates.email2();
    await next;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
