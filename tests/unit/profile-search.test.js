import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createStudentRouter } from '../../src/modules/students/infrastructure/routes/student.routes.ts';
import { createTeacherRouter } from '../../src/modules/teachers/infrastructure/routes/teacher.routes.ts';
import { PgStudentRepository } from '../../src/modules/students/infrastructure/repositories/pg-student.repository.ts';
import { PgTeacherRepository } from '../../src/modules/teachers/infrastructure/repositories/pg-teacher.repository.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';

for (const [kind, router, Repository, fields] of [
  ['students', createStudentRouter, PgStudentRepository, ['nombres', 'apellidos', 'codalumno']],
  ['teachers', createTeacherRouter, PgTeacherRepository, ['nombres', 'apellidos']],
]) {
  test(`${kind}: HTTP search is trimmed, paginated, literal and permission-protected`, async () => {
    const queries = [];
    const item = { id: 'profile-1', nombres: 'Ana', apellidos: 'Lopez', ...(kind === 'students' ? { codalumno: 'ABC' } : {}) };
    const repository = new Repository({ async query(sql, params) { queries.push({ sql, params }); return { rows: [item] }; } });
    const app = express();
    app.set('query parser', 'extended');
    app.use((req, _res, next) => {
      if (req.headers.authorization) req.auth = { permissions: [`${kind}:read`] };
      next();
    });
    app.use(`/${kind}`, router({ repository, userRepository: {}, hasher: {}, unitOfWork: {} }));
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/${kind}`;
    const get = async (query, authorized = true) => {
      const res = await fetch(url + query, { headers: authorized ? { authorization: 'test' } : {} });
      return { status: res.status, body: await res.json() };
    };
    try {
      const result = await get('?q=%20An%25_%5C%20&limit=2&offset=3');
      assert.deepEqual(result, { status: 200, body: { items: [item], limit: 2, offset: 3 } });
      assert.equal(queries.length, 1);
      assert.deepEqual(queries[0].params, [2, 3, '%An\\%\\_\\\\%']);
      for (const field of fields) assert.ok(queries[0].sql.includes(`${field} ILIKE $3`));
      assert.match(queries[0].sql, /ORDER BY apellidos ASC, nombres ASC, id ASC LIMIT \$1 OFFSET \$2/);
      assert.ok(!queries[0].sql.includes('An%'));
      for (const query of ['?q=', '?q=%20%20', '']) {
        assert.equal((await get(query)).status, 200);
        assert.deepEqual(queries.at(-1).params, [50, 0]);
        assert.ok(!queries.at(-1).sql.includes('WHERE'));
      }
      assert.equal((await get('?q=' + 'a'.repeat(100))).status, 200);
      const before = queries.length;
      for (const query of ['?q=' + 'a'.repeat(101), '?q=a&q=b', '?q[x]=a']) {
        const invalid = await get(query);
        assert.equal(invalid.status, 400, query);
        assert.equal(invalid.body.error.code, 'BAD_REQUEST');
        assert.equal(invalid.body.error.message, 'q must be a string of at most 100 characters');
      }
      assert.equal(queries.length, before, 'invalid search must not query or mutate data');
      assert.equal((await get('?q=Ana', false)).status, 401);
      assert.equal(queries.length, before, 'unauthorized search must not query data');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
}
