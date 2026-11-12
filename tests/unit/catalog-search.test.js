import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSubjectRouter } from '../../src/modules/subjects/infrastructure/routes/subject.routes.ts';
import { createGroupRouter } from '../../src/modules/groups/infrastructure/routes/group.routes.ts';
import { PgSubjectRepository } from '../../src/modules/subjects/infrastructure/repositories/pg-subject.repository.ts';
import { PgGroupRepository } from '../../src/modules/groups/infrastructure/repositories/pg-group.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

const CAREER = '11111111-1111-4111-8111-111111111111';
for (const [kind, router, Repository, order] of [
  ['subjects', createSubjectRouter, PgSubjectRepository, 'name ASC, id ASC'],
  ['groups', createGroupRouter, PgGroupRepository, 'academic_year ASC, curriculum_semester ASC, name ASC, id ASC'],
]) {
  test(`${kind}: name search intersects career before pagination and preserves legacy reads`, async () => {
    const queries = [];
    const item = { id: 'item-1', name: 'Anatomy', career_id: CAREER, created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
      ...(kind === 'groups' ? { academic_year: 2026, curriculum_semester: 1 } : {}) };
    const repository = new Repository({ async query(sql, params) {
      queries.push({ sql, params }); return { rows: [item] };
    } });
    const app = express();
    app.set('query parser', 'extended');
    app.use((req, _res, next) => {
      if (req.headers.authorization) req.auth = { permissions: [req.headers.authorization] };
      next();
    });
    app.use('/' + kind, router({ repository }));
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const get = async (query, permission = kind + ':read') => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/${kind}` + query,
        { headers: permission ? { authorization: permission } : {} });
      return { status: res.status, body: await res.json() };
    };
    try {
      assert.deepEqual(await get('?career_id=' + CAREER + '&q=%20An%25_%5C%20&limit=2&offset=3'),
        { status: 200, body: { items: [item], limit: 2, offset: 3 } });
      assert.deepEqual(queries[0].params, [CAREER, '%An\\%\\_\\\\%', 2, 3]);
      assert.match(queries[0].sql, /WHERE career_id = \$1 AND name ILIKE \$2/);
      assert.ok(queries[0].sql.includes('ORDER BY ' + order));
      assert.match(queries[0].sql, /LIMIT \$3 OFFSET \$4/);
      assert.ok(!queries[0].sql.includes('An%'));
      assert.equal((await get('?q=an')).status, 200);
      assert.deepEqual(queries.at(-1).params, ['%an%', 50, 0]);
      assert.match(queries.at(-1).sql, /WHERE name ILIKE \$1/);
      for (const q of ['', '?q=', '?q=%20%20']) {
        assert.deepEqual(await get(q), { status: 200, body: { items: [item], limit: 50, offset: 0 } });
        assert.deepEqual(queries.at(-1).params, [50, 0]);
        assert.ok(!queries.at(-1).sql.includes('WHERE'));
      }
      assert.equal((await get('?career_id=' + CAREER + '&limit=7&offset=9')).status, 200);
      assert.deepEqual(queries.at(-1).params, [CAREER, 7, 9]);
      assert.match(queries.at(-1).sql, /WHERE career_id = \$1\s+ORDER BY/);
      assert.equal((await get('?q=' + 'a'.repeat(100))).status, 200);
      const before = queries.length;
      for (const q of ['?q=' + 'a'.repeat(101), '?q=a&q=b', '?q[x]=a']) {
        assert.deepEqual(await get(q), { status: 400, body: { error: {
          code: 'BAD_REQUEST', message: 'q must be a string of at most 100 characters' } } });
      }
      assert.equal((await get('?q=an&career_id=invalid')).status, 400);
      assert.equal((await get('?q=an&limit=0')).status, 400);
      assert.equal((await get('?q=an', '')).status, 401);
      assert.equal((await get('?q=an', kind + ':write')).status, 403);
      assert.equal(queries.length, before, 'rejections must not query or mutate data');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
}
