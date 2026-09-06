import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/services/jwt-token.service.ts';
import { ROLE_PERMISSIONS } from '../../src/modules/auth/domain/permissions.ts';

const SECRET = 'unit-test-secret';
const service = new JwtTokenService({ secret: SECRET, expiresIn: '2h' });

const CLAIMS = {
  sub: 'uuid-1',
  username: 'jperez',
  role: 'estudiante',
  permissions: ROLE_PERMISSIONS.estudiante,
};

test('sign returns a token carrying the full claims contract', async () => {
  const token = await service.sign(CLAIMS);
  const decoded = jwt.decode(token);

  assert.equal(decoded.sub, 'uuid-1');
  assert.equal(decoded.username, 'jperez');
  assert.equal(decoded.role, 'estudiante');
  assert.deepEqual(decoded.permissions, ROLE_PERMISSIONS.estudiante);
});

test('token carries iss, aud, iat and a future exp', async () => {
  const token = await service.sign(CLAIMS);
  const decoded = jwt.decode(token);

  assert.equal(decoded.iss, 'SaludBack');
  assert.equal(decoded.aud, 'SaludBack-api');
  assert.ok(decoded.iat > 0);
  assert.ok(decoded.exp > decoded.iat);
});

test('token never carries the password hash', async () => {
  const token = await service.sign(CLAIMS);
  const decoded = jwt.decode(token);
  assert.equal(decoded.passwordHash, undefined);
  assert.equal(Object.hasOwn(decoded, 'password_hash'), false);
});

test('verify returns the decoded claims for a valid token', async () => {
  const token = await service.sign(CLAIMS);
  const decoded = await service.verify(token);
  assert.equal(decoded.sub, 'uuid-1');
  assert.equal(decoded.role, 'estudiante');
});

test('verify rejects an expired token', async () => {
  const expired = await new JwtTokenService({ secret: SECRET, expiresIn: -1 }).sign(CLAIMS);
  await assert.rejects(() => service.verify(expired), { name: 'TokenExpiredError' });
});

test('verify rejects a token signed with a different secret', async () => {
  const foreign = await new JwtTokenService({ secret: 'other-secret' }).sign(CLAIMS);
  await assert.rejects(() => service.verify(foreign), { name: 'JsonWebTokenError' });
});

test('verify rejects a token with a different audience', async () => {
  const otherAudience = await new JwtTokenService({
    secret: SECRET,
    audience: 'other-api',
  }).sign(CLAIMS);
  await assert.rejects(() => service.verify(otherAudience), { name: 'JsonWebTokenError' });
});

// --- kid rotation tests ---

test('sign stamps the kid header', async () => {
  const rotateService = new JwtTokenService({
    secret: SECRET,
    secretKid: '2026-09',
    expiresIn: '2h',
  });
  const token = await rotateService.sign(CLAIMS);
  const decoded = jwt.decode(token, { complete: true });
  assert.equal(decoded.header.kid, '2026-09');
});

test('verify accepts a token signed with a previous secret by kid', async () => {
  const previousSecret = 'old-secret';
  const rotateService = new JwtTokenService({
    secret: SECRET,
    secretKid: '2026-09',
    previousSecrets: [{ kid: '2026-08', secret: previousSecret }],
    expiresIn: '2h',
  });
  // Sign with the old secret + old kid.
  const oldService = new JwtTokenService({
    secret: previousSecret,
    secretKid: '2026-08',
    expiresIn: '2h',
  });
  const token = await oldService.sign(CLAIMS);
  const decoded = await rotateService.verify(token);
  assert.equal(decoded.sub, 'uuid-1');
  assert.equal(decoded.role, 'estudiante');
});

test('verify rejects a token with an unknown kid', async () => {
  const rogueService = new JwtTokenService({
    secret: 'rogue-secret',
    secretKid: 'rogue',
    expiresIn: '2h',
  });
  const token = await rogueService.sign(CLAIMS);
  const rotateService = new JwtTokenService({
    secret: SECRET,
    secretKid: '2026-09',
    expiresIn: '2h',
  });
  await assert.rejects(() => rotateService.verify(token), { name: 'JsonWebTokenError' });
});

test('verify rejects a token that claims a known kid but uses a wrong secret', async () => {
  const wrongService = new JwtTokenService({
    secret: 'wrong',
    secretKid: '2026-09',
    expiresIn: '2h',
  });
  const token = await wrongService.sign(CLAIMS);
  const rotateService = new JwtTokenService({
    secret: SECRET,
    secretKid: '2026-09',
    expiresIn: '2h',
  });
  await assert.rejects(() => rotateService.verify(token), { name: 'JsonWebTokenError' });
});

test('legacy token without kid verifies against the current secret', async () => {
  // Mint a token WITHOUT any kid header — simulates tokens from before this change.
  const legacyToken = jwt.sign(CLAIMS, SECRET, {
    expiresIn: '2h',
    issuer: 'SaludBack',
    audience: 'SaludBack-api',
  });
  const decoded = await service.verify(legacyToken);
  assert.equal(decoded.sub, 'uuid-1');
  assert.equal(decoded.role, 'estudiante');
});
