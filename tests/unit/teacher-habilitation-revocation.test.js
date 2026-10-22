import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createServer } from 'node:http';
import { ForbiddenError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { TeacherHabilitation } from '../../src/modules/teacher-habilitations/domain/teacher-habilitation.entity.ts';
import { PgTeacherHabilitationRepository } from '../../src/modules/teacher-habilitations/infrastructure/repositories/pg-teacher-habilitation.repository.ts';
import { createTeacherHabilitationRouter } from '../../src/modules/teacher-habilitations/infrastructure/routes/teacher-habilitation.routes.ts';

const ID = '50000000-0000-4000-8000-000000000001';
const ACTOR = '40000000-0000-4000-8000-000000000001';
const OTHER_ACTOR = '40000000-0000-4000-8000-000000000002';
const row = (revokedBy = null, revokedAt = null) => ({
  id: ID, teacher_id: '30000000-0000-4000-8000-000000000001',
  subject_id: '10000000-0000-4000-8000-000000000001',
  academic_group_id: '20000000-0000-4000-8000-000000000001',
  activated_by: ACTOR, activated_at: new Date('2026-04-05T06:07:08Z'),
  revoked_by: revokedBy, revoked_at: revokedAt,
});

async function withServer(repository, run, actor = ACTOR) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: actor, role: 'teacher', permissions: req.headers['x-permission'] ? [req.headers['x-permission']] : [] };
    next();
  });
  app.use('/teacher-habilitations', createTeacherHabilitationRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

async function revoke(base, id = ID, permission = 'teacher-habilitations:revoke', body) {
  return fetch(`${base}/teacher-habilitations/${id}/revoke`, {
    method: 'POST', headers: { 'x-permission': permission, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('revoke route separates grants, ignores client overrides, and returns the exact stored eight-field representation', async () => {
  const calls = [];
  const stored = row();
  const period = new TeacherHabilitation({
    id: stored.id, teacherId: stored.teacher_id, subjectId: stored.subject_id,
    academicGroupId: stored.academic_group_id, activatedBy: stored.activated_by,
    activatedAt: stored.activated_at, revokedBy: null, revokedAt: null,
  });
  const repository = { async activate(input) { return new TeacherHabilitation({ id: ID, ...input, activatedAt: row().activated_at }); }, async revoke(input) { calls.push(input); return period; } };
  await withServer(repository, async (base) => {
    const denied = await revoke(base, ID, 'teacher-habilitations:write');
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: { code: 'FORBIDDEN', message: "Permission 'teacher-habilitations:revoke' required" } });
    const accepted = await revoke(base, ID, 'teacher-habilitations:revoke', {
      revoked_by: OTHER_ACTOR, revoked_at: '1999-01-01', teacher_id: 'spoof', subject_id: 'spoof', academic_group_id: 'spoof',
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      id: ID, teacher_id: row().teacher_id, subject_id: row().subject_id,
      academic_group_id: row().academic_group_id, activated_by: ACTOR,
      activated_at: '2026-04-05T06:07:08.000Z', revoked_by: null, revoked_at: null,
    });
  });
  assert.deepEqual(calls, [{ id: ID, revokedBy: ACTOR }]);
});

test('invalid actor and malformed ID reject before repository mutation; missing periods and unexpected errors map correctly', async () => {
  for (const [actor, id, wanted] of [[null, ID, 401], ['bad', ID, 401], [ACTOR, 'bad', 400]]) {
    const calls = [];
    const repository = { async activate() {}, async revoke(input) { calls.push(input); return new TeacherHabilitation(row()); } };
    await withServer(repository, async (base) => assert.equal((await revoke(base, id)).status, wanted), actor);
    assert.equal(calls.length, 0);
  }
  for (const [failure, wanted] of [[new NotFoundError('missing'), 404], [new Error('database detail'), 500]]) {
    const repository = { async activate() {}, async revoke() { throw failure; } };
    await withServer(repository, async (base) => assert.equal((await revoke(base)).status, wanted));
  }
});

test('repository uses one ID-targeted conditional UPDATE, preserves both repeat audit facts, and reports unknown IDs', async () => {
  const first = row(OTHER_ACTOR, new Date('2026-04-05T06:07:09Z'));
  const calls = [];
  const repository = new PgTeacherHabilitationRepository({ async query(text, params) {
    calls.push({ text, params });
    return { rows: [first] };
  } });
  const result = await repository.revoke({ id: ID, revokedBy: ACTOR });
  assert.deepEqual(calls[0].params, [ID, ACTOR]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /UPDATE teacher_academic_habilitations/);
  assert.match(calls[0].text, /WHERE id = \$1/);
  assert.match(calls[0].text, /revoked_by = CASE WHEN revoked_at IS NULL THEN \$2 ELSE revoked_by END/);
  assert.match(calls[0].text, /revoked_at = CASE WHEN revoked_at IS NULL[\s\S]*GREATEST\(clock_timestamp\(\), activated_at\)/);
  assert.doesNotMatch(calls[0].text, /teacher_id\s*=|subject_id\s*=|academic_group_id\s*=/);
  assert.equal(result.toJSON().revoked_by, OTHER_ACTOR);
  assert.equal(result.toJSON().revoked_at, '2026-04-05T06:07:09.000Z');

  const missing = new PgTeacherHabilitationRepository({ async query() { return { rows: [] }; } });
  await assert.rejects(missing.revoke({ id: ID, revokedBy: ACTOR }), NotFoundError);
});

test('migration 015 adds an enforced separately delegable permission with an initial admin-only grant', () => {
  const sql = readFileSync(new URL('../../src/db/migrations/015_seed_teacher_habilitation_revocation_permission.sql', import.meta.url), 'utf8');
  assert.match(sql, /\('teacher-habilitations:revoke', true\)/);
  assert.match(sql, /\('admin', 'teacher-habilitations:revoke'\)/);
  assert.doesNotMatch(sql, /teacher-habilitations:write/);
});

test('subjects pre-cleanup source validates the 015 permission and exact initial grant baseline before cleanup', () => {
  const source = readFileSync(new URL('../integration/subjects.test.js', import.meta.url), 'utf8');
  const testStart = source.indexOf("test('migrations 011–025");
  const cleanup = source.indexOf('cleanUpAuthorized = true;', testStart);
  const baseline = source.slice(testStart, cleanup);
  assert.ok(testStart >= 0 && cleanup > testStart);
  assert.match(baseline, /ledgerNamesBefore\.has\('015_seed_teacher_habilitation_revocation_permission\.sql'\)/);
  assert.match(baseline, /teacher-habilitations:revoke', enforced: true/);
  assert.match(baseline, /admin', permission: 'teacher-habilitations:revoke'/);
  assert.ok(baseline.indexOf('teacherHabilitationPermissions') < cleanup);
  assert.ok(baseline.indexOf('teacherHabilitationGrants') < cleanup);
  assert.match(baseline, /assert\.deepEqual\(teacherHabilitationPermissions, \[/);
  assert.match(baseline, /assert\.deepEqual\(teacherHabilitationGrants, \[/);

  const readExpected = (name) => {
    const declaration = source.match(new RegExp(`const ${name} = new Set\\(([\\s\\S]*?)\\);`));
    assert.ok(declaration, `${name} is an exact-source set declaration`);
    return [...declaration[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
  };
  const expectedPermissions = new Set(readExpected('EXPECTED_PERMISSIONS'));
  const expectedGrants = new Set(readExpected('EXPECTED_GRANTS'));
  const preflightAccepts = ({ permissions, grants }) => {
    assert.deepEqual(new Set(permissions.map(({ permission }) => permission)), expectedPermissions);
    assert.ok(permissions.filter(({ permission }) => !['materias:read', 'turnos:read'].includes(permission))
      .every(({ enforced }) => enforced === true));
    assert.deepEqual(new Set(grants.map(({ role, permission }) => `${role}:${permission}`)), expectedGrants);
    assert.equal(grants.length, expectedGrants.size);
  };
  const canonical = {
    permissions: [...expectedPermissions].map((permission) => ({ permission, enforced: !['materias:read', 'turnos:read'].includes(permission) })),
    grants: [...expectedGrants].map((grant) => { const separator = grant.indexOf(':'); return { role: grant.slice(0, separator), permission: grant.slice(separator + 1) }; }),
  };
  assert.doesNotThrow(() => preflightAccepts(canonical));
  assert.throws(() => preflightAccepts({ ...canonical, permissions: canonical.permissions.filter(({ permission }) => permission !== 'teacher-habilitations:revoke') }));
  assert.throws(() => preflightAccepts({ ...canonical, permissions: canonical.permissions.map((entry) => entry.permission === 'teacher-habilitations:revoke' ? { ...entry, enforced: false } : entry) }));
  assert.throws(() => preflightAccepts({ ...canonical, grants: canonical.grants.filter(({ permission }) => permission !== 'teacher-habilitations:revoke') }));
  assert.throws(() => preflightAccepts({ ...canonical, grants: [...canonical.grants, { role: 'teacher', permission: 'teacher-habilitations:revoke' }] }));
});
