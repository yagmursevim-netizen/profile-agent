import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import {
  privateIPv4,
  parseLanConfig,
  allowedOrigin,
} from '../server/network.mjs';
import { createGateway } from '../server/lan-gateway.mjs';
import { Auth } from '../server/auth.mjs';
void test('LAN requires private IPv4 and exact HTTPS origin; sessions use Secure only in LAN mode', () => {
  for (const ip of ['10.0.0.2', '172.16.0.2', '192.168.1.50'])
    assert.equal(privateIPv4(ip), true);
  for (const ip of [
    '8.8.8.8',
    '127.0.0.1',
    '0.0.0.0',
    '172.32.0.1',
    '192.168.999.1',
  ])
    assert.equal(privateIPv4(ip), false);
  assert.throws(() => parseLanConfig({ host: '0.0.0.0' }));
  const { origin } = parseLanConfig({ host: '192.168.1.50' });
  assert.equal(origin, 'https://192.168.1.50:3443');
  assert.equal(allowedOrigin(origin, 4318, origin), true);
  for (const value of [
    undefined,
    'http://192.168.1.50:3443',
    'https://attacker.example',
    'https://192.168.1.50:3443.attacker.example',
  ])
    assert.equal(allowedOrigin(value, 4318, origin), false);
  let cookie;
  new Auth('.local', true).cookie(
    {
      setHeader: (_, v) => {
        cookie = v;
      },
    },
    'token',
  );
  assert.match(cookie, /Secure;/);
  assert.match(cookie, /HttpOnly/);
  new Auth().cookie(
    {
      setHeader: (_, v) => {
        cookie = v;
      },
    },
    'token',
  );
  assert.doesNotMatch(cookie, /Secure;/);
});
void test('HTTPS gateway verifies trusted TLS, routes API with original Origin, blocks foreign Host and CSRF', async () => {
  const dir = await mkdtemp(tmpdir() + '/hiwell-lan-');
  const servers = [];
  const listen = async (server) => {
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server.address().port;
  };
  try {
    await writeFile(
      dir + '/cert.conf',
      '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\n',
    );
    const result = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-config',
        dir + '/cert.conf',
        '-keyout',
        dir + '/key.pem',
        '-out',
        dir + '/cert.pem',
      ],
      { stdio: 'ignore' },
    );
    assert.equal(result.status, 0, 'Generate isolated test certificate');
    const cert = await readFile(dir + '/cert.pem'),
      key = await readFile(dir + '/key.pem');
    const webPort = await listen(
      http.createServer((_, res) => res.end('compiled web')),
    );
    let received;
    const apiPort = await listen(
      http.createServer((req, res) => {
        received = req.headers;
        res.setHeader(
          'Set-Cookie',
          'hiwell_session=test; Secure; HttpOnly; SameSite=Strict; Path=/api',
        );
        res.end('api');
      }),
    );
    const holder = http.createServer();
    const port = await listen(holder);
    await new Promise((resolve) => holder.close(resolve));
    const gateway = createGateway({
      host: '127.0.0.1',
      port,
      cert,
      key,
      webPort,
      apiPort,
    });
    servers.push(gateway);
    await new Promise((resolve) => gateway.listen(port, '127.0.0.1', resolve));
    const request = (path, headers = {}, method = 'GET') =>
      new Promise((resolve, reject) => {
        const req = https.request(
          {
            hostname: '127.0.0.1',
            servername: 'localhost',
            port,
            path,
            method,
            ca: cert,
            headers,
          },
          (res) => {
            let body = '';
            res.on('data', (b) => {
              body += b;
            });
            res.on('end', () =>
              resolve({ status: res.statusCode, headers: res.headers, body }),
            );
          },
        );
        req.on('error', reject);
        req.end();
      });
    const origin = `https://127.0.0.1:${port}`;
    assert.equal((await request('/')).body, 'compiled web');
    const api = await request(
      '/api/auth/login',
      {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Forwarded-For': 'fake-client',
      },
      'POST',
    );
    assert.equal(api.body, 'api');
    assert.equal(received.origin, origin);
    assert.equal(received.host, `127.0.0.1:${apiPort}`);
    assert.equal(received['x-forwarded-for'], undefined);
    assert.match(api.headers['set-cookie'][0], /Secure/);
    assert.equal((await request('/api/auth/login', {}, 'POST')).status, 403);
    assert.equal(
      (await request('/', { Host: 'attacker.example' })).status,
      403,
    );
    assert.equal(
      (await request('/', { Origin: 'https://attacker.example' })).status,
      403,
    );
  } finally {
    for (const s of servers) {
      s.closeAllConnections();
      if (s.listening) await new Promise((resolve) => s.close(resolve));
    }
    await rm(dir, { recursive: true, force: true });
  }
});
