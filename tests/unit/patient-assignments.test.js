import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://synthetic.invalid/never-connect', JWT_SECRET: 'synthetic-assignment-secret',
  CLIENT_URL: 'http://127.0.0.1:1', JWT_SECRET_KID: 'assignment-test-key', JWT_PREVIOUS_SECRETS: '[]',
  JWT_EXPIRES_IN: '1h', BCRYPT_COST: '4', RESET_TOKEN_TTL: '15', RESET_TOKEN_MAX_OUTSTANDING: '3',
});
const [{ createApp }, { JwtTokenService }] = await Promise.all([
  import('../../src/app.ts'),
  import('../../src/modules/auth/infrastructure/services/jwt-token.service.ts'),
]);

const USERS = {
  teacher: '40000000-0000-4000-8000-000000000001',
  teacher2: '40000000-0000-4000-8000-000000000002',
  student: '30000000-0000-4000-8000-000000000001',
  student2: '30000000-0000-4000-8000-000000000002',
  admin: '40000000-0000-4000-8000-000000000003',
};
const IDS = {
  teacher: '50000000-0000-4000-8000-000000000001',
  teacher2: '50000000-0000-4000-8000-000000000002',
  student: '30000000-0000-4000-8000-000000000011',
  student2: '30000000-0000-4000-8000-000000000012',
  subject: '10000000-0000-4000-8000-000000000001',
  subject2: '10000000-0000-4000-8000-000000000002',
  group: '20000000-0000-4000-8000-000000000001',
  group2: '20000000-0000-4000-8000-000000000002',
  period: '60000000-0000-4000-8000-000000000001',
  period2: '60000000-0000-4000-8000-000000000002',
  period3: '60000000-0000-4000-8000-000000000003',
  period4: '60000000-0000-4000-8000-000000000004',
  patient: '70000000-0000-4000-8000-000000000001',
  patient2: '70000000-0000-4000-8000-000000000002',
  context: '80000000-0000-4000-8000-000000000001',
};
const teacherGrants = ['patient-assignments:write', 'patient-assignments:read'];
const ownGrants = ['patient-assignments:read-own'];
const makeAssignment = (overrides = {}) => ({
  id: '9007199254740993', patient_id: IDS.patient, student_habilitation_id: IDS.period,
  subject_id: IDS.subject, academic_group_id: IDS.group, assigned_by: USERS.teacher,
  assigned_at: new Date('2026-01-02T03:04:05Z'), ended_by: null, ended_at: null,
  end_reason: null, ...overrides,
});

function fakePool({ grants, profiles, contexts, periods, patients, assignments = [], failInsert = false } = {}) {
  const state = {
    grants: grants ?? new Map([['teacher', teacherGrants], ['estudiante', ownGrants], ['admin', []]]),
    profiles: profiles ?? new Map([[USERS.teacher, IDS.teacher], [USERS.teacher2, IDS.teacher2]]),
    contexts: contexts ?? [
      { teacher: IDS.teacher, subject: IDS.subject, group: IDS.group, revoked: false },
      { teacher: IDS.teacher2, subject: IDS.subject2, group: IDS.group2, revoked: false },
      { teacher: IDS.teacher2, subject: IDS.subject, group: IDS.group2, revoked: false },
    ],
    periods: periods ?? [
      { id: IDS.period, student: IDS.student, subject: IDS.subject, group: IDS.group, revoked: false },
      { id: IDS.period2, student: IDS.student2, subject: IDS.subject2, group: IDS.group2, revoked: false },
      { id: IDS.period3, student: IDS.student2, subject: IDS.subject, group: IDS.group2, revoked: false },
      { id: IDS.period4, student: IDS.student, subject: IDS.subject, group: IDS.group, revoked: true },
    ],
    patients: patients ?? [IDS.patient, IDS.patient2], assignments: [...assignments], queries: [], releases: 0,
    commits: 0, rollbacks: 0, failInsert,
  };
  async function query(sql, params = [], transactional = false) {
    state.queries.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
      if (sql === 'COMMIT') state.commits++;
      if (sql === 'ROLLBACK') state.rollbacks++;
      return { rows: [] };
    }
    if (sql.includes('FROM role_permissions')) return { rows: (state.grants.get(params[0]) ?? []).map(permission => ({ permission })) };
    if (sql.includes('FROM teachers WHERE user_id')) {
      const id = state.profiles.get(params[0]);
      return { rows: id ? [{ id }] : [] };
    }
    if (sql.includes('FROM teacher_academic_habilitations')) {
      const [teacher, subject, group] = params;
      return { rows: state.contexts.filter(row => row.teacher === teacher && row.subject === subject && row.group === group && !row.revoked).map(row => ({ id: IDS.context })) };
    }
    if (sql.includes('FROM student_academic_habilitations')) {
      const [id, subject, group] = params;
      return { rows: state.periods.filter(row => row.id === id && row.subject === subject && row.group === group && !row.revoked).map(row => ({ id: row.id, student_id: row.student, subject_id: row.subject, academic_group_id: row.group })) };
    }
    if (sql.includes('FROM patients WHERE id')) return { rows: state.patients.includes(params[0]) ? [{ id: params[0] }] : [] };
    if (sql.includes('INSERT INTO patient_assignments')) {
      if (state.failInsert) throw new Error('synthetic insert failure');
      const [patient, period, subject, actor] = params;
      if (state.assignments.some(row => row.patient_id === patient && row.subject_id === subject && row.ended_at === null)) {
        const error = new Error('duplicate'); error.code = '23505'; error.constraint = 'patient_assignments_one_active_patient_subject'; throw error;
      }
      const matched = state.periods.find(row => row.id === period);
      const row = makeAssignment({ id: '9007199254740993', patient_id: patient, student_habilitation_id: period,
        subject_id: subject, academic_group_id: matched?.group, assigned_by: actor });
      state.assignments.push(row);
      return { rows: [{ ...row, academic_group_id: undefined }] };
    }
    if (sql.includes('FROM students WHERE user_id') && !sql.includes('FROM patient_assignments')) {
      const row = state.periods.find(period => period.student === params[0]);
      return { rows: row ? [{ id: row.student }] : [] };
    }
    if (sql.includes('FROM patient_assignments')) {
      const actor = params[0];
      let rows = state.assignments.filter(row => {
        const period = state.periods.find(item => item.id === row.student_habilitation_id);
        if (!period || period.revoked || row.ended_at !== null) return false;
        if (sql.includes('EXISTS (')) return state.contexts.some(ctx => ctx.teacher === state.profiles.get(actor) && ctx.subject === row.subject_id && ctx.group === period.group && !ctx.revoked);
        if (sql.includes('p.student_id =')) return period.student === (actor === USERS.student ? IDS.student : IDS.student2);
        return false;
      });
      rows = rows.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1).slice(params[2], params[2] + params[1]);
      return { rows: rows.map(row => ({ ...row, academic_group_id: state.periods.find(p => p.id === row.student_habilitation_id)?.group,
        nombres: row.patient_id === IDS.patient ? 'Ada' : 'Grace', apellidos: row.patient_id === IDS.patient ? 'Lovelace' : 'Hopper',
        documento: row.patient_id === IDS.patient ? 'DOC-1' : 'DOC-2' })) };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return { state, query, async connect() { return { query: (sql, params) => query(sql, params, true), release() { state.releases++; } }; } };
}

async function withServer(pool, run) {
  const server = createServer(createApp(pool));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const tokens = new JwtTokenService({ secret: process.env.JWT_SECRET, secretKid: process.env.JWT_SECRET_KID, previousSecrets: [], expiresIn: '1h' });
  try { await run(`http://127.0.0.1:${server.address().port}`, tokens); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
async function token(tokens, role = 'teacher', sub = USERS.teacher) {
  return tokens.sign({ role, ...(sub === null ? {} : { sub }), username: 'actor', permissions: ['patient-assignments:write', 'patient-assignments:read', 'patient-assignments:read-own'] });
}
async function call(base, auth, method, path, body) {
  return fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const validBody = () => ({ patient_id: IDS.patient, student_habilitation_id: IDS.period, subject_id: IDS.subject, academic_group_id: IDS.group });
const snapshot = state => JSON.stringify(state.assignments);
const expectedError = (code, message) => ({ error: { code, message } });

test('missing and malformed verified actor subjects return 401 before assignment mutation', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    for (const sub of [null, 'not-a-uuid']) {
      const response = await call(base, await token(tokens, 'teacher', sub), 'POST', '/patient-assignments', validBody());
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), expectedError('UNAUTHORIZED', 'A verified UUID actor is required'));
    }
  });
  assert.equal(pool.state.assignments.length, 0);
  assert.equal(pool.state.queries.some(({ sql }) => sql.includes('INSERT INTO patient_assignments')), false);
});

test('T2 create authenticates audit actor, preserves BIGINT and serializes only approved fields', async () => {
  const pool = fakePool();
  await withServer(pool, async (base, tokens) => {
    const response = await call(base, await token(tokens), 'POST', '/patient-assignments', { ...validBody(), actor_id: USERS.admin });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['academic_group_id', 'assigned_at', 'assigned_by', 'ended_at', 'ended_by', 'end_reason', 'id', 'patient_id', 'student_habilitation_id', 'subject_id'].sort());
    assert.equal(body.id, '9007199254740993');
    assert.equal(body.assigned_by, USERS.teacher);
    assert.equal(body.academic_group_id, IDS.group);
    assert.equal(body.patient_id, IDS.patient);
    assert.equal(Object.hasOwn(body, 'celular'), false);
    assert.equal(Object.hasOwn(body, 'clinical_record'), false);
  });
  assert.equal(pool.state.assignments.length, 1);
  assert.equal(pool.state.releases, 1);
});

test('fresh database permission grants gate creation and each list route independently', async () => {
  const grants = new Map([['teacher', ['patient-assignments:read']], ['estudiante', ownGrants], ['admin', []]]);
  const pool = fakePool({ grants });
  await withServer(pool, async (base, tokens) => {
    const teacherToken = await token(tokens);
    let response = await call(base, teacherToken, 'POST', '/patient-assignments', validBody());
    assert.equal(response.status, 403);
    grants.set('teacher', teacherGrants);
    response = await call(base, teacherToken, 'POST', '/patient-assignments', validBody());
    assert.equal(response.status, 201);
    grants.set('teacher', ['patient-assignments:read']);
    const before = snapshot(pool.state);
    response = await call(base, teacherToken, 'POST', '/patient-assignments', { ...validBody(), patient_id: IDS.patient2 });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), expectedError('FORBIDDEN', "Permission 'patient-assignments:write' required"));
    assert.equal(snapshot(pool.state), before);
    response = await call(base, await token(tokens, 'admin', USERS.admin), 'POST', '/patient-assignments', validBody());
    assert.equal(response.status, 403);
    response = await call(base, await token(tokens, 'estudiante', USERS.student), 'GET', '/patient-assignments');
    assert.equal(response.status, 403);
    response = await call(base, await token(tokens, 'teacher'), 'GET', '/patient-assignments/mine');
    assert.equal(response.status, 403);
  });
});

test('teacher list and own list apply distinct live context and membership scopes', async () => {
  const assignments = [
    makeAssignment(),
    makeAssignment({ id: '9007199254740994', patient_id: IDS.patient2, student_habilitation_id: IDS.period2, subject_id: IDS.subject2, academic_group_id: IDS.group2 }),
    makeAssignment({ id: '9007199254740995', patient_id: IDS.patient2, ended_at: new Date('2026-02-01T00:00:00Z') }),
    makeAssignment({ id: '9007199254740996', student_habilitation_id: IDS.period4, patient_id: IDS.patient2 }),
  ];
  const pool = fakePool({ assignments });
  await withServer(pool, async (base, tokens) => {
    let response = await call(base, await token(tokens), 'GET', '/patient-assignments');
    assert.deepEqual((await response.json()).items.map(row => row.id), ['9007199254740993']);
    response = await call(base, await token(tokens, 'estudiante', USERS.student), 'GET', '/patient-assignments/mine');
    assert.deepEqual((await response.json()).items.map(row => row.id), ['9007199254740993']);
    response = await call(base, await token(tokens, 'estudiante', USERS.student2), 'GET', '/patient-assignments/mine');
    assert.deepEqual((await response.json()).items.map(row => row.id), ['9007199254740994']);
    const teacherQuery = pool.state.queries.find(row => row.sql.includes('FROM patient_assignments') && row.sql.includes('EXISTS ('));
    assert.match(teacherQuery.sql, /teacher_academic_habilitations/);
    assert.match(teacherQuery.sql, /ORDER BY a\.id/);
    assert.doesNotMatch(teacherQuery.sql, /p\.student_id =/);
    const ownQuery = pool.state.queries.find(row => row.sql.includes('FROM patient_assignments') && row.sql.includes('p.student_id ='));
    assert.match(ownQuery.sql, /p\.student_id =/);
    assert.doesNotMatch(ownQuery.sql, /teacher_academic_habilitations/);
  });
});

test('body/query identity cannot broaden actor scope; missing or revoked profile/context is denied', async () => {
  const contexts = [{ teacher: IDS.teacher, subject: IDS.subject, group: IDS.group, revoked: true }];
  const pool = fakePool({ contexts });
  await withServer(pool, async (base, tokens) => {
    const before = snapshot(pool.state);
    const response = await call(base, await token(tokens), 'POST', `/patient-assignments?actor_id=${USERS.admin}`, { ...validBody(), actor_id: USERS.admin });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), expectedError('FORBIDDEN', 'an active teacher context is required'));
    assert.equal(snapshot(pool.state), before);
  });
  const missing = fakePool({ profiles: new Map() });
  await withServer(missing, async (base, tokens) => {
    const response = await call(base, await token(tokens), 'POST', '/patient-assignments', validBody());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), expectedError('FORBIDDEN', 'an active teacher context is required'));
    assert.equal(snapshot(missing.state), '[]');
  });
});

test('malformed UUIDs, missing patient/period and duplicate patient-subject reject without business mutation', async () => {
  const pool = fakePool({ assignments: [makeAssignment()], contexts: [
    { teacher: IDS.teacher, subject: IDS.subject, group: IDS.group, revoked: false },
    { teacher: IDS.teacher, subject: IDS.subject, group: IDS.group2, revoked: false },
  ] });
  await withServer(pool, async (base, tokens) => {
    const auth = await token(tokens);
    const initial = snapshot(pool.state);
    for (const [field, value] of [['patient_id', 'bad'], ['student_habilitation_id', 'bad'], ['subject_id', 'bad'], ['academic_group_id', 'bad']]) {
      const response = await call(base, auth, 'POST', '/patient-assignments', { ...validBody(), [field]: value });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), expectedError('BAD_REQUEST', `${field} must be a UUID`));
    }
    for (const body of [{ ...validBody(), patient_id: '70000000-0000-4000-8000-000000000009' }, { ...validBody(), student_habilitation_id: IDS.period2 }, { ...validBody(), student_habilitation_id: IDS.period4 }]) {
      const response = await call(base, auth, 'POST', '/patient-assignments', body);
      assert.equal(response.status, 404);
      const expected = body.patient_id === '70000000-0000-4000-8000-000000000009'
        ? expectedError('NOT_FOUND', 'patient was not found')
        : expectedError('NOT_FOUND', 'active matching student habilitation was not found');
      assert.deepEqual(await response.json(), expected);
    }
    const duplicateAcrossGroups = await call(base, auth, 'POST', '/patient-assignments', { ...validBody(), student_habilitation_id: IDS.period3, academic_group_id: IDS.group2 });
    assert.equal(duplicateAcrossGroups.status, 409);
    const duplicate = await call(base, auth, 'POST', '/patient-assignments', validBody());
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), expectedError('CONFLICT', 'patient already has an active assignment for this subject'));
    assert.equal(snapshot(pool.state), initial);
    assert.equal(pool.state.rollbacks, 5);
    assert.equal(pool.state.releases, 5);
    assert.equal(pool.state.commits, 0);
  });
});

test('pagination defaults and bounds reject malformed values without leaking rows', async () => {
  const pool = fakePool({ assignments: [makeAssignment()] });
  await withServer(pool, async (base, tokens) => {
    const auth = await token(tokens);
    let response = await call(base, auth, 'GET', '/patient-assignments');
    const page = await response.json();
    assert.equal(page.limit, 50);
    assert.equal(page.offset, 0);
    assert.deepEqual(page.items.map(row => row.id), ['9007199254740993']);
    assert.deepEqual(Object.keys(page.items[0]).sort(), ['academic_group_id', 'apellidos', 'assigned_at', 'assigned_by', 'documento', 'end_reason', 'ended_at', 'ended_by', 'id', 'nombres', 'patient_id', 'student_habilitation_id', 'subject_id'].sort());
    assert.equal(Object.hasOwn(page.items[0], 'celular'), false);
    response = await call(base, auth, 'GET', '/patient-assignments?limit=1&offset=1');
    const laterPage = await response.json();
    assert.equal(laterPage.limit, 1);
    assert.equal(laterPage.offset, 1);
    assert.deepEqual(laterPage.items, []);
    for (const [query, field, message] of [
      ['?limit=0', 'limit', 'limit must be between 1 and 100'],
      ['?limit=101', 'limit', 'limit must be between 1 and 100'],
      ['?limit=1&offset=-1', 'offset', 'offset must be an integer'],
      ['?limit=1&offset=9007199254740992', 'offset', 'offset must be an integer'],
      ['?limit=1&limit=2', 'limit', 'limit must be an integer'],
      ['?offset=1.2', 'offset', 'offset must be an integer'],
    ]) {
      response = await call(base, auth, 'GET', `/patient-assignments${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), expectedError('BAD_REQUEST', message));
    }
  });
});

test('insert failure rolls back and always releases its client', async () => {
  const pool = fakePool({ failInsert: true });
  await withServer(pool, async (base, tokens) => {
    const response = await call(base, await token(tokens), 'POST', '/patient-assignments', validBody());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), expectedError('INTERNAL_SERVER_ERROR', 'Internal server error'));
  });
  assert.equal(snapshot(pool.state), '[]');
  assert.equal(pool.state.rollbacks, 1);
  assert.equal(pool.state.releases, 1);
  assert.equal(pool.state.commits, 0);
});
