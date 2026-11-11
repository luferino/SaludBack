import test from 'node:test';
import assert from 'node:assert/strict';
import { PgRoleGrantRepository } from '../../src/modules/auth/infrastructure/repositories/pg-role-grant.repository.ts';

const STUDENT = '40000000-0000-4000-8000-000000000002';
const ACTOR = '40000000-0000-4000-8000-000000000001';
const GRANT = '50000000-0000-4000-8000-000000000001';
const row = (overrides = {}) => ({ id: GRANT, user_id: STUDENT, role: 'reception', granted_by: ACTOR,
  granted_at: '2026-06-01T12:00:00Z', revoked_by: null, revoked_at: null, ...overrides });

test('candidate query is Student-only, literal substring, and deterministically paginated', async () => {
  let seen;
  const repo = new PgRoleGrantRepository({ async query(sql, params) { seen = { sql, params }; return { rows: [{ id: STUDENT, username: 'STUDENT1', email: null }] }; } });
  assert.deepEqual(await repo.searchStudentCandidates({ q: '%_', limit: 20, offset: 5 }), [{ id: STUDENT, username: 'STUDENT1', email: null }]);
  assert.match(seen.sql, /role IN \('estudiante', 'student'\)/);
  assert.match(seen.sql, /strpos\(lower\(username\), lower\(\$1\)\)/);
  assert.match(seen.sql, /ORDER BY username, id LIMIT \$2 OFFSET \$3/);
  assert.deepEqual(seen.params, ['%_', 20, 5]);
});

test('grant transaction locks Student user before inserting audited Reception period and translates active conflict', async () => {
  const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: STUDENT }] };
    if (sql.includes('INSERT INTO user_role_grants')) return { rows: [row()] };
    return { rows: [] };
  }, release() { calls.push({ sql: 'RELEASE' }); } };
  const repo = new PgRoleGrantRepository({ connect: async () => client });
  assert.deepEqual(await repo.grantReceptionRole(STUDENT, ACTOR), {
    id: GRANT, userId: STUDENT, role: 'reception', grantedBy: ACTOR, grantedAt: '2026-06-01T12:00:00Z', revokedBy: null, revokedAt: null,
  });
  assert.match(calls[1].sql, /FROM users WHERE id=\$1 AND role IN .*FOR UPDATE/);
  assert.match(calls[2].sql, /INSERT INTO user_role_grants/);
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');

  const duplicate = new PgRoleGrantRepository({ connect: async () => ({
    async query(sql) {
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: STUDENT }] };
      if (sql.includes('INSERT INTO user_role_grants')) throw Object.assign(new Error('duplicate'), { code: '23505', constraint: 'user_role_grants_one_active' });
      return { rows: [] };
    }, release() {},
  }) });
  await assert.rejects(duplicate.grantReceptionRole(STUDENT, ACTOR), { statusCode: 409, code: 'CONFLICT' });
});

test('first exact grant revoke locks user then grant, revokes careers atomically; replay does not touch later careers', async () => {
  let active = true;
  const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('SELECT user_id FROM user_role_grants')) return { rows: [{ user_id: STUDENT }] };
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: STUDENT }] };
    if (sql.includes('SELECT id, user_id, role, granted_by')) return { rows: [row(active ? {} : { revoked_by: ACTOR, revoked_at: '2026-06-02T12:00:00Z' })] };
    if (sql.includes('UPDATE user_role_grants')) { active = false; return { rows: [row({ revoked_by: ACTOR, revoked_at: '2026-06-02T12:00:00Z' })] }; }
    return { rows: [] };
  }, release() {} };
  const repo = new PgRoleGrantRepository({ connect: async () => client });
  assert.equal((await repo.revokeReceptionRoleGrant(GRANT, ACTOR)).revokedBy, ACTOR);
  const firstCareerRevoke = calls.findIndex(call => call.sql.includes('UPDATE reception_career_grants'));
  const userLock = calls.findIndex(call => call.sql.includes('SELECT id FROM users'));
  const roleLock = calls.findIndex(call => call.sql.includes('FOR UPDATE') && call.sql.includes('user_role_grants'));
  assert.ok(userLock < roleLock && roleLock < firstCareerRevoke);
  calls.length = 0;
  await repo.revokeReceptionRoleGrant(GRANT, ACTOR);
  assert.equal(calls.some(call => call.sql.includes('UPDATE reception_career_grants')), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('migration creates additive audited periods and does not seed permissions or rewrite primary roles', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync('src/db/migrations/048_create_user_role_grants.sql', 'utf8');
  assert.match(sql, /CREATE TABLE user_role_grants/);
  assert.match(sql, /role TEXT NOT NULL CHECK \(role = 'reception'\)/);
  assert.match(sql, /granted_by UUID NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /revoked_by UUID REFERENCES users\(id\)/);
  assert.match(sql, /WHERE revoked_at IS NULL/);
  assert.doesNotMatch(sql, /INSERT INTO permissions|INSERT INTO role_permissions|UPDATE users SET role/i);
});
