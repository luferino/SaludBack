import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mountAuthRoutes } from '../../src/bootstrap/routes/auth.routes.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

test('Reception mounting preserves unmatched auth routes without authenticating them', async () => {
  let reads = 0;
  const app = express();
  mountAuthRoutes(app, {
    repository: {}, resetTokenRepository: {}, mailer: {}, hasher: {},
    tokenService: { async verify() { throw new Error('invalid'); } },
    matrixReader: { async permissionsForRole() { reads++; return []; } },
    receptionRepository: {}, clientUrl: 'http://localhost', resetTokenTtl: 60,
  });
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/auth/missing', '/auth/accounts/not-a-uuid/missing', '/reception/missing']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'not found' });
    }
    assert.equal(reads, 0);
    const protectedResponse = await fetch(base + '/auth/accounts', { method: 'POST' });
    assert.equal(protectedResponse.status, 401);
    assert.deepEqual(await protectedResponse.json(), { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
