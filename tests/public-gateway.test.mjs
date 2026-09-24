import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGateway } from '../server/lan-gateway.mjs';
void test('public gateway allows only assigned host and origin, strips proxy headers and blocks extension bridge', async () => {
  const origin = 'https://trilogy-punch-ion.ngrok-free.dev';
  const backend = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.headers));
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const gateway = createGateway({
    host: '127.0.0.1',
    port: 3444,
    publicOrigin: origin,
    apiPort: backend.address().port,
    webPort: backend.address().port,
  });
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  const call = (path, headers = {}, method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: gateway.address().port,
          path,
          method,
          headers: { host: new URL(origin).host, ...headers },
        },
        (res) => {
          let text = '';
          res.on('data', (d) => (text += d));
          res.on('end', () => resolve({ status: res.statusCode, text }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  try {
    assert.equal((await call('/', { host: 'evil.example' })).status, 403);
    assert.equal((await call('/api/auth/login', {}, 'POST')).status, 403);
    assert.equal(
      (
        await call(
          '/api/auth/login',
          { origin: 'https://evil.example' },
          'POST',
        )
      ).status,
      403,
    );
    assert.equal(
      (await call('/api/tiktok/bridge/poll', { origin }, 'POST')).status,
      403,
    );
    const valid = await call(
      '/api/auth/login',
      { origin, 'x-forwarded-for': 'forged' },
      'POST',
    );
    assert.equal(valid.status, 200);
    assert.equal(JSON.parse(valid.text).origin, origin);
    assert.equal(JSON.parse(valid.text)['x-forwarded-for'], undefined);
  } finally {
    gateway.closeAllConnections();
    backend.closeAllConnections();
    await Promise.all([
      new Promise((r) => gateway.close(r)),
      new Promise((r) => backend.close(r)),
    ]);
  }
  assert.throws(
    () => createGateway({ host: '0.0.0.0', publicOrigin: origin }),
    /Geçersiz/,
  );
});
