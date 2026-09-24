import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseContacts } from '../server/outreach-import.mjs';
import { Outreach, renderTemplate } from '../server/outreach.mjs';
void test('CSV handles BOM, Turkish headers, quoted names, semicolons and invalid rows', () => {
  const data = parseContacts({
    mode: 'csv',
    csv: '\uFEFFisim,email\r\n"Önen, Melisa",MELISA@example.com\r\nYanlış,broken\r\n',
  });
  assert.equal(data.rows[0].fullName, 'Önen, Melisa');
  assert.equal(data.rows[0].email, 'melisa@example.com');
  assert.equal(data.rejected.length, 1);
  assert.equal(
    parseContacts({ mode: 'csv', csv: 'email;ad soyad\na@example.com;İsim' })
      .rows[0].fullName,
    'İsim',
  );
  assert.equal(
    parseContacts({ mode: 'csv', csv: 'email\na@example.com' }).rows.length,
    1,
  );
  assert.throws(
    () => parseContacts({ mode: 'csv', csv: 'adres\na@example.com' }),
    /email/,
  );
  assert.throws(
    () =>
      parseContacts({
        mode: 'csv',
        csv: 'email\n' + 'a@example.com\n'.repeat(501),
      }),
    /500/,
  );
});
void test('manual contacts persist as drafts, deduplicate across imports and preserve accepted history', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'contact-import-'));
  try {
    const outreach = await new Outreach(dir, () => {
      throw new Error('Must not send');
    }).init();
    const { rows } = parseContacts({
      mode: 'manual',
      name: 'Melisa Önen',
      email: 'Melisa@example.com',
    });
    assert.equal((await outreach.add(rows, null)).added, 1);
    const contact = outreach.state.contacts[0];
    assert.equal(contact.status, 'draft');
    assert.equal(contact.platform, 'manual');
    assert.equal(
      renderTemplate({ subject: 'Merhaba {{ad}}', body: '{{isim}}' }, contact)
        .subject,
      'Merhaba Melisa',
    );
    assert.equal((await outreach.add(rows, null)).added, 0);
    contact.status = 'accepted';
    contact.archived = true;
    await outreach.save();
    const reopened = await new Outreach(dir).init();
    assert.equal((await reopened.add(rows, null)).added, 0);
    assert.equal(reopened.state.contacts.length, 1);
    assert.equal(
      parseContacts({ mode: 'manual', email: 'a@example.com,b@example.com' })
        .rejected.length,
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
