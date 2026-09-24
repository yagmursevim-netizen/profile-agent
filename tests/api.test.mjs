import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

for (const testOrigin of [
  'https://192.168.1.50:3443',
  'https://trilogy-punch-ion.ngrok-free.dev',
])
  void test('API exports only matching profiles, persists jobs, blocks cross-origin requests and handles missing login', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ig-affiliate-test-'));
    await mkdir(path.join(dir, '.local'));
    await writeFile(
      path.join(dir, '.local/jobs.json'),
      JSON.stringify([
        {
          id: '11111111-1111-4111-8111-111111111111',
          sources: ['cachedsource'],
          mode: 'following',
          limit: 1,
          total: 1,
          done: 1,
          status: 'completed',
          message: 'saved',
          warnings: [],
          restrictedUntil: Date.now() + 60000,
          createdAt: '2026-01-01T00:00:00Z',
          rows: [
            {
              username: 'cacheduser',
              bio: 'İşbirliği için DM',
              followers: 100,
              following: 10,
              private: false,
              error: null,
              collectedAt: '2026-01-01T00:00:00Z',
            },
          ],
        },
      ]),
    );
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
      {
        cwd: dir,
        env: {
          ...process.env,
          API_PORT: '0',
          APP_LAN_ORIGIN: testOrigin,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let logs = '';
    child.stderr.on('data', (x) => (logs += x));
    try {
      const base = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Server did not start: ' + logs)),
          10000,
        );
        child.stdout.on('data', (c) => {
          const m = String(c).match(/http:\/\/127.0.0.1:\d+/);
          if (m) {
            clearTimeout(timer);
            resolve(m[0]);
          }
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error('Server exited ' + code + logs));
        });
      });
      let cookie = '';
      const get = (route) =>
        fetch(base + route, { headers: { Cookie: cookie } });
      const post = (route, data, headers = {}) =>
        fetch(base + route, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: testOrigin,
            Cookie: cookie,
            ...headers,
          },
          body: JSON.stringify(data),
        });
      assert.equal(
        (await post('/api/demo', {}, { Origin: 'https://untrusted.example' }))
          .status,
        403,
      );
      for (const route of [
        '/api/settings',
        '/api/jobs',
        '/api/outreach',
        '/api/status',
        '/api/users',
        '/api/outreach/history-export?format=csv',
        '/api/instagram/accounts',
      ])
        assert.equal((await get(route)).status, 401);
      const credentials = await readFile(
        path.join(dir, '.local/ilk-giris.txt'),
        'utf8',
      );
      const temporary = (name) =>
        credentials
          .split('\n')
          .find((line) => line.includes(`kullanıcı adı ${name} |`))
          .split('geçici şifre ')[1];
      async function login(username, password) {
        cookie = ''; // Separate browser sessions for admin and member.
        const r = await post('/api/auth/login', { username, password });
        assert.equal(r.status, 200);
        cookie = r.headers.get('set-cookie').split(';')[0];
        assert.match(
          r.headers.get('set-cookie'),
          /HttpOnly; SameSite=Strict; Path=\/api; Secure;/,
        );
        return r.json();
      }
      await login('admin', temporary('admin'));
      assert.equal((await get('/api/jobs')).status, 403);
      assert.equal(
        (
          await post('/api/auth/password', {
            currentPassword: temporary('admin'),
            password: 'Admin-new-pass-12345',
          })
        ).status,
        200,
      );
      assert.equal((await get('/api/jobs')).status, 401);
      await login('admin', 'Admin-new-pass-12345');
      const adminCookie = cookie;
      const suppressed = await post('/api/outreach/suppress', {
        mode: 'csv',
        csv: 'email,isim\nold@example.com,Old Contact',
      });
      assert.equal(suppressed.status, 200);
      assert.equal((await suppressed.json()).added, 1);
      const historyCSV = await get('/api/outreach/history-export?format=csv');
      assert.equal(historyCSV.status, 200);
      assert.match(await historyCSV.text(), /old@example.com/);
      const historyXLSX = await get('/api/outreach/history-export?format=xlsx');
      const historyBook = new ExcelJS.Workbook();
      await historyBook.xlsx.load(Buffer.from(await historyXLSX.arrayBuffer()));
      assert.equal(
        historyBook.worksheets[0].getCell('A2').value,
        'old@example.com',
      );
      const history = (await (await get('/api/outreach')).json()).history;
      assert.equal(history[0].actorName, 'Bilinmiyor');
      const accounts = await (await get('/api/instagram/accounts')).json();
      assert.deepEqual(accounts.accounts, []);

      const members = await (await get('/api/users')).json();
      assert.deepEqual(
        members.users.map((u) => u.username),
        ['admin', 'melisa', 'isil'],
      );
      assert.equal(JSON.stringify(members).includes('salt'), false);
      assert.equal(
        (
          await post('/api/users', {
            action: 'toggle',
            id: members.users[0].id,
          })
        ).status,
        400,
      );
      await login('melisa', temporary('melisa'));
      await post('/api/auth/password', {
        currentPassword: temporary('melisa'),
        password: 'Melisa-new-pass-12345',
      });
      await login('melisa', 'Melisa-new-pass-12345');
      const memberCookie = cookie;
      for (const route of [
        '/api/settings',
        '/api/settings/test-email',
        '/api/tiktok/pair',
        '/api/users',
      ])
        assert.equal((await get(route)).status, 403);
      for (const route of [
        '/api/settings',
        '/api/settings/test-email',
        '/api/users',
        '/api/login',
      ])
        assert.equal((await post(route, {})).status, 403);
      assert.equal((await get('/api/jobs')).status, 200);
      cookie = adminCookie;
      await post('/api/users', { action: 'toggle', id: members.users[1].id });
      cookie = memberCookie;
      assert.equal((await get('/api/jobs')).status, 401);
      cookie = adminCookie;
      const created = await (
        await post('/api/users', {
          action: 'create',
          name: 'Test Ekip',
          username: 'testekip',
          role: 'admin',
        })
      ).json();
      assert.equal(created.user.role, 'member');
      assert.ok(created.temporaryPassword.length >= 20);
      const stored = await readFile(
        path.join(dir, '.local/users.json'),
        'utf8',
      );
      assert.equal(stored.includes('Admin-new-pass-12345'), false);
      assert.equal(stored.includes(created.temporaryPassword), false);
      assert.equal((await post('/api/demo', {}, { Origin: '' })).status, 403);
      assert.equal(
        (
          await post('/api/settings/test-email', {
            email: 'test@example.com',
            requestId: '12345678-1234-4123-8123-123456789012',
          })
        ).status,
        400,
      );
      const secrets = {
        openaiKey: 'fake-openai-only-test',
        sendgridKey: 'fake-sendgrid-only-test',
        fromEmail: 'hello@example.com',
        openaiModel: 'gpt-5-mini',
        excludedUsernames: '@blocked_one, blocked_two',
      };
      const settingsResponse = await post('/api/settings', secrets);
      assert.equal(settingsResponse.status, 200);
      const publicConfig = await settingsResponse.json();
      assert.equal(publicConfig.openaiConfigured, true);
      assert.equal(publicConfig.sendgridConfigured, true);
      // Unlike the secrets above, this field isn't sensitive — it should
      // round-trip through the public settings response as-is.
      assert.equal(publicConfig.excludedUsernames, secrets.excludedUsernames);
      const publicText = JSON.stringify(
        await (await get('/api/settings')).json(),
      );
      assert.equal(publicText.includes(secrets.openaiKey), false);
      assert.equal(publicText.includes(secrets.sendgridKey), false);
      assert.ok(publicText.includes('blocked_one'));
      assert.equal(
        (await post('/api/settings', { excludedUsernames: 'bad;chars!' }))
          .status,
        400,
      );
      const rotation = await (
        await post('/api/settings', {
          accountSwitchEnabled: true,
          accountSwitchMinMinutes: 20,
          accountSwitchMaxMinutes: 40,
        })
      ).json();
      assert.equal(rotation.accountSwitchEnabled, true);
      assert.equal(rotation.accountSwitchMinMinutes, 20);
      assert.equal(rotation.accountSwitchMaxMinutes, 40);
      assert.equal(
        (
          await post('/api/settings', {
            accountSwitchMinMinutes: 50,
            accountSwitchMaxMinutes: 40,
          })
        ).status,
        400,
      );
      const rotationSources = await (
        await post('/api/settings', {
          accountSwitchMinSources: 1,
          accountSwitchMaxSources: 2,
        })
      ).json();
      assert.equal(rotationSources.accountSwitchMinSources, 1);
      assert.equal(rotationSources.accountSwitchMaxSources, 2);
      assert.equal(
        (
          await post('/api/settings', {
            accountSwitchMinSources: 3,
            accountSwitchMaxSources: 2,
          })
        ).status,
        400,
      );
      assert.equal(
        (await post('/api/tiktok/bridge/poll', { clientId: 'none' })).status,
        401,
      );
      const pair = await (await post('/api/tiktok/pair', {})).json();
      assert.ok(pair.token);
      const extensionId = 'a'.repeat(32);
      const bridgeReply = await post(
        '/api/tiktok/bridge/poll',
        { clientId: '11111111-1111-4111-8111-111111111111' },
        {
          Origin: 'chrome-extension://' + extensionId,
          Authorization: 'Bearer ' + pair.token,
          'X-Hiwell-Extension': extensionId,
        },
      );
      assert.equal(bridgeReply.status, 200);
      assert.equal((await bridgeReply.json()).command, null);
      assert.equal(
        (await (await get('/api/status')).json()).tiktokBridge.connected,
        true,
      );
      const demo = await (await post('/api/demo', {})).json();
      assert.equal(demo.rows.length, 6);
      const response = await post(`/api/jobs/${demo.id}/export`, {
        format: 'xlsx',
        filters: { emailOnly: true, publicOnly: true, minFollowers: 1000 },
      });
      assert.equal(response.status, 200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const sheet = wb.getWorksheet('Hiwell Affiliate');
      assert.equal(sheet.rowCount, 4);
      assert.equal(sheet.columnCount, 17);
      assert.match(
        sheet.getCell('A2').value.hyperlink,
        /^https:\/\/www.instagram.com\//,
      );
      assert.equal(typeof sheet.getCell('C2').value, 'number');
      assert.equal(
        wb
          .getWorksheet('Tarama notları')
          .getCell('A1')
          .value.includes('Örnek veri'),
        true,
      );
      const csv = await (
        await post(`/api/jobs/${demo.id}/export`, {
          format: 'csv',
          filters: { publicOnly: true, minFollowers: 100000 },
        })
      ).text();
      assert.equal(csv.trim().split('\r\n').length, 1);
      const state = JSON.parse(
        await readFile(path.join(dir, '.local/jobs.json'), 'utf8'),
      );
      assert.equal(state[0].id, demo.id);
      for (const [text, mode] of [
        ['cacheduser', 'profiles'],
        ['cachedsource', 'following'],
      ]) {
        const response = await post('/api/jobs', {
          text,
          mode,
          ...(mode === 'following' ? { limit: 1 } : {}),
        });
        assert.equal(response.status, 201);
        const started = await response.json();
        assert.equal(started.limit, mode === 'profiles' ? 5000 : 1);
        let cached;
        for (let i = 0; i < 100; i++) {
          cached = await (await get(`/api/jobs/${started.id}`)).json();
          if (!['queued', 'running', 'stopping'].includes(cached.status)) break;
          await new Promise((r) => setTimeout(r, 30));
        }
        assert.equal(cached.rows.length, 1);
        assert.deepEqual(cached.discoveredUsers, ['cacheduser']);
        const handlesCsv = await (
          await get('/api/jobs/' + started.id + '/usernames')
        ).text();
        assert.ok(handlesCsv.includes('"username"'));
        assert.ok(handlesCsv.includes('"cacheduser"'));
        assert.equal(cached.rows[0].reused, true);
        assert.equal(cached.rows[0].collectedAt, '2026-01-01T00:00:00Z');
        assert.equal(cached.cachedCount, 1);
        assert.equal(
          (await (await get('/api/status')).json()).browserOpen,
          false,
        );
      }
      assert.equal(
        (
          await post('/api/jobs', {
            text: 'uncacheduser',
            mode: 'profiles',
            limit: 1,
          })
        ).status,
        429,
      );
      assert.equal(
        (
          await post('/api/jobs', {
            text: 'https://evil.com',
            mode: 'profiles',
          })
        ).status,
        400,
      );
      assert.equal(
        (await post('/api/jobs', { text: 'aday', mode: 'following', limit: 0 }))
          .status,
        400,
      );
      assert.equal(
        (await post('/api/jobs', { text: 'one two', mode: 'following' }))
          .status,
        429,
      );
      assert.equal(
        (
          await post('/api/jobs', {
            text: 'one',
            mode: 'following',
            limit: 5000,
          })
        ).status,
        429,
      );
      assert.equal(
        (
          await post('/api/jobs', {
            text: 'one',
            mode: 'following',
            limit: 5001,
          })
        ).status,
        400,
      );
      const marketResponse = await post('/api/jobs', {
        text: 'cacheduser',
        mode: 'profiles',
        limit: 1,
        market: 'pt',
      });
      assert.equal(marketResponse.status, 201);
      assert.equal((await marketResponse.json()).market, 'pt');
      assert.equal(
        (
          await post('/api/jobs', {
            text: 'cacheduser',
            mode: 'profiles',
            limit: 1,
            market: 'not-a-real-market',
          })
        ).status,
        400,
      );
      const parsed = await (
        await post('/api/parse', { text: 'cacheduser uncacheduser' })
      ).json();
      assert.deepEqual(parsed.usernames, ['cacheduser', 'uncacheduser']);
      assert.deepEqual(parsed.alreadyScanned, ['cacheduser']);
      // forceRescan is restricted to this job's own sources — the bogus
      // extra entry below must be silently dropped, not error out.
      const forcedResponse = await post('/api/jobs', {
        text: 'cacheduser',
        mode: 'profiles',
        limit: 1,
        forceRescan: ['cacheduser', 'not-one-of-the-sources'],
      });
      assert.equal(forcedResponse.status, 201);
      const forcedJob = await forcedResponse.json();
      assert.deepEqual(forcedJob.forceRescan, ['cacheduser']);
      let forcedResult;
      for (let i = 0; i < 100; i++) {
        forcedResult = await (await get(`/api/jobs/${forcedJob.id}`)).json();
        if (!['queued', 'running', 'stopping'].includes(forcedResult.status))
          break;
        await new Promise((r) => setTimeout(r, 30));
      }
      // No Instagram account is configured in this test, so bypassing the
      // cache (forced) hits ensureLogin's fast failure instead of the cache
      // hit every other 'cacheduser' job in this test gets — proving the
      // cache really was skipped, not just that the job happened to fail.
      assert.equal(forcedResult.status, 'blocked');
      assert.equal(forcedResult.cachedCount, 0);
      assert.equal(forcedResult.rows.length, 0);
      // Only meaningful while a scan is actually running and still reading
      // sources — the seeded fixture job is 'completed', so this must be
      // rejected rather than silently setting a flag nothing will consume.
      assert.equal(
        (
          await post(
            '/api/jobs/11111111-1111-4111-8111-111111111111/skip-discovery',
            {},
          )
        ).status,
        400,
      );
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once('exit', resolve);
      });
      await rm(dir, { recursive: true, force: true });
    }
  });
