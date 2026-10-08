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
      // No upper bound on "Kaynak başına sınır" anymore (removed — accounts
      // already enforce their own daily visit cap) — a value above the old
      // 5000 ceiling is accepted the same as any other positive integer,
      // same 429 here as the limit: 5000 case above since this fixture's
      // restriction gate is what actually stops it, not validation.
      assert.equal(
        (
          await post('/api/jobs', {
            text: 'one',
            mode: 'following',
            limit: 50001,
          })
        ).status,
        429,
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
      // 'candidates' mode with no enrichment data behaves exactly like
      // 'profiles' — the pre-visit filters just have nothing to filter on.
      const plainCandidatesResponse = await post('/api/jobs', {
        text: 'cacheduser',
        mode: 'candidates',
      });
      assert.equal(plainCandidatesResponse.status, 201);
      const plainCandidatesJob = await plainCandidatesResponse.json();
      let plainCandidatesResult;
      for (let i = 0; i < 100; i++) {
        plainCandidatesResult = await (
          await get(`/api/jobs/${plainCandidatesJob.id}`)
        ).json();
        if (
          !['queued', 'running', 'stopping'].includes(
            plainCandidatesResult.status,
          )
        )
          break;
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.equal(plainCandidatesResult.status, 'completed');
      assert.equal(plainCandidatesResult.rows[0]?.reused, true);
      // With an enriched CSV (the same shape GET .../usernames exports), a
      // candidate over the fame threshold is filtered before any visit —
      // reusing 'cacheduser' (rather than an uncached handle) keeps this
      // test from also tripping the unrelated "platform restricted, needs
      // a live Instagram visit" gate a genuinely uncached handle would hit
      // given the fixture's active restriction; the fame filter itself
      // runs against the CSV-supplied followers regardless of caching.
      const enrichedResponse = await post('/api/jobs', {
        text: 'username,followers,fullname,private\ncacheduser,999999,Famous User,false',
        csv: true,
        mode: 'candidates',
      });
      assert.equal(enrichedResponse.status, 201);
      const enrichedJob = await enrichedResponse.json();
      let enrichedResult;
      for (let i = 0; i < 100; i++) {
        enrichedResult = await (
          await get(`/api/jobs/${enrichedJob.id}`)
        ).json();
        if (!['queued', 'running', 'stopping'].includes(enrichedResult.status))
          break;
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.equal(enrichedResult.status, 'completed');
      assert.equal(enrichedResult.rows.length, 0);
      assert.equal(enrichedResult.cachedCount, 0);
      assert.equal(enrichedResult.excludedCandidates.cacheduser.source, 'fame');
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once('exit', resolve);
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

void test('save() prunes sourceLists/candidates from old non-active jobs at boot, keeps the 5 most recent, never touches active jobs, and always strips expired photo URLs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-prune-test-'));
  await mkdir(path.join(dir, '.local'));
  const makeJob = (id, status) => ({
    id,
    sources: ['x'],
    // Every source attempted (success or failure), same as a real finished
    // job — otherwise hasResumableWork() sees an unread source and, since
    // pruning now skips any job it still considers resumable, none of these
    // fixture jobs would ever get pruned regardless of status/age.
    sourcesDone: ['x'],
    mode: 'following',
    limit: 1,
    total: 1,
    done: 1,
    status,
    message: 'saved',
    warnings: [],
    createdAt: '2026-01-01T00:00:00Z',
    rows: [],
    sourceLists: { x: { users: ['a'] } },
    candidates: { a: { fullName: 'A' } },
    excludedCandidates: {
      a: { username: 'a', photoUrl: 'https://cdn.example/a.jpg', reason: 'x' },
    },
  });
  // pruneOldJobData walks the array in order — this mirrors real jobs.json,
  // where jobs.unshift() on creation puts the newest job first.
  const seeded = [
    makeJob('recent-1', 'completed'),
    makeJob('recent-2', 'completed'),
    makeJob('recent-3', 'partial'),
    makeJob('recent-4', 'failed'),
    makeJob('recent-5', 'cancelled'),
    makeJob('old-6', 'completed'),
    makeJob('old-7', 'cancelled'),
    // Old, non-active by status, but still has an unread source — exactly
    // the case that used to crash a later "Devam et": pruning stripped
    // sourceLists, and the resumed 'following' loop then wrote
    // job.sourceLists[source] straight into undefined the moment that
    // source finished reading.
    { ...makeJob('old-8-resumable', 'completed'), sourcesDone: [] },
    makeJob('active-1', 'running'),
    // 'blocked' is old (well past the recent-5 window) but still counts as
    // active — quota/restriction jobs are exactly what auto-resume expects
    // to pick back up, not abandoned scans.
    makeJob('blocked-old', 'blocked'),
  ];
  await writeFile(path.join(dir, '.local/jobs.json'), JSON.stringify(seeded));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
        10000,
      );
      child.stdout.on('data', (c) => {
        if (/http:\/\/127.0.0.1:\d+/.test(String(c))) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error('Server exited ' + code));
      });
    });
    let saved;
    for (let i = 0; i < 50; i++) {
      try {
        saved = JSON.parse(
          await readFile(path.join(dir, '.local/jobs.json'), 'utf8'),
        );
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    const byId = Object.fromEntries(saved.map((j) => [j.id, j]));
    for (const id of [
      'recent-1',
      'recent-2',
      'recent-3',
      'recent-4',
      'recent-5',
    ]) {
      assert.ok(byId[id].sourceLists, `${id} should keep sourceLists`);
      assert.ok(byId[id].candidates, `${id} should keep candidates`);
    }
    for (const id of ['old-6', 'old-7']) {
      assert.equal(byId[id].sourceLists, undefined);
      assert.equal(byId[id].candidates, undefined);
    }
    assert.ok(byId['active-1'].sourceLists, 'active job must never be pruned');
    assert.ok(byId['active-1'].candidates, 'active job must never be pruned');
    assert.ok(
      byId['blocked-old'].sourceLists,
      'blocked job must never be pruned regardless of age',
    );
    assert.ok(
      byId['old-8-resumable'].sourceLists,
      'a job with an unread source must never be pruned, however old or its status, or a later resume crashes',
    );
    for (const job of saved)
      if (
        !['queued', 'running', 'stopping', 'interrupted', 'blocked'].includes(
          job.status,
        )
      )
        assert.equal(job.excludedCandidates?.a?.photoUrl, undefined);
    assert.equal(
      byId['active-1'].excludedCandidates.a.photoUrl,
      'https://cdn.example/a.jpg',
    );
    assert.equal(
      byId['blocked-old'].excludedCandidates.a.photoUrl,
      'https://cdn.example/a.jpg',
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

void test('GET /api/export-rows returns deduped JSON rows across selected scans, same rules as the Excel export, and 400s with no selection', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-export-rows-test-'));
  await mkdir(path.join(dir, '.local'));
  const baseJob = (id, overrides) => ({
    id,
    sources: ['srcA'],
    mode: 'following',
    platform: 'instagram',
    limit: 100,
    total: 1,
    done: 1,
    status: 'completed',
    message: 'saved',
    warnings: [],
    createdAt: '2026-01-01T00:00:00Z',
    rows: [],
    ...overrides,
  });
  const seeded = [
    baseJob('aaaaaaaa-1111-4111-8111-111111111111', {
      sourceLists: { srcA: { users: ['duplicateuser', 'onlyinfirst'] } },
      rows: [
        {
          username: 'duplicateuser',
          platform: 'instagram',
          email: 'old@example.com',
          collectedAt: '2026-01-01T00:00:00Z',
        },
        {
          username: 'onlyinfirst',
          platform: 'instagram',
          email: null,
          collectedAt: '2026-01-01T00:00:00Z',
        },
      ],
    }),
    baseJob('bbbbbbbb-2222-4111-8111-222222222222', {
      sources: ['srcB'],
      sourceLists: { srcB: { users: ['duplicateuser'] } },
      rows: [
        {
          username: 'duplicateuser',
          platform: 'instagram',
          email: 'new@example.com',
          collectedAt: '2026-01-02T00:00:00Z',
        },
      ],
    }),
  ];
  await writeFile(path.join(dir, '.local/jobs.json'), JSON.stringify(seeded));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
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
        reject(new Error('Server exited ' + code));
      });
    });
    let cookie = '';
    const get = (route) => fetch(base + route, { headers: { Cookie: cookie } });
    const post = (route, data) =>
      fetch(base + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://trilogy-punch-ion.ngrok-free.dev',
          Cookie: cookie,
        },
        body: JSON.stringify(data),
      });
    const credentials = await readFile(
      path.join(dir, '.local/ilk-giris.txt'),
      'utf8',
    );
    const tempPassword = credentials
      .split('\n')
      .find((line) => line.includes('kullanıcı adı admin |'))
      .split('geçici şifre ')[1];
    const loginRes = await post('/api/auth/login', {
      username: 'admin',
      password: tempPassword,
    });
    cookie = loginRes.headers.get('set-cookie').split(';')[0];
    await post('/api/auth/password', {
      currentPassword: tempPassword,
      password: 'Admin-new-pass-12345',
    });
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'Admin-new-pass-12345',
    });
    cookie = relogin.headers.get('set-cookie').split(';')[0];

    assert.equal((await get('/api/export-rows')).status, 400);

    const res = await get(
      '/api/export-rows?jobIds=aaaaaaaa-1111-4111-8111-111111111111,bbbbbbbb-2222-4111-8111-222222222222',
    );
    assert.equal(res.status, 200);
    const { rows } = await res.json();
    assert.equal(rows.length, 2, 'duplicateuser deduped across both jobs');
    const byUsername = Object.fromEntries(rows.map((r) => [r.username, r]));
    assert.equal(
      byUsername.duplicateuser.email,
      'new@example.com',
      'kept the most recently collected copy, not the first job it appeared in',
    );
    assert.equal(byUsername.duplicateuser.sourceLabel, '@srcB');
    assert.equal(byUsername.onlyinfirst.sourceLabel, '@srcA');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    await rm(dir, { recursive: true, force: true });
  }
});

void test('GET /api/jobs and /api/jobs/:id strip heavy per-candidate discovery data the frontend never reads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-slim-job-test-'));
  await mkdir(path.join(dir, '.local'));
  const seeded = [
    {
      id: 'cccccccc-1111-4111-8111-111111111111',
      sources: ['srcA'],
      sourcesDone: ['srcA'],
      mode: 'following',
      platform: 'instagram',
      limit: 100,
      total: 1,
      done: 1,
      status: 'completed',
      message: 'saved',
      warnings: [],
      createdAt: '2026-01-01T00:00:00Z',
      rows: [{ username: 'visited', platform: 'instagram', collectedAt: '2026-01-01T00:00:00Z' }],
      sourceLists: {
        srcA: {
          followers: 12345,
          users: ['heavyuser'],
          requestedLimit: 100,
          candidates: {
            heavyuser: { photoUrl: 'https://cdn.example/heavy.jpg', photos: ['a', 'b', 'c'] },
          },
        },
      },
      candidates: {
        heavyuser: { photoUrl: 'https://cdn.example/heavy.jpg', photos: ['a', 'b', 'c'] },
      },
      excludedCandidates: {
        heavyuser: { username: 'heavyuser', photoUrl: 'https://cdn.example/heavy.jpg', reason: 'x' },
      },
    },
  ];
  await writeFile(path.join(dir, '.local/jobs.json'), JSON.stringify(seeded));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
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
        reject(new Error('Server exited ' + code));
      });
    });
    let cookie = '';
    const get = (route) => fetch(base + route, { headers: { Cookie: cookie } });
    const post = (route, data) =>
      fetch(base + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://trilogy-punch-ion.ngrok-free.dev',
          Cookie: cookie,
        },
        body: JSON.stringify(data),
      });
    const credentials = await readFile(
      path.join(dir, '.local/ilk-giris.txt'),
      'utf8',
    );
    const tempPassword = credentials
      .split('\n')
      .find((line) => line.includes('kullanıcı adı admin |'))
      .split('geçici şifre ')[1];
    const loginRes = await post('/api/auth/login', {
      username: 'admin',
      password: tempPassword,
    });
    cookie = loginRes.headers.get('set-cookie').split(';')[0];
    await post('/api/auth/password', {
      currentPassword: tempPassword,
      password: 'Admin-new-pass-12345',
    });
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'Admin-new-pass-12345',
    });
    cookie = relogin.headers.get('set-cookie').split(';')[0];

    const list = await (await get('/api/jobs')).json();
    const summary = list.find((j) => j.id === seeded[0].id);
    assert.equal(
      summary.sourceLists.srcA.candidates,
      undefined,
      'list view keeps sourceLists trimmed to just followers, same as detail view',
    );
    assert.equal(summary.candidates, undefined, 'list view drops candidates entirely');
    assert.equal(
      summary.excludedCandidates,
      undefined,
      'list view drops excludedCandidates entirely',
    );
    assert.equal(summary.count, 1);

    const detail = await (await get(`/api/jobs/${seeded[0].id}`)).json();
    assert.equal(detail.candidates, undefined, 'detail view drops the heavy candidates map');
    assert.equal(
      detail.sourceLists.srcA.followers,
      12345,
      'detail view keeps the one field the UI actually reads',
    );
    assert.equal(
      detail.sourceLists.srcA.candidates,
      undefined,
      'detail view drops the nested per-source candidate/photo map',
    );
    assert.equal(
      detail.sourceLists.srcA.users,
      undefined,
      'detail view drops the raw per-source username list',
    );
    // photoUrl itself is gone here too, but that's pruneOldJobData() already
    // stripping it at boot (this job is non-active) — a separate, pre-
    // existing behavior covered by its own test. What this checks is that
    // toClientJob() doesn't ALSO strip excludedCandidates wholesale, unlike
    // candidates/sourceLists.candidates, since the UI does render it.
    assert.equal(detail.excludedCandidates.heavyuser.username, 'heavyuser');
    assert.equal(detail.rows[0].username, 'visited');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    await rm(dir, { recursive: true, force: true });
  }
});

void test('marking a profile "Uygun aday" auto-chains a new following-mode scan from their following list, deduped against usernames already used as a source', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-chain-test-'));
  await mkdir(path.join(dir, '.local'));
  await writeFile(
    path.join(dir, '.local/settings.json'),
    JSON.stringify({ autoChainEnabled: true }),
  );
  const rootJob = {
    id: 'dddddddd-1111-4111-8111-111111111111',
    sources: ['rootsource'],
    sourcesDone: ['rootsource'],
    mode: 'following',
    platform: 'instagram',
    market: 'gr',
    limit: 100,
    total: 2,
    done: 2,
    status: 'completed',
    message: 'saved',
    warnings: [],
    createdAt: '2026-01-01T00:00:00Z',
    rows: [
      { username: 'candidateone', platform: 'instagram', collectedAt: '2026-01-01T00:00:00Z', ai: null },
      { username: 'candidatetwo', platform: 'instagram', collectedAt: '2026-01-01T00:00:00Z', ai: null },
    ],
    ownerId: 'owner-1',
    ownerName: 'Owner One',
  };
  // Already uses 'candidatetwo' as a source elsewhere — the dedup case.
  const otherJob = {
    id: 'eeeeeeee-2222-4111-8111-222222222222',
    sources: ['candidatetwo'],
    mode: 'following',
    platform: 'instagram',
    limit: 100,
    total: 0,
    done: 0,
    status: 'completed',
    message: 'saved',
    warnings: [],
    createdAt: '2026-01-01T00:00:00Z',
    rows: [],
    ownerId: 'owner-1',
    ownerName: 'Owner One',
  };
  await writeFile(
    path.join(dir, '.local/jobs.json'),
    JSON.stringify([rootJob, otherJob]),
  );
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
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
        reject(new Error('Server exited ' + code));
      });
    });
    let cookie = '';
    const get = (route) => fetch(base + route, { headers: { Cookie: cookie } });
    const post = (route, data) =>
      fetch(base + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://trilogy-punch-ion.ngrok-free.dev',
          Cookie: cookie,
        },
        body: JSON.stringify(data),
      });
    const credentials = await readFile(
      path.join(dir, '.local/ilk-giris.txt'),
      'utf8',
    );
    const tempPassword = credentials
      .split('\n')
      .find((line) => line.includes('kullanıcı adı admin |'))
      .split('geçici şifre ')[1];
    const loginRes = await post('/api/auth/login', {
      username: 'admin',
      password: tempPassword,
    });
    cookie = loginRes.headers.get('set-cookie').split(';')[0];
    await post('/api/auth/password', {
      currentPassword: tempPassword,
      password: 'Admin-new-pass-12345',
    });
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'Admin-new-pass-12345',
    });
    cookie = relogin.headers.get('set-cookie').split(';')[0];

    const markRes = await post(
      `/api/jobs/${rootJob.id}/mark-verdict`,
      { verdict: 'Uygun aday', usernames: ['candidateone', 'candidatetwo'] },
    );
    assert.equal(markRes.status, 200);
    assert.equal((await markRes.json()).marked, 2);

    const list = await (await get('/api/jobs')).json();
    const children = list.filter(
      (j) => j.chainId === rootJob.id && j.id !== rootJob.id,
    );
    assert.equal(
      children.length,
      1,
      'exactly one chain job created, batching all new verdicts together',
    );
    const child_ = children[0];
    assert.equal(child_.mode, 'following');
    assert.deepEqual(child_.sources, ['candidateone']);
    assert.equal(
      child_.sources.includes('candidatetwo'),
      false,
      'candidatetwo already used as a source elsewhere — deduped out',
    );
    assert.equal(child_.chainGeneration, 2);
    assert.equal(child_.market, 'gr', 'inherits market from the parent');

    // Re-marking the same usernames must not create a second chain job —
    // candidateone is now itself used as a source (by the child just
    // created), so a repeat trigger has nothing new to add.
    await post(`/api/jobs/${rootJob.id}/mark-verdict`, {
      verdict: 'Uygun aday',
      usernames: ['candidateone'],
    });
    const listAfter = await (await get('/api/jobs')).json();
    assert.equal(
      listAfter.filter((j) => j.chainId === rootJob.id && j.id !== rootJob.id)
        .length,
      1,
      'still exactly one child — no duplicate chain job from a repeat trigger',
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

void test('GET /api/dm-list selects email-less in-range women across every job, skips already-downloaded ones on a repeat call, and refuses when classification is needed but no OpenAI key is set', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-dm-list-test-'));
  await mkdir(path.join(dir, '.local'));
  const row = (overrides) => ({
    platform: 'instagram',
    collectedAt: '2026-01-01T00:00:00Z',
    email: null,
    followers: 10000,
    photoUrl: 'https://cdn.example/photo.jpg',
    genderGuess: 'kadın',
    ...overrides,
  });
  const seeded = [
    {
      id: 'ffffffff-1111-4111-8111-111111111111',
      sources: ['src'],
      mode: 'following',
      platform: 'instagram',
      limit: 100,
      total: 5,
      done: 5,
      status: 'completed',
      message: 'saved',
      warnings: [],
      createdAt: '2026-01-01T00:00:00Z',
      rows: [
        row({ username: 'qualifiedwoman' }),
        row({ username: 'qualifiedman', genderGuess: 'erkek' }),
        row({ username: 'hasemail', email: 'x@example.com' }),
        row({ username: 'toofew', followers: 100 }),
        row({ username: 'toomany', followers: 1_000_000 }),
      ],
    },
  ];
  await writeFile(path.join(dir, '.local/jobs.json'), JSON.stringify(seeded));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
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
        reject(new Error('Server exited ' + code));
      });
    });
    let cookie = '';
    const get = (route) => fetch(base + route, { headers: { Cookie: cookie } });
    const post = (route, data) =>
      fetch(base + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://trilogy-punch-ion.ngrok-free.dev',
          Cookie: cookie,
        },
        body: JSON.stringify(data),
      });
    const credentials = await readFile(
      path.join(dir, '.local/ilk-giris.txt'),
      'utf8',
    );
    const tempPassword = credentials
      .split('\n')
      .find((line) => line.includes('kullanıcı adı admin |'))
      .split('geçici şifre ')[1];
    const loginRes = await post('/api/auth/login', {
      username: 'admin',
      password: tempPassword,
    });
    cookie = loginRes.headers.get('set-cookie').split(';')[0];
    await post('/api/auth/password', {
      currentPassword: tempPassword,
      password: 'Admin-new-pass-12345',
    });
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'Admin-new-pass-12345',
    });
    cookie = relogin.headers.get('set-cookie').split(';')[0];

    const first = await get('/api/dm-list');
    assert.equal(first.status, 200);
    const firstBook = new ExcelJS.Workbook();
    await firstBook.xlsx.load(Buffer.from(await first.arrayBuffer()));
    const firstSheet = firstBook.worksheets[0];
    assert.equal(firstSheet.rowCount, 2, 'header + exactly one qualifying row');
    assert.equal(firstSheet.getCell('A2').value.text, 'qualifiedwoman');

    const second = await get('/api/dm-list');
    assert.equal(second.status, 200);
    const secondBook = new ExcelJS.Workbook();
    await secondBook.xlsx.load(Buffer.from(await second.arrayBuffer()));
    assert.equal(
      secondBook.worksheets[0].rowCount,
      1,
      'qualifiedwoman already downloaded — header only this time',
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

void test('GET /api/dm-list throws a clear error instead of a silent wrong result when a row needs AI classification but no OpenAI key is configured', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-dm-list-nokey-test-'));
  await mkdir(path.join(dir, '.local'));
  const seeded = [
    {
      id: 'aaaaffff-1111-4111-8111-111111111111',
      sources: ['src'],
      mode: 'following',
      platform: 'instagram',
      limit: 100,
      total: 1,
      done: 1,
      status: 'completed',
      message: 'saved',
      warnings: [],
      createdAt: '2026-01-01T00:00:00Z',
      rows: [
        {
          username: 'unclassified',
          platform: 'instagram',
          collectedAt: '2026-01-01T00:00:00Z',
          email: null,
          followers: 10000,
          photoUrl: 'https://cdn.example/photo.jpg',
          // no genderGuess yet — needs a fresh AI call
        },
      ],
    },
  ];
  await writeFile(path.join(dir, '.local/jobs.json'), JSON.stringify(seeded));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
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
        reject(new Error('Server exited ' + code));
      });
    });
    let cookie = '';
    const get = (route) => fetch(base + route, { headers: { Cookie: cookie } });
    const post = (route, data) =>
      fetch(base + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://trilogy-punch-ion.ngrok-free.dev',
          Cookie: cookie,
        },
        body: JSON.stringify(data),
      });
    const credentials = await readFile(
      path.join(dir, '.local/ilk-giris.txt'),
      'utf8',
    );
    const tempPassword = credentials
      .split('\n')
      .find((line) => line.includes('kullanıcı adı admin |'))
      .split('geçici şifre ')[1];
    const loginRes = await post('/api/auth/login', {
      username: 'admin',
      password: tempPassword,
    });
    cookie = loginRes.headers.get('set-cookie').split(';')[0];
    await post('/api/auth/password', {
      currentPassword: tempPassword,
      password: 'Admin-new-pass-12345',
    });
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'Admin-new-pass-12345',
    });
    cookie = relogin.headers.get('set-cookie').split(';')[0];

    const res = await get('/api/dm-list');
    assert.notEqual(res.status, 200);
    const data = await res.json();
    assert.match(data.error, /OpenAI/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    await rm(dir, { recursive: true, force: true });
  }
});

void test('POST /api/jobs/:id/export skips rows already included in an earlier export of the same job, but not a different job with the same username', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-export-dedup-test-'));
  await mkdir(path.join(dir, '.local'));
  const makeRow = (username) => ({
    username,
    platform: 'instagram',
    collectedAt: '2026-01-01T00:00:00Z',
    email: `${username}@example.com`,
    followers: 1000,
    following: 100,
    private: false,
    bio: 'bio',
  });
  const seeded = [
    {
      id: 'bbbbffff-1111-4111-8111-111111111111',
      sources: ['src'],
      mode: 'profiles',
      platform: 'instagram',
      limit: 100,
      total: 2,
      done: 2,
      status: 'completed',
      message: 'saved',
      warnings: [],
      createdAt: '2026-01-01T00:00:00Z',
      rows: [makeRow('repeatuser'), makeRow('onlyinfirst')],
    },
    {
      id: 'ccccffff-2222-4111-8111-222222222222',
      sources: ['repeatuser'],
      mode: 'profiles',
      platform: 'instagram',
      limit: 100,
      total: 1,
      done: 1,
      status: 'completed',
      message: 'saved',
      warnings: [],
      createdAt: '2026-01-01T00:00:00Z',
      rows: [makeRow('repeatuser')],
    },
  ];
  await writeFile(path.join(dir, '.local/jobs.json'), JSON.stringify(seeded));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
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
        reject(new Error('Server exited ' + code));
      });
    });
    let cookie = '';
    const post = (route, data) =>
      fetch(base + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://trilogy-punch-ion.ngrok-free.dev',
          Cookie: cookie,
        },
        body: JSON.stringify(data),
      });
    const credentials = await readFile(
      path.join(dir, '.local/ilk-giris.txt'),
      'utf8',
    );
    const tempPassword = credentials
      .split('\n')
      .find((line) => line.includes('kullanıcı adı admin |'))
      .split('geçici şifre ')[1];
    const loginRes = await post('/api/auth/login', {
      username: 'admin',
      password: tempPassword,
    });
    cookie = loginRes.headers.get('set-cookie').split(';')[0];
    await post('/api/auth/password', {
      currentPassword: tempPassword,
      password: 'Admin-new-pass-12345',
    });
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'Admin-new-pass-12345',
    });
    cookie = relogin.headers.get('set-cookie').split(';')[0];

    const firstJobId = seeded[0].id;
    const secondJobId = seeded[1].id;

    const first = await post(`/api/jobs/${firstJobId}/export`, {
      format: 'csv',
      filters: {},
    });
    assert.equal(first.status, 200);
    const firstCsv = await first.text();
    assert.match(firstCsv, /repeatuser/);
    assert.match(firstCsv, /onlyinfirst/);

    const second = await post(`/api/jobs/${firstJobId}/export`, {
      format: 'csv',
      filters: {},
    });
    const secondCsv = await second.text();
    assert.doesNotMatch(
      secondCsv,
      /repeatuser/,
      'already exported from this job — skipped on the repeat pull',
    );
    assert.doesNotMatch(secondCsv, /onlyinfirst/);

    const otherJob = await post(`/api/jobs/${secondJobId}/export`, {
      format: 'csv',
      filters: {},
    });
    const otherJobCsv = await otherJob.text();
    assert.match(
      otherJobCsv,
      /repeatuser/,
      "a different job is not affected by the first job's export log",
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

void test('GET /api/export-all and /api/export-rows share the same per-job export log as /api/jobs/:id/export — a username pulled through any of them is skipped by the others afterward', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-export-all-dedup-test-'));
  await mkdir(path.join(dir, '.local'));
  const makeRow = (username) => ({
    username,
    platform: 'instagram',
    collectedAt: '2026-01-01T00:00:00Z',
    email: `${username}@example.com`,
    followers: 1000,
    following: 100,
    private: false,
    bio: 'bio',
  });
  const seeded = [
    {
      id: 'eeeeaaaa-1111-4111-8111-111111111111',
      sources: ['src'],
      mode: 'profiles',
      platform: 'instagram',
      limit: 100,
      total: 2,
      done: 2,
      status: 'completed',
      message: 'saved',
      warnings: [],
      createdAt: '2026-01-01T00:00:00Z',
      rows: [makeRow('viaexportall'), makeRow('viaexportrows')],
    },
  ];
  await writeFile(path.join(dir, '.local/jobs.json'), JSON.stringify(seeded));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
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
        reject(new Error('Server exited ' + code));
      });
    });
    let cookie = '';
    const get = (route) => fetch(base + route, { headers: { Cookie: cookie } });
    const post = (route, data) =>
      fetch(base + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://trilogy-punch-ion.ngrok-free.dev',
          Cookie: cookie,
        },
        body: JSON.stringify(data),
      });
    const credentials = await readFile(
      path.join(dir, '.local/ilk-giris.txt'),
      'utf8',
    );
    const tempPassword = credentials
      .split('\n')
      .find((line) => line.includes('kullanıcı adı admin |'))
      .split('geçici şifre ')[1];
    const loginRes = await post('/api/auth/login', {
      username: 'admin',
      password: tempPassword,
    });
    cookie = loginRes.headers.get('set-cookie').split(';')[0];
    await post('/api/auth/password', {
      currentPassword: tempPassword,
      password: 'Admin-new-pass-12345',
    });
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'Admin-new-pass-12345',
    });
    cookie = relogin.headers.get('set-cookie').split(';')[0];

    const jobId = seeded[0].id;

    // /api/export-rows only previews — it must not mark anything by
    // itself, since the filter sheet may show more than the user ends up
    // actually keeping/downloading.
    const viaRows = await (await get(`/api/export-rows?jobIds=${jobId}`)).json();
    assert.deepEqual(
      viaRows.rows.map((r) => r.username).sort(),
      ['viaexportall', 'viaexportrows'],
      'both rows still present before anything has been exported',
    );
    const second = await (await get(`/api/export-rows?jobIds=${jobId}`)).json();
    assert.deepEqual(
      second.rows.map((r) => r.username).sort(),
      ['viaexportall', 'viaexportrows'],
      'a repeat preview still shows both — merely fetching is not exporting',
    );

    // Explicitly marking 'viaexportrows' (as the filter sheet's actual
    // "İçe aktarım formatında indir" download does) is what logs it.
    const markRes = await post('/api/export-rows/mark', {
      rows: [{ jobId, platform: 'instagram', username: 'viaexportrows' }],
    });
    assert.equal(markRes.status, 200);

    // /api/export-all now only sees 'viaexportall' — 'viaexportrows' was
    // explicitly marked above.
    const firstAll = await get(`/api/export-all?jobIds=${jobId}`);
    assert.equal(firstAll.status, 200);
    const firstBook = new ExcelJS.Workbook();
    await firstBook.xlsx.load(Buffer.from(await firstAll.arrayBuffer()));
    const firstSheet = firstBook.worksheets[0];
    assert.equal(firstSheet.rowCount, 2, 'header + exactly one row');
    assert.equal(firstSheet.getCell('A2').value.text, 'viaexportall');

    // Both have now been logged (one via export-all, one via the explicit
    // mark call) — the single-job export (a separate route, same per-job
    // log) sees neither anymore.
    const single = await post(`/api/jobs/${jobId}/export`, {
      format: 'csv',
      filters: {},
    });
    const singleCsv = await single.text();
    assert.doesNotMatch(singleCsv, /viaexportall/);
    assert.doesNotMatch(singleCsv, /viaexportrows/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    });
    await rm(dir, { recursive: true, force: true });
  }
});

void test('POST /api/dm-list/start returns immediately (status: idle) when nothing needs classifying, and errors without starting a background run when classification is needed but no OpenAI key is set', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ig-dm-list-start-test-'));
  await mkdir(path.join(dir, '.local'));
  const seeded = [
    {
      id: 'ddddffff-1111-4111-8111-111111111111',
      sources: ['src'],
      mode: 'following',
      platform: 'instagram',
      limit: 100,
      total: 2,
      done: 2,
      status: 'completed',
      message: 'saved',
      warnings: [],
      createdAt: '2026-01-01T00:00:00Z',
      rows: [
        {
          username: 'alreadyclassified',
          platform: 'instagram',
          collectedAt: '2026-01-01T00:00:00Z',
          email: null,
          followers: 10000,
          photoUrl: 'https://cdn.example/photo.jpg',
          genderGuess: 'kadın',
        },
        {
          username: 'needsclassification',
          platform: 'instagram',
          collectedAt: '2026-01-01T00:00:00Z',
          email: null,
          followers: 10000,
          photoUrl: 'https://cdn.example/photo.jpg',
        },
      ],
    },
  ];
  await writeFile(path.join(dir, '.local/jobs.json'), JSON.stringify(seeded));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/index.mjs', import.meta.url))],
    {
      cwd: dir,
      env: {
        ...process.env,
        API_PORT: '0',
        APP_LAN_ORIGIN: 'https://trilogy-punch-ion.ngrok-free.dev',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not start')),
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
        reject(new Error('Server exited ' + code));
      });
    });
    let cookie = '';
    const get = (route) => fetch(base + route, { headers: { Cookie: cookie } });
    const post = (route, data) =>
      fetch(base + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://trilogy-punch-ion.ngrok-free.dev',
          Cookie: cookie,
        },
        body: JSON.stringify(data ?? {}),
      });
    const credentials = await readFile(
      path.join(dir, '.local/ilk-giris.txt'),
      'utf8',
    );
    const tempPassword = credentials
      .split('\n')
      .find((line) => line.includes('kullanıcı adı admin |'))
      .split('geçici şifre ')[1];
    const loginRes = await post('/api/auth/login', {
      username: 'admin',
      password: tempPassword,
    });
    cookie = loginRes.headers.get('set-cookie').split(';')[0];
    await post('/api/auth/password', {
      currentPassword: tempPassword,
      password: 'Admin-new-pass-12345',
    });
    const relogin = await post('/api/auth/login', {
      username: 'admin',
      password: 'Admin-new-pass-12345',
    });
    cookie = relogin.headers.get('set-cookie').split(';')[0];

    // 'needsclassification' has no cached genderGuess and no OpenAI key is
    // configured in this fixture — /start must refuse up front rather than
    // kicking off a background run doomed to fail silently.
    const started = await post('/api/dm-list/start');
    assert.notEqual(started.status, 200);
    const startedBody = await started.json();
    assert.match(startedBody.error, /OpenAI/);

    const status = await (await get('/api/dm-list/status')).json();
    assert.equal(
      status.status,
      'idle',
      'refused start must not leave a stale "running" status behind',
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
