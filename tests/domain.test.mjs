import { sourceLimitWarnings } from '../server/domain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInput,
  normalizeProfile,
  filterRows,
  csvCell,
  emails,
  parseAbbreviatedCount,
  followingCounts,
  candidateInfoFromCsv,
  sortSourcesByFollowing,
  excludedUsernameSet,
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
  assert.equal(warnings[0], '@source (5.001 takipçi)');
  assert.match(warnings[1], /6.000 hesap takip/);
});
void test('parseAbbreviatedCount reads exact, comma and K/M/B follower counts from hover-card text', () => {
  assert.equal(parseAbbreviatedCount('661\nfollowers', 'followers'), 661);
  assert.equal(parseAbbreviatedCount('12,345 followers', 'followers'), 12345);
  assert.equal(parseAbbreviatedCount('12.3K\nfollowers', 'followers'), 12300);
  assert.equal(parseAbbreviatedCount('1.2M followers', 'followers'), 1200000);
  assert.equal(
    parseAbbreviatedCount(
      '128\nposts\n661\nfollowers\n806\nfollowing',
      'followers',
    ),
    661,
  );
  assert.equal(parseAbbreviatedCount('no stats here', 'followers'), null);
  assert.equal(parseAbbreviatedCount(null, 'followers'), null);
});
void test('followingCounts reads an optional CSV column, tolerates thousand separators, and stays empty without it', () => {
  assert.deepEqual(
    followingCounts(
      'username,following\nbirinci,1.234\nikinci,"2,500"\nucuncu,',
    ),
    { birinci: 1234, ikinci: 2500 },
  );
  // No recognized count column at all.
  assert.deepEqual(followingCounts('username\nbirinci\nikinci'), {});
  // Single-column CSV: no header to match a count against.
  assert.deepEqual(followingCounts('birinci\nikinci'), {});
  assert.deepEqual(followingCounts(''), {});
  assert.deepEqual(followingCounts('not,a\nvalid csv "'), {});
});
void test('candidateInfoFromCsv reads optional followers/fullname/private columns, requires at least one, and skips unparseable rows', () => {
  assert.deepEqual(
    candidateInfoFromCsv(
      'username,followers,fullname,private\n' +
        'birinci,"1,234",Birinci Kişi,true\n' +
        'ikinci,,,false\n' +
        'not a real handle!!,999,X,true',
    ),
    {
      birinci: { followers: 1234, fullName: 'Birinci Kişi', private: true },
      ikinci: { private: false },
    },
  );
  // Username column only, no recognized enrichment columns at all.
  assert.deepEqual(candidateInfoFromCsv('username\nbirinci'), {});
  assert.deepEqual(candidateInfoFromCsv(''), {});
});
void test('sortSourcesByFollowing orders known counts ascending, keeps unknowns in place, and no-ops with no counts at all', () => {
  assert.deepEqual(
    sortSourcesByFollowing(['big', 'small', 'medium'], {
      big: 9000,
      small: 100,
      medium: 500,
    }),
    ['small', 'medium', 'big'],
  );
  // Unknown counts (no entry in the map) sort after every known one, but
  // keep their original relative order among themselves.
  assert.deepEqual(
    sortSourcesByFollowing(['unknownA', 'known', 'unknownB'], {
      known: 10,
    }),
    ['known', 'unknownA', 'unknownB'],
  );
  assert.deepEqual(sortSourcesByFollowing(['a', 'b', 'c'], {}), [
    'a',
    'b',
    'c',
  ]);
});
void test('excludedUsernameSet normalizes case, @, and both comma/newline separators', () => {
  const set = excludedUsernameSet('@Birinci, ikinci\n Üçüncü\n\nbirinci');
  assert.equal(set.has('birinci'), true);
  assert.equal(set.has('ikinci'), true);
  assert.equal(set.has('üçüncü'), true);
  assert.equal(set.size, 3);
  assert.deepEqual([...excludedUsernameSet('')], []);
  assert.deepEqual([...excludedUsernameSet(undefined)], []);
});
