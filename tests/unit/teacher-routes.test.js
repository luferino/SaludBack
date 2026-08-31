import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTeacherRouter, defaultGetActor } from '../../src/modules/teachers/infrastructure/routes/teacher.routes.ts';
import { Teacher } from '../../src/modules/teachers/domain/teacher.entity.ts';
import { User } from '../../src/modules/auth/domain/user.entity.ts';
import { Guard } from '../../src/modules/shared/application/guard.ts';
import { UnauthorizedError } from '../../src/modules/shared/domain/errors.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const CONTRACT_KEYS = ['id', 'nombres', 'apellidos', 'email', 'celular', 'created_by', 'created_at'];

const VALID_PAYLOAD = {
  username: 'mruiz',
  password: 'secret123',
  nombres: 'Maria',
  apellidos: 'Ruiz',
  email: 'mruiz@mail.com',
  celular: '+5491100000000',
};

function createFakes() {
  const calls = { teacherCreate: [], userCreate: [] };
  return {
    calls,
    teacherRepository: {
      async create(teacher, client) {
        calls.teacherCreate.push({ ...teacher, client });
        return new Teacher({
          ...teacher,
          id: 'uuid-teacher',
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
    '/teachers',
    createTeacherRouter({
      repository: fakes.teacherRepository,
      userRepository: fakes.userRepository,
      hasher: fakes.hasher,
      unitOfWork: fakes.unitOfWork,
      ...overrides,
    }),
  );
  app.use(errorHandler);
  return app;
}

test('defaultGetActor prefers the req.auth.userId alias over sub (TEA-004)', async () => {
  const req = { auth: { role: 'teacher', permissions: [], userId: 'uuid-user', sub: 'uuid-sub' } };
  assert.equal(await defaultGetActor(req), 'uuid-user');
});

test('defaultGetActor falls back to req.auth.sub when userId is absent (TEA-004)', async () => {
  const req = { auth: { role: 'teacher', permissions: [], sub: 'uuid-sub' } };
  assert.equal(await defaultGetActor(req), 'uuid-sub');
});

test('defaultGetActor resolves null when req.auth is unset or has no subject (TEA-004)', async () => {
  assert.equal(await defaultGetActor({}), null);
  assert.equal(await defaultGetActor({ auth: {} }), null);
});

test('POST /teachers returns the 7-key TEA-003 contract and attributes created_by via the actor hook', async () => {
  const fakes = createFakes();
  const server = buildApp(fakes, { getActor: async () => 'actor-1' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${url}/teachers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), CONTRACT_KEYS.sort());
    assert.equal(body.nombres, 'Maria');
    assert.equal(body.apellidos, 'Ruiz');
    assert.equal(body.created_by, 'actor-1');
    assert.equal(fakes.calls.teacherCreate[0].createdBy, 'actor-1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an attached guard rejects the request before the use case runs (TEA-004)', async () => {
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
    const res = await fetch(`${url}/teachers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    assert.equal(res.status, 401);
    assert.equal(fakes.calls.teacherCreate.length, 0);
    assert.equal(fakes.calls.userCreate.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});