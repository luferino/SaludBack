import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mountAuthRoutes } from '../../src/bootstrap/routes/auth.routes.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const ADMIN = '40000000-0000-4000-8000-000000000001';
const STALE_ADMIN = '40000000-0000-4000-8000-000000000002';

async function withServer(run) {
  const calls = { snapshot: 0, membership: [] };
  const app = express();
  mountAuthRoutes(app, {
    repository: {}, resetTokenRepository: {}, mailer: {}, hasher: {},
    tokenService: { async verify(token) { return JSON.parse(token); } },
    matrixReader: {
      async permissionsForRole() { return []; },
      async readSnapshot() {
        calls.snapshot++;
        return { permissions: [{ permission: 'profile:read', enforced: false }], roles: [{ role: 'admin', permissions: ['profile:read'] }] };
      },
    },
    roleGrantRepository: {
      async isValidActiveRole(userId, role) { calls.membership.push([userId, role]); return userId !== STALE_ADMIN; },
    },
    receptionRepository: {}, receptionPatientRepository: {}, receptionAvailabilityRepository: {},
    clientUrl: 'http://localhost', resetTokenTtl: 60,
  });
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/auth/permission-matrix`, calls); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function auth(role = 'admin', userId = ADMIN) {
  return { headers: { authorization: `Bearer ${JSON.stringify({ sub: userId, role })}` } };
}

test('GET /auth/permission-matrix uses mounted authentication, requires current Admin, and returns the snapshot', async () => {
  await withServer(async (url, calls) => {
    const unauthenticated = await fetch(url);
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls.snapshot, 0);

    const nonAdmin = await fetch(url, auth('teacher'));
    assert.equal(nonAdmin.status, 403);
    assert.equal(calls.snapshot, 0);

    const staleAdmin = await fetch(url, auth('admin', STALE_ADMIN));
    assert.equal(staleAdmin.status, 401);
    assert.equal(calls.snapshot, 0);

    const response = await fetch(url, auth());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      permissions: [{ permission: 'profile:read', enforced: false }],
      roles: [{ role: 'admin', permissions: ['profile:read'] }],
    });
    assert.deepEqual(calls.membership, [[STALE_ADMIN, 'admin'], [ADMIN, 'admin']]);
    assert.equal(calls.snapshot, 1);
  });
});
