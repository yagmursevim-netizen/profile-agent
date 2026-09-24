import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProfiles } from '../lib/profile-list.mjs';
import { filterRows } from '../server/domain.mjs';
const rows = [
  { username: 'b', followers: 1000 },
  { username: 'unknown', followers: null },
  { username: 'c', followers: 2000 },
  { username: 'a', followers: 0 },
];
void test('numeric sorting puts unknown counts last in either direction without mutating source', () => {
  assert.deepEqual(
    selectProfiles(rows, { sort: 'followers:asc' }).map((r) => r.username),
    ['a', 'b', 'c', 'unknown'],
  );
  assert.deepEqual(
    selectProfiles(rows, { sort: 'followers:desc' }).map((r) => r.username),
    ['c', 'b', 'a', 'unknown'],
  );
  assert.equal(rows[0].username, 'b');
});
void test('inclusive follower bounds support zero, empty and inverted range; export uses same selector', () => {
  assert.equal(selectProfiles(rows, {}).length, 4);
  assert.deepEqual(
    selectProfiles(rows, {
      minFollowers: '1000',
      maxFollowers: '2000',
      sort: 'followers:desc',
    }).map((r) => r.username),
    ['c', 'b'],
  );
  assert.equal(selectProfiles(rows, { maxFollowers: '0' })[0].username, 'a');
  assert.equal(
    selectProfiles(rows, { minFollowers: 2000, maxFollowers: 1000 }).length,
    0,
  );
  assert.equal(filterRows, selectProfiles);
});
void test('fit filter accepts multiple verdicts (OR match), an empty list is a no-op, and __unassessed__ selects rows with no AI result', () => {
  const scored = [
    { username: 'yes', ai: { verdict: 'Uygun aday' } },
    { username: 'no', ai: { verdict: 'Uygun değil' } },
    { username: 'review', ai: { verdict: 'İncelenmeli' } },
    { username: 'pending', ai: null },
  ];
  assert.deepEqual(
    selectProfiles(scored, { fit: ['Uygun aday'] }).map((r) => r.username),
    ['yes'],
  );
  assert.deepEqual(
    selectProfiles(scored, {
      fit: ['Uygun aday', '__unassessed__'],
    }).map((r) => r.username),
    ['yes', 'pending'],
  );
  assert.equal(selectProfiles(scored, { fit: [] }).length, 4);
  assert.equal(selectProfiles(scored, {}).length, 4);
  assert.deepEqual(
    selectProfiles(scored, { fit: ['__unassessed__'] }).map((r) => r.username),
    ['pending'],
  );
});
void test('emailOnly and dmOnly combine with OR — checking both shows either signal, not just profiles with both', () => {
  const contacts = [
    { username: 'emailer', email: 'a@b.com', dmForCollaboration: false },
    { username: 'dmer', email: null, dmForCollaboration: true },
    { username: 'neither', email: null, dmForCollaboration: false },
  ];
  assert.deepEqual(
    selectProfiles(contacts, { emailOnly: true }).map((r) => r.username),
    ['emailer'],
  );
  assert.deepEqual(
    selectProfiles(contacts, { dmOnly: true }).map((r) => r.username),
    ['dmer'],
  );
  assert.deepEqual(
    selectProfiles(contacts, { emailOnly: true, dmOnly: true }).map(
      (r) => r.username,
    ),
    ['emailer', 'dmer'],
  );
});
