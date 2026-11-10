import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { verifyDisposableIntegrationTarget } from '../helpers/disposable-integration-target.js';
import { cleanupReceptionTest } from '../helpers/reception-test-lifecycle.js';

const enabled = process.env.DISPOSABLE_INTEGRATION_TARGET === 'true';
test('admin account search through real JWT and PostgreSQL preserves privacy, filters, order and literal matching', { skip: !enabled, timeout: 20000 }, async () => {
  await verifyDisposableIntegrationTarget();
  const [{ createApp }, { JwtTokenService }, { default: config }] = await Promise.all([
    import('../../src/app.ts'),
    import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
    import('../../src/config.ts'),
  ]);
  const pool = new pg.Pool({ connectionString: process.env.DISPOSABLE_INTEGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 7000 });
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const prefix = `SEARCH${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const names = ids.map((_, i) => `${prefix}${i}`);
  const emails = ids.map((_, i) => `${prefix.toLowerCase()}${i}${i === 3 ? '%_\\?x' : ''}@example.invalid`);
  let server, primaryError;
  try {
    for (let i = 0; i < ids.length; i++) {
      await pool.query('INSERT INTO users(id,username,password_hash,role,email) VALUES($1,$2,$3,$4,$5)',
        [ids[i], names[i], 'synthetic-secret', i === 0 ? 'admin' : i === 5 ? 'estudiante' : 'reception', emails[i]]);
    }
    await pool.query(`INSERT INTO reception_career_grants(user_id,career_id,granted_by)
      SELECT $1::uuid,id,$3::uuid FROM careers WHERE code IN ('kinesiology','odontology') UNION ALL
      SELECT $2::uuid,id,$3::uuid FROM careers WHERE code='odontology'`, [ids[1], ids[2], ids[0]]);
    await pool.query(`INSERT INTO reception_career_grants(user_id,career_id,granted_by,revoked_by,revoked_at)
      SELECT $1::uuid,id,$2::uuid,$2::uuid,clock_timestamp() FROM careers WHERE code='kinesiology'`, [ids[3], ids[0]]);
    const tokens = new JwtTokenService({ secret: config.jwtSecret, secretKid: config.jwtSecretKid,
      previousSecrets: config.jwtPreviousSecrets, expiresIn: config.jwtExpiresIn });
    const sign = i => tokens.sign({ sub: ids[i], username: names[i], role: i === 0 ? 'admin' : i === 5 ? 'estudiante' : 'reception', permissions: ['reception:accounts:write'] });
    const admin = await sign(0);
    server = createApp(pool).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const get = async (query = '', token = admin) => {
      const url = `http://127.0.0.1:${server.address().port}/auth/accounts${query}`;
      const response = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch {
        assert.fail(`GET ${url} returned HTTP ${response.status} with ${response.headers.get('content-type')}; body: ${text}`);
      }
      return { status: response.status, cache: response.headers.get('cache-control'), body };
    };
    const dto = i => ({ id: ids[i], username: names[i], email: emails[i], active_careers: i === 1 ? ['kinesiology', 'odontology'] : i === 2 ? ['odontology'] : [] });
    const search = `?q=${prefix.toLowerCase()}`;
    assert.deepEqual(await get(search), { status: 200, cache: 'no-store', body: { items: [1, 2, 3, 4].map(dto), limit: 50, offset: 0 } });
    assert.deepEqual((await get(`${search}&career=kinesiology`)).body.items, [dto(1)]);
    assert.deepEqual((await get(`${search}&career=odontology`)).body.items, [dto(1), dto(2)]);
    assert.deepEqual((await get(`${search}&limit=2&offset=1`)).body, { items: [dto(2), dto(3)], limit: 2, offset: 1 });
    for (const q of [emails[2].toUpperCase(), '%', '_', '\\', '?', '?x', '%_\\?x']) {
      assert.deepEqual((await get(`?q=${encodeURIComponent(q)}`)).body.items, [dto(q === emails[2].toUpperCase() ? 2 : 3)]);
    }
    assert.deepEqual((await get('?q=?x')).body.items, [dto(3)]);
    assert.deepEqual((await get(`?q=${encodeURIComponent("' OR true --")}`)).body.items, []);
    assert.deepEqual((await get(`${search}&offset=10000`)).body, { items: [], limit: 50, offset: 10000 });
    const all = await get();
    assert.equal(all.status, 200);
    for (const i of [1, 2, 3, 4]) assert.deepEqual(all.body.items.find(item => item.id === ids[i]), dto(i));
    for (const token of [null, 'invalid', await sign(1), await sign(5)]) {
      const denied = await get(search, token);
      assert.equal(denied.status, !token || token === 'invalid' ? 401 : 403);
      assert.deepEqual(Object.keys(denied.body), ['error']);
    }
    for (const query of [`${search}&limit=0`, `${search}&q=second`, `${search}&unknown=1`]) {
      const invalid = await get(query);
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error.code, 'BAD_REQUEST');
    }
    // Rejected reads and forged permission claims leave the public account projection unchanged.
    assert.deepEqual((await get(search)).body, { items: [1, 2, 3, 4].map(dto), limit: 50, offset: 0 });
  } catch (error) { primaryError = error; }
  finally {
    await cleanupReceptionTest([
      async () => { if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
      () => pool.query('DELETE FROM reception_career_grants WHERE user_id=ANY($1::uuid[]) OR granted_by=ANY($1::uuid[])', [ids]),
      () => pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]),
      () => pool.end(),
    ], primaryError);
  }
});
