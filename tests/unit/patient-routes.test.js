import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGetActor } from '../../src/modules/patients/infrastructure/routes/patient.routes.ts';

test('defaultGetActor prefers the req.auth.userId alias over sub (PAT-004)', async () => {
  const req = { auth: { role: 'teacher', permissions: [], userId: 'uuid-user', sub: 'uuid-sub' } };
  assert.equal(await defaultGetActor(req), 'uuid-user');
});

test('defaultGetActor falls back to req.auth.sub when userId is absent', async () => {
  const req = { auth: { role: 'teacher', permissions: [], sub: 'uuid-sub' } };
  assert.equal(await defaultGetActor(req), 'uuid-sub');
});

test('defaultGetActor resolves null when req.auth is unset or has no subject', async () => {
  assert.equal(await defaultGetActor({}), null);
  assert.equal(await defaultGetActor({ auth: {} }), null);
});