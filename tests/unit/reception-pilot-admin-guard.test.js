import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceptionPilotAdminGuard } from '../../src/modules/auth/application/reception-pilot-admin-guard.ts';

const ADMIN = 'abcdef01-0000-4000-8000-000000000001';
const OTHER = 'abcdef01-0000-4000-8000-000000000002';

function request(userId, role = 'admin') {
  return { auth: { userId, role, permissions: ['reception:accounts:write', 'reception:careers:write'] } };
}

test('Reception pilot authority requires an individually enabled, current, active Admin', async () => {
  const checks = [];
  let current = true;
  const guard = createReceptionPilotAdminGuard(` ${ADMIN.toUpperCase()} `, {
    async isValidActiveRole(...args) { checks.push(args); return current; },
  });
  await guard.authorize(request(ADMIN));
  for (const actor of [request(OTHER), request(ADMIN, 'reception'), { auth: { role: 'admin' } }]) {
    await assert.rejects(guard.authorize(actor), { name: 'ForbiddenError' });
  }
  assert.deepEqual(checks, [[ADMIN, 'admin']]);
  current = false;
  await assert.rejects(guard.authorize(request(ADMIN)), { name: 'ForbiddenError' });
  assert.deepEqual(checks, [[ADMIN, 'admin'], [ADMIN, 'admin']]);
});

test('Reception pilot configuration defaults closed and rejects invalid admin IDs', async () => {
  const membership = { async isValidActiveRole() { assert.fail('No membership lookup expected'); } };
  const guard = createReceptionPilotAdminGuard(undefined, membership);
  await assert.rejects(guard.authorize(request(ADMIN)), { name: 'ForbiddenError' });
  assert.throws(() => createReceptionPilotAdminGuard(`${ADMIN},not-an-id`, membership), /RECEPTION_PILOT_ADMIN_IDS/);
});
