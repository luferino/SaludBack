import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { authenticate } from '../../src/modules/auth/infrastructure/middleware/authenticate.ts';

const USER = '40000000-0000-4000-8000-000000000002';
const GRANT = '50000000-0000-4000-8000-000000000001';

test('public protected route rejects revoked or mismatched grant instances, and exposes database faults as 500', async () => {
  async function requestFor(claims, liveReader) {
    const app = express();
    app.use('/secure', authenticate({ async verify() { return claims; } }, { async permissionsForRole() { return ['reception:patients:manage']; } }, liveReader),
      (req, res) => res.json({ role: req.auth.role, grant: req.auth.roleGrantId }));
    app.use(errorHandler);
    const server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/secure`, { headers: { authorization: 'Bearer test' } });
      return { status: response.status, body: await response.json() };
    } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }
  const claims = { sub: USER, username: 'STUDENT1', role: 'reception', role_grant_id: GRANT };
  assert.deepEqual(await requestFor(claims, { async isValidActiveRole(id, role, grantId) {
    assert.deepEqual([id, role, grantId], [USER, 'reception', GRANT]); return true;
  } }), { status: 200, body: { role: 'reception', grant: GRANT } });
  const revoked = await requestFor(claims, { async isValidActiveRole() { return false; } });
  assert.equal(revoked.status, 401); assert.deepEqual(revoked.body.error, { code: 'UNAUTHORIZED', message: 'Invalid or missing token' });
  const fault = await requestFor(claims, { async isValidActiveRole() { throw new Error('database unavailable'); } });
  assert.equal(fault.status, 500); assert.deepEqual(fault.body.error, { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
  const malformed = await requestFor({ ...claims, role_grant_id: 'forged' }, { async isValidActiveRole() { assert.fail('must reject before DB'); } });
  assert.equal(malformed.status, 401);
});
