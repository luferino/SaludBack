import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { ConflictError, NotFoundError } from '../../src/modules/shared/domain/errors.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { TeacherHabilitation } from '../../src/modules/teacher-habilitations/domain/teacher-habilitation.entity.ts';
import { createTeacherHabilitationRouter } from '../../src/modules/teacher-habilitations/infrastructure/routes/teacher-habilitation.routes.ts';

const INPUT = {
  teacher_id: '30000000-0000-4000-8000-000000000001',
  subject_id: '10000000-0000-4000-8000-000000000001',
  academic_group_id: '20000000-0000-4000-8000-000000000001',
};
const ACTOR = '40000000-0000-4000-8000-000000000001';

async function withServer(repository, run, { actor = ACTOR } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: actor, role: 'teacher', permissions: req.headers['x-permission'] === 'teacher-habilitations:write' ? ['teacher-habilitations:write'] : [] };
    next();
  });
  app.use('/teacher-habilitations', createTeacherHabilitationRouter({ repository }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeRepository({ failure } = {}) {
  const calls = [];
  return {
    calls,
    async activate(input) {
      calls.push(input);
      if (failure === 'duplicate') throw new ConflictError('already active');
      if (failure === 'missing') throw new NotFoundError('target not found');
      if (failure === 'unexpected') throw new Error('internal detail');
      return new TeacherHabilitation({ id: '50000000-0000-4000-8000-000000000001', ...input, activatedAt: '2026-04-05T06:07:08Z' });
    },
  };
}

function post(base, body, permission = 'teacher-habilitations:write') {
  return fetch(`${base}/teacher-habilitations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-permission': permission },
    body: JSON.stringify(body),
  });
}

test('POST requires the dedicated write grant and explicitly serializes its created period', async () => {
  const repository = fakeRepository();
  await withServer(repository, async (base) => {
    assert.equal((await post(base, INPUT, 'teacher-habilitations:read')).status, 403);
    const response = await post(base, {
      ...INPUT,
      activated_by: 'spoofed', activatedBy: 'spoofed', activated_at: '2000-01-01T00:00:00Z', revoked_at: 'spoofed',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      id: '50000000-0000-4000-8000-000000000001',
      teacher_id: INPUT.teacher_id,
      subject_id: INPUT.subject_id,
      academic_group_id: INPUT.academic_group_id,
      activated_by: ACTOR,
      activated_at: '2026-04-05T06:07:08.000Z',
      revoked_by: null,
      revoked_at: null,
    });
  });
  assert.equal(repository.calls.length, 1);
  assert.deepEqual(repository.calls[0], {
    teacherId: INPUT.teacher_id,
    subjectId: INPUT.subject_id,
    academicGroupId: INPUT.academic_group_id,
    activatedBy: ACTOR,
  });
});

test('missing and malformed actor and invalid or null bodies are rejected before repository mutation', async () => {
  for (const [actor, body, expected] of [
    [null, INPUT, 401],
    ['not-a-uuid', INPUT, 401],
    [ACTOR, null, 400],
    [ACTOR, { ...INPUT, teacher_id: 'invalid' }, 400],
  ]) {
    const repository = fakeRepository();
    await withServer(repository, async (base) => {
      const response = await post(base, body);
      assert.equal(response.status, expected);
    }, { actor });
    assert.equal(repository.calls.length, 0);
  }
});

test('duplicate, missing references, and unexpected errors retain their standard status mapping', async () => {
  for (const [failure, expected] of [['duplicate', 409], ['missing', 404], ['unexpected', 500]]) {
    const repository = fakeRepository({ failure });
    await withServer(repository, async (base) => {
      assert.equal((await post(base, INPUT)).status, expected);
    });
    assert.equal(repository.calls.length, 1);
  }
});
