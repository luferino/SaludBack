import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RequestPasswordReset } from '../../src/modules/auth/application/request-password-reset.js';
import { User } from '../../src/modules/auth/domain/user.js';
import { BadRequestError } from '../../src/modules/shared/domain/errors.js';

const GENERIC_BODY = { message: 'If the account exists, a password reset link has been sent' };
const CLIENT_URL = 'https://app.example.com/reset';
const TTL_MINUTES = 15;

function createFakes({ user = null } = {}) {
  const calls = { findByUsername: [], create: [], sendMail: [] };
  const repository = {
    async findByUsername(username) {
      calls.findByUsername.push(username);
      return user;
    },
  };
  const resetTokenRepository = {
    async create(params) {
      calls.create.push(params);
      return { id: 'token-uuid', ...params };
    },
  };
  const mailer = {
    async sendMail(message) {
      calls.sendMail.push(message);
    },
  };
  return { repository, resetTokenRepository, mailer, calls };
}

function buildUseCase(fakes) {
  return new RequestPasswordReset({
    ...fakes,
    clientUrl: CLIENT_URL,
    resetTokenTtl: TTL_MINUTES,
  });
}

const USER_WITH_EMAIL = new User({
  id: 'uuid-1',
  username: 'jperez',
  passwordHash: 'x',
  role: 'estudiante',
  email: 'jperez@example.com',
});

test('user with email gets a token and a mailed link; body is the generic success', async () => {
  const fakes = createFakes({ user: USER_WITH_EMAIL });
  const useCase = buildUseCase(fakes);

  const result = await useCase.execute({ username: 'jperez' });

  assert.deepEqual(result, GENERIC_BODY);
  assert.equal(fakes.calls.findByUsername[0], 'jperez');
  assert.equal(fakes.calls.create.length, 1);
  assert.equal(fakes.calls.sendMail.length, 1);
  assert.equal(fakes.calls.sendMail[0].to, 'jperez@example.com');
});

test('unknown username returns identical body with no token and no mail', async () => {
  const fakes = createFakes({ user: null });
  const useCase = buildUseCase(fakes);

  const result = await useCase.execute({ username: 'ghost' });

  assert.deepEqual(result, GENERIC_BODY);
  assert.equal(fakes.calls.create.length, 0);
  assert.equal(fakes.calls.sendMail.length, 0);
});

test('user without email returns identical body with no token and no mail', async () => {
  const emailLess = new User({ id: 'uuid-2', username: 'legacy', passwordHash: 'x', role: 'estudiante' });
  const fakes = createFakes({ user: emailLess });
  const useCase = buildUseCase(fakes);

  const result = await useCase.execute({ username: 'legacy' });

  assert.deepEqual(result, GENERIC_BODY);
  assert.equal(fakes.calls.create.length, 0);
  assert.equal(fakes.calls.sendMail.length, 0);
});

test('identical body across all three outcomes', async () => {
  const emailLess = new User({ id: 'uuid-2', username: 'legacy', passwordHash: 'x', role: 'estudiante' });

  const bodyWithEmail = await buildUseCase(createFakes({ user: USER_WITH_EMAIL })).execute({ username: 'jperez' });
  const bodyUnknown = await buildUseCase(createFakes({ user: null })).execute({ username: 'ghost' });
  const bodyNoEmail = await buildUseCase(createFakes({ user: emailLess })).execute({ username: 'legacy' });

  assert.deepEqual(bodyWithEmail, bodyUnknown);
  assert.deepEqual(bodyUnknown, bodyNoEmail);
});

test('hash at rest: the stored token hash is the sha256 of the raw token in the mailed link', async () => {
  const fakes = createFakes({ user: USER_WITH_EMAIL });
  const useCase = buildUseCase(fakes);

  await useCase.execute({ username: 'jperez' });

  const rawToken = new URL(fakes.calls.sendMail[0].text).searchParams.get('token');
  const expectedHash = createHash('sha256').update(rawToken).digest('hex');
  assert.equal(fakes.calls.create[0].tokenHash, expectedHash);
  assert.notEqual(fakes.calls.create[0].tokenHash, rawToken);
});

test('link shape is {clientUrl}?token=<raw 32-byte token>', async () => {
  const fakes = createFakes({ user: USER_WITH_EMAIL });
  const useCase = buildUseCase(fakes);

  await useCase.execute({ username: 'jperez' });

  const link = fakes.calls.sendMail[0].text;
  assert.ok(link.startsWith(`${CLIENT_URL}?token=`));
  const rawToken = link.slice(`${CLIENT_URL}?token=`.length);
  assert.equal(rawToken.length, 64); // 32 random bytes hex-encoded
});

test('issued token carries the userId and an expiring expiresAt', async () => {
  const fakes = createFakes({ user: USER_WITH_EMAIL });
  const useCase = buildUseCase(fakes);

  const before = Date.now();
  await useCase.execute({ username: 'jperez' });

  const created = fakes.calls.create[0];
  assert.equal(created.userId, 'uuid-1');
  const expiresAt = new Date(created.expiresAt).getTime();
  assert.ok(expiresAt >= before + TTL_MINUTES * 60_000);
  assert.ok(expiresAt <= Date.now() + TTL_MINUTES * 60_000);
});

test('missing or empty username throws BadRequestError without touching ports', async () => {
  const fakes = createFakes();
  const useCase = buildUseCase(fakes);

  await assert.rejects(() => useCase.execute({}), BadRequestError);
  await assert.rejects(() => useCase.execute({ username: '   ' }), BadRequestError);
  assert.equal(fakes.calls.findByUsername.length, 0);
});
