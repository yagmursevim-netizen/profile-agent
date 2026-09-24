import { sourceLimitWarnings } from '../server/domain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInput,
  normalizeProfile,
  filterRows,
  csvCell,
  emails,
} from '../server/domain.mjs';

void test('CSV accepts BOM, quoted columns, Turkish headers and deduplicates profile URLs', () => {
  assert.deepEqual(
    parseInput(
      '\uFEFFkullanıcı adı;not\n"@Aday";"iki; parça"\nhttps://www.instagram.com/aday/?x=1;tekrar',
      true,
    ),
    ['aday'],
  );
  assert.deepEqual(parseInput('instagram.com/aday\n@ikinci'), [
    'aday',
    'ikinci',
  ]);
  assert.throws(() => parseInput('https://evil.com/aday'));
  assert.throws(() => parseInput('https://instagram.com/p/abc'));
  assert.throws(() => parseInput(''));
  assert.throws(() => parseInput('email,isim\nx@example.com,X', true));
});
void test('unknown counts and privacy stay unknown; zero remains zero; email comes only from bio', () => {
  const p = normalizeProfile({
    username: 'aday',
    biography: 'Merhaba: a@example.com\nİş birliği b@example.org',
    follower_count: 0,
    business_email: 'hidden@example.com',
  });
  assert.equal(p.followers, 0);
  assert.equal(p.following, null);
  assert.equal(p.private, null);
  assert.equal(p.email, 'a@example.com; b@example.org');
  assert.equal(emails('Email yok'), null);
  assert.equal(
    normalizeProfile({ username: 'aday', follower_count: '1.2K' }).followers,
    null,
  );
});
void test('combined filters enforce 1000 boundary and exclude unknown private/count fields', () => {
  const rows = [
    {
      username: 'a',
      bio: 'İçerik',
      email: 'a@example.com',
      followers: 1000,
      private: false,
    },
    {
      username: 'b',
      bio: '',
      email: 'b@example.com',
      followers: 999,
      private: false,
    },
    { username: 'c', bio: '', email: null, followers: 3000, private: false },
    {
      username: 'd',
      bio: '',
      email: 'd@example.com',
      followers: 4000,
      private: true,
    },
    {
      username: 'e',
      bio: '',
      email: 'e@example.com',
      followers: null,
      private: null,
    },
  ];
  assert.deepEqual(
    filterRows(rows, {
      emailOnly: true,
      publicOnly: true,
      minFollowers: 1000,
    }).map((r) => r.username),
    ['a'],
  );
  assert.deepEqual(
    filterRows(rows, { q: 'içerik' }).map((r) => r.username),
    ['a'],
  );
});
void test('CSV neutralizes spreadsheet formula payloads without destroying multiline bios', () => {
  assert.equal(
    csvCell('=HYPERLINK("https://evil.com")'),
    '"\'=HYPERLINK(""https://evil.com"")"',
  );
  assert.equal(csvCell(' +2+3'), '"\' +2+3"');
  assert.equal(csvCell('satır 1\nsatır 2'), '"satır 1\nsatır 2"');
  assert.equal(csvCell(null), '"null"');
});

void test('source limits distinguish follower warning and following truncation at 5000', () => {
  assert.equal(sourceLimitWarnings('source', 5000, 5000).length, 0);
  assert.equal(sourceLimitWarnings('source', null, null).length, 0);
  const warnings = sourceLimitWarnings('source', 5001, 6000);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /5.001 takipçisi/);
  assert.match(warnings[1], /6.000 hesap takip/);
});
