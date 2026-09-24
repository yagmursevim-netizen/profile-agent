import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOWING_NAME,
  parseInstagramPayload,
  findProfileObjects,
} from '../server/instagram-data.mjs';

void test('following controls match the current accessible names without confusing followers', () => {
  for (const name of [
    '2,102 following',
    '123 following',
    '1.2K following',
    '2.102 takip',
    'Takip edilenler',
  ])
    assert.ok(FOLLOWING_NAME.test(name), name);
  for (const name of ['10.7K followers', 'Follow', 'Following', '123 takipçi'])
    assert.equal(FOLLOWING_NAME.test(name), false, name);
});
void test('Relay responses support anti-XSSI prefixes, streaming JSON and serialized nested data', () => {
  const user = {
    username: 'aday',
    biography: 'Bio',
    follower_count: 1234,
    following_count: 250,
    is_private: false,
  };
  const raw =
    'for (;;);' +
    JSON.stringify({ data: { profile: JSON.stringify({ user }) } }) +
    '\n' +
    JSON.stringify({ extensions: { is_final: true } });
  const chunks = parseInstagramPayload(raw);
  assert.equal(chunks.length, 2);
  assert.deepEqual(findProfileObjects(chunks, 'aday'), [user]);
  assert.deepEqual(findProfileObjects(chunks, 'baska'), []);
  assert.deepEqual(parseInstagramPayload('not JSON'), []);
});
