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
