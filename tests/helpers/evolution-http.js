import { createServer } from 'node:http';

export const evolutionActor = '30000000-0000-4000-8000-000000000001';
export const evolutionPatient = '70000000-0000-4000-8000-000000000001';
export const evolutionSubject = '10000000-0000-4000-8000-000000000001';
export const evolutionGroup = '20000000-0000-4000-8000-000000000001';
export const evolutionGrants = ['kinesiology-evolutions:read', 'kinesiology-evolutions:write', 'kinesiology-evolutions:submit', 'kinesiology-evaluations:read'];

Object.assign(process.env, {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect', JWT_SECRET: 'synthetic-evolutions-secret',
  CLIENT_URL: 'http://127.0.0.1:1', JWT_SECRET_KID: 'evolutions-test-key', JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h', BCRYPT_COST: '4', RESET_TOKEN_TTL: '15', RESET_TOKEN_MAX_OUTSTANDING: '3',
});

const [{ createApp }, { JwtTokenService }] = await Promise.all([
  import('../../src/app.ts'),
  import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
]);

export async function withEvolutionServer(pool, run) {
  const server = createServer(createApp(pool));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const tokens = new JwtTokenService({ secret: process.env.JWT_SECRET, secretKid: process.env.JWT_SECRET_KID, previousSecrets: [], expiresIn: '1h' });
  try { await run(`http://127.0.0.1:${server.address().port}`, tokens); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
