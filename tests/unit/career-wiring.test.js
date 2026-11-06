import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const SYNTHETIC_CONFIG = {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect',
  JWT_SECRET: 'synthetic-career-wiring-secret-that-is-not-used-outside-tests',
  CLIENT_URL: 'http://127.0.0.1:1',
  JWT_SECRET_KID: 'test-key',
  JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h',
  BCRYPT_COST: '4',
  RESET_TOKEN_TTL: '15',
  RESET_TOKEN_MAX_OUTSTANDING: '3',
};
Object.assign(process.env, SYNTHETIC_CONFIG);

const [{ createApp }, { JwtTokenService }] = await Promise.all([
  import('../../src/app.ts'),
  import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
]);

const careerRows = [
  { id: 'career-1', code: 'kinesiology', name: 'Kinesiología' },
  { id: 'career-2', code: 'odontology', name: 'Odontología' },
];

async function withApp(run, { grants = {}, failPermissionRead = false } = {}) {
  let fail = failPermissionRead;
  const queries = [];
  const pool = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes('FROM role_permissions')) {
        if (fail) throw new Error('permission reader unavailable');
        return { rows: (grants[params[0]] ?? []).map((permission) => ({ permission })) };
      }
      if (text.includes('FROM careers')) return { rows: careerRows };
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  const app = createApp(pool);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const service = new JwtTokenService({ secret: SYNTHETIC_CONFIG.JWT_SECRET, secretKid: 'test-key', previousSecrets: [], expiresIn: '1h' });
  try {
    await run(`http://127.0.0.1:${server.address().port}`, service, queries, (value) => { fail = value; });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function token(service, role, sub, permissions = []) {
  return service.sign({ role, sub, permissions });
}

function auth(tokenValue) { return { authorization: `Bearer ${tokenValue}` }; }

test('production wiring serves GET /careers only to fresh careers:read grants', async () => {
  const grants = { reader: ['careers:read'], subjectReader: ['subjects:read'] };
  await withApp(async (base, service, queries) => {
    const reader = await token(service, 'reader', 'reader-1', []);
    const read = await fetch(`${base}/careers`, { headers: auth(reader) });
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { items: careerRows });

    const subjectReader = await token(service, 'subjectReader', 'subject-reader-1', ['careers:read']);
    assert.equal((await fetch(`${base}/careers`, { headers: auth(subjectReader) })).status, 403, 'subjects:read does not imply careers:read');
    assert.equal(queries.filter(({ text }) => text.includes('FROM careers')).length, 1);
  }, { grants });
});

test('missing bearer token never reaches the permission query or careers table', async () => {
  await withApp(async (base, _service, queries) => {
    assert.equal((await fetch(`${base}/careers`)).status, 401);
    assert.equal(queries.length, 0);
  });
});

test('fresh permission reader failures propagate through production error handling', async () => {
  await withApp(async (base, service, queries) => {
    const reader = await token(service, 'reader', 'reader-1', []);
    const response = await fetch(`${base}/careers`, { headers: auth(reader) });
    assert.equal(response.status, 500);
    assert.equal(queries.length, 1);
  }, { failPermissionRead: true });
});
