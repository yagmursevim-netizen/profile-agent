import test from 'node:test';
import assert from 'node:assert/strict';
import { Instagram } from '../server/instagram.mjs';
import { assess } from '../server/ai.mjs';

void test('cancelling navigation closes the collection page and releases the job without a browser', async () => {
  const instagram = new Instagram();
  const controller = new AbortController();
  let rejectNavigation;
  let closed = 0;
  const navigation = new Promise((_, reject) => {
    rejectNavigation = reject;
  });
  const page = {
    on: () => {},
    off: () => {},
    goto: () => navigation,
    close: async () => {
      closed++;
      rejectNavigation(new Error('Page closed'));
    },
  };
  Object.assign(instagram, { context: { newPage: async () => page } });
  const collecting = instagram.following(
    'ornek.hesap',
    100,
    controller.signal,
    () => {},
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(collecting, /Page closed/);
  assert.ok(closed >= 1);
});

void test('already cancelled collection and AI evaluation never start work', async () => {
  const instagram = new Instagram();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(instagram.profile('ornek.hesap', controller.signal), {
    name: 'AbortError',
  });
  await assert.rejects(
    assess({ bio: 'Örnek' }, 'test-model', controller.signal),
    { name: 'AbortError' },
  );
  assert.equal(instagram.context, null);
});
