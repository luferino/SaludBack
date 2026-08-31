import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createStudentRouter, defaultGetActor } from '../../src/modules/students/infrastructure/routes/student.routes.ts';
import { Student } from '../../src/modules/students/domain/student.entity.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';
import { Guard } from '../../src/modules/shared/application/guard.ts';
import { UnauthorizedError } from '../../src/modules/shared/domain/errors.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const CONTRACT_KEYS = ['id', 'nombres', 'apellidos', 'codalumno', 'email', 'celular', 'created_by', 'created_at'];

const VALID_PAYLOAD = {
  username: 'jperez',
  password: 'secret123',
  nombres: 'Ana',
  apellidos: 'Lopez',
  codalumno: '20240123',
  email: 'jperez@mail.com',
  celular: '+5491100000000',
};

function createFakes() {
  const calls = { studentCreate: [], userCreate: [] };
  return {
    calls,
    studentRepository: {
      async findByCodalumno() {
        return null;
      },
      async create(student, client) {
        calls.studentCreate.push({ ...student, client });
        return new Student({
          ...student,
          id: 'uuid-student',
          createdAt: new Date('2026-08-30T12:00:00Z'),
        });
      },
    },
    userRepository: {
      async findByUsername() {
        return null;
      },
      async findByEmail() {
        return null;
      },
      async create(user, client) {
        calls.userCreate.push({ ...user, client });
        return new User({ ...user, id: 'uuid-user', createdAt: new Date('2026-08-30T12:00:00Z') });
      },
    },
    hasher: { async hash() { return 'hashed-value'; } },
    unitOfWork: { async withTransaction(fn) { return fn({}); } },
  };
}

function buildApp(fakes, overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/students',
    createStudentRouter({
      repository: fakes.studentRepository,
      userRepository: fakes.userRepository,
      hasher: fakes.hasher,
      unitOfWork: fakes.unitOfWork,
      ...overrides,
    }),
  );
  app.use(errorHandler);
  return app;
}

test('defaultGetActor prefers the req.auth.userId alias over sub (STU-005)', async () => {
  const req = { auth: { role: 'teacher', permissions: [], userId: 'uuid-user', sub: 'uuid-sub' } };
  assert.equal(await defaultGetActor(req), 'uuid-user');
});

test('defaultGetActor falls back to req.auth.sub when userId is absent (STU-005)', async () => {
  const req = { auth: { role: 'teacher', permissions: [], sub: 'uuid-sub' } };
  assert.equal(await defaultGetActor(req), 'uuid-sub');
});

test('defaultGetActor resolves null when req.auth is unset or has no subject (STU-005)', async () => {
  assert.equal(await defaultGetActor({}), null);
  assert.equal(await defaultGetActor({ auth: {} }), null);
});

test('POST /students returns the 8-key STU-004 contract and attributes created_by via the actor hook', async () => {
  const fakes = createFakes();
  const server = buildApp(fakes, { getActor: async () => 'actor-1' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${url}/students`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort());
    assert.equal(body.codalumno, '20240123');
    assert.equal(body.created_by, 'actor-1');
    assert.equal(fakes.calls.studentCreate[0].createdBy, 'actor-1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an attached guard rejects the request before the use case runs (STU-005)', async () => {
  class AdminGuard extends Guard {
    async authorize() {
      throw new UnauthorizedError();
    }
  }

  const fakes = createFakes();
  const server = buildApp(fakes, { guard: new AdminGuard() }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${url}/students`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    assert.equal(res.status, 401);
    assert.equal(fakes.calls.studentCreate.length, 0);
    assert.equal(fakes.calls.userCreate.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});