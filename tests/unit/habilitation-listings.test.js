import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { createTeacherHabilitationRouter } from '../../src/modules/teacher-habilitations/infrastructure/routes/teacher-habilitation.routes.ts';
import { PgTeacherHabilitationRepository } from '../../src/modules/teacher-habilitations/infrastructure/repositories/pg-teacher-habilitation.repository.ts';
import { createStudentHabilitationRouter } from '../../src/modules/student-habilitations/infrastructure/routes/student-habilitation.routes.ts';
import { PgStudentHabilitationRepository } from '../../src/modules/student-habilitations/infrastructure/repositories/pg-student-habilitation.repository.ts';
import { ForbiddenError } from '../../src/modules/shared/domain/errors.ts';

const ACTOR = '40000000-0000-4000-8000-000000000001';
const TEACHER = '30000000-0000-4000-8000-000000000001';
const STUDENT = '50000000-0000-4000-8000-000000000001';
const SUBJECT = '10000000-0000-4000-8000-000000000001';
const GROUP = '20000000-0000-4000-8000-000000000001';
const PERIOD = '60000000-0000-4000-8000-000000000001';
const ROW = { id: PERIOD, teacher_id: TEACHER, student_id: STUDENT, subject_id: SUBJECT, academic_group_id: GROUP,
  activated_by: ACTOR, activated_at: '2026-01-02T03:04:05.000Z', revoked_by: null, revoked_at: null };

async function withServer({ module = 'student', permissions = ['student-habilitations:read'], role = 'teacher', actor = ACTOR, repository }, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (actor) req.auth = { userId: actor, role, permissions };
    next();
  });
  const router = module === 'student' ? createStudentHabilitationRouter({ repository }) : createTeacherHabilitationRouter({ repository });
  app.use(`/${module}-habilitations`, router);
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/${module}-habilitations`); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function fakeRepository() {
  return { lists: [], mutations: [], async list(input) { this.lists.push(input); return [{ id: PERIOD, teacherId: TEACHER, studentId: STUDENT, subjectId: SUBJECT, academicGroupId: GROUP,
    activatedBy: ACTOR, activatedAt: ROW.activated_at, revokedBy: null, revokedAt: null }]; },
    async activate(input) { this.mutations.push(input); return ROW; }, async revoke(input) { this.mutations.push(input); return ROW; } };
}

 test('student history uses independent read grant, validated filters, paging, and whitelisted ISO response', async () => {
  const repository = fakeRepository();
  await withServer({ repository }, async (url) => {
    assert.equal((await fetch(url)).status, 200);
    const response = await fetch(`${url}?student_id=${STUDENT}&subject_id=${SUBJECT}&academic_group_id=${GROUP}&status=active&limit=7&offset=3`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ id: PERIOD, student_id: STUDENT, subject_id: SUBJECT,
      academic_group_id: GROUP, activated_by: ACTOR, activated_at: '2026-01-02T03:04:05.000Z', revoked_by: null, revoked_at: null }], limit: 7, offset: 3 });
    assert.deepEqual(repository.lists[1], { studentId: STUDENT, subjectId: SUBJECT, academicGroupId: GROUP, status: 'active', limit: 7, offset: 3, actorId: ACTOR, isAdmin: false });
  });
});

test('valid uppercase UUID filters are normalized before both listing ports', async () => {
  const uppercaseSubject = 'ABCDEFAB-0000-4000-8000-000000000031';
  const studentRepository = fakeRepository();
  await withServer({ repository: studentRepository }, async (url) => {
    assert.equal((await fetch(`${url}?subject_id=${uppercaseSubject}`)).status, 200);
  });
  assert.equal(studentRepository.lists[0].subjectId, uppercaseSubject.toLowerCase());

  const teacherRepository = fakeRepository();
  await withServer({ module: 'teacher', repository: teacherRepository, role: 'admin', permissions: ['teacher-habilitations:read'] }, async (url) => {
    assert.equal((await fetch(`${url}?subject_id=${uppercaseSubject}`)).status, 200);
  });
  assert.equal(teacherRepository.lists[0].subjectId, uppercaseSubject.toLowerCase());
});

test('malformed UUID, status, pagination, repeated values are rejected before listing', async () => {
  for (const query of ['?student_id=nope', '?status=all', '?limit=0', '?limit=101', '?offset=10001', '?limit=1.5', '?offset=-1', `?subject_id=${SUBJECT}&subject_id=${GROUP}`]) {
    const repository = fakeRepository();
    await withServer({ repository }, async (url) => assert.equal((await fetch(`${url}${query}`)).status, 400, query));
    assert.equal(repository.lists.length, 0, query);
  }
});

test('missing read grant and missing authentication are denied; write-only does not grant read', async () => {
  for (const [permissions, actor, expected] of [[[], ACTOR, 403], [['student-habilitations:write'], ACTOR, 403], [['student-habilitations:read'], null, 401]]) {
    const repository = fakeRepository();
    await withServer({ repository, permissions, actor }, async (url) => assert.equal((await fetch(url)).status, expected));
    assert.equal(repository.lists.length, 0);
  }
});

test('teacher history read requires explicit read grant; admin also requires explicit read grant', async () => {
  for (const [role, permissions, expected] of [['teacher', [], 403], ['teacher', ['teacher-habilitations:read'], 200], ['admin', [], 403], ['admin', ['teacher-habilitations:read'], 200]]) {
    const repository = fakeRepository();
    await withServer({ module: 'teacher', repository, role, permissions }, async (url) => assert.equal((await fetch(url)).status, expected));
  }
});

test('teacher history response uses only the period and teacher-profile identifiers and audit fields', async () => {
  const repository = fakeRepository();
  await withServer({ module: 'teacher', repository, role: 'admin', permissions: ['teacher-habilitations:read'] }, async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ id: PERIOD, teacher_id: TEACHER, subject_id: SUBJECT, academic_group_id: GROUP,
      activated_by: ACTOR, activated_at: '2026-01-02T03:04:05.000Z', revoked_by: null, revoked_at: null }], limit: 50, offset: 0 });
  });
});

test('teacher repository parameterizes filters and orders before pagination for active and revoked history', async () => {
  const calls = [];
  const repository = new PgTeacherHabilitationRepository({ async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } });
  for (const status of ['active', 'revoked']) {
    assert.deepEqual(await repository.list({ teacherId: TEACHER, subjectId: SUBJECT, academicGroupId: GROUP, status, limit: 10, offset: 20 }), []);
  }
  calls.forEach(({ sql, params }, index) => {
    assert.deepEqual(params, [TEACHER, SUBJECT, GROUP, 10, 20]);
    assert.match(sql, /teacher_id = \$1 AND subject_id = \$2 AND academic_group_id = \$3/);
    assert.match(sql, /ORDER BY activated_at DESC, id DESC LIMIT \$4 OFFSET \$5/);
    assert.ok(sql.includes(index === 0 ? 'revoked_at IS NULL' : 'revoked_at IS NOT NULL'));
  });
});

test('student list requires live teacher context and preserves active/revoked history filter', async () => {
  const repository = fakeRepository();
  await withServer({ repository }, async (url) => {
    assert.equal((await fetch(`${url}?status=revoked`)).status, 200);
    assert.equal(repository.lists[0].status, 'revoked');
    assert.equal(repository.lists[0].actorId, ACTOR);
  });
});

test('student repository denies revoked/cross-context scope before listing and scopes before pagination', async () => {
  const queries = [];
  const queryable = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.includes('JOIN teacher_academic_habilitations')) return { rows: [
      { teacher_id: TEACHER, subject_id: SUBJECT, academic_group_id: GROUP },
      { teacher_id: TEACHER, subject_id: '11000000-0000-4000-8000-000000000001', academic_group_id: '21000000-0000-4000-8000-000000000001' },
    ] };
    return { rows: [] };
  } };
  const repository = new PgStudentHabilitationRepository({ withTransaction: async () => { throw new Error('not used'); } }, queryable);
  await assert.rejects(() => repository.list({ studentId: STUDENT, subjectId: SUBJECT, academicGroupId: '21000000-0000-4000-8000-000000000001', limit: 1, offset: 0, actorId: ACTOR, isAdmin: false }), ForbiddenError);
  assert.equal(queries.length, 1, 'unauthorized explicit context does not reach history query');

  queries.length = 0;
  const result = await repository.list({ limit: 1, offset: 0, actorId: ACTOR, isAdmin: false });
  assert.deepEqual(result, []);
  assert.equal(queries[1].sql.includes('EXISTS (SELECT 1 FROM teacher_academic_habilitations scope'), true);
  assert.ok(queries[1].sql.indexOf('scope.revoked_at IS NULL') < queries[1].sql.indexOf('LIMIT'), 'fresh live scope is applied before pagination');
});

test('student repository excludes revoked teacher contexts and admin empty results remain empty', async () => {
  const queries = [];
  const queryable = { async query(sql) { queries.push(sql); return { rows: [] }; } };
  const repository = new PgStudentHabilitationRepository({ withTransaction: async () => { throw new Error('not used'); } }, queryable);
  await assert.rejects(() => repository.list({ limit: 50, offset: 0, actorId: ACTOR, isAdmin: false }), ForbiddenError);
  assert.equal(queries.length, 1);
  const adminRows = await repository.list({ studentId: STUDENT, limit: 50, offset: 0, actorId: null, isAdmin: true });
  assert.deepEqual(adminRows, []);
  assert.equal(queries.length, 2);
  assert.equal(queries[1].includes('EXISTS'), false);
});
