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
const ACTOR = '40000000-0000-4000-8000-000000000001';
const TARGET = '60000000-0000-4000-8000-000000000002';
const SUBJECT = '10000000-0000-4000-8000-000000000001';
const GROUP = '20000000-0000-4000-8000-000000000001';
const TARGET_GROUP = '20000000-0000-4000-8000-000000000002';
const PERIOD = '60000000-0000-4000-8000-000000000001';
const PATIENT = '70000000-0000-4000-8000-000000000001';
const ID = '9007199254740993';
const INITIAL = { id: ID, patient_id: PATIENT, student_habilitation_id: PERIOD, subject_id: SUBJECT,
  academic_group_id: GROUP, assigned_by: ACTOR, assigned_at: new Date('2026-01-01T00:00:00Z'), ended_by: null,
  ended_at: null, end_reason: null };
function fakePool({ writePermission = true, sourceContext = true, destinationContext = true, failReplacement = false, initiallyEnded = false } = {}) {
  const state = { assignment: { ...INITIAL, ...(initiallyEnded ? { ended_by: ACTOR, ended_at: new Date('2026-01-02T00:00:00Z') } : {}) }, history: [], mutations: 0, commits: 0, rollbacks: 0, queries: [], writePermission, sourceContext, destinationContext, failReplacement, snapshot: null };
  async function query(sql, params = []) {
    state.queries.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
      if(sql==='BEGIN')state.snapshot={assignment:{...state.assignment},history:state.history.map(row=>({...row})),mutations:state.mutations};
      if(sql==='COMMIT')state.commits++;
      if(sql==='ROLLBACK'){state.rollbacks++;if(state.snapshot){state.assignment=state.snapshot.assignment;state.history=state.snapshot.history;state.mutations=state.snapshot.mutations;}}
      return { rows: [] };
    }
    if (sql.includes('FROM role_permissions')) return { rows: state.writePermission ? [{ permission: 'patient-assignments:write' }] : [] };
    if (sql.includes('FROM teachers WHERE user_id')) return { rows: [{ id: ACTOR }] };
    if (sql.includes('FROM teacher_academic_habilitations')) {
      const pairs=sql.includes('$5')?[[SUBJECT,GROUP],[SUBJECT,TARGET_GROUP]]:[[SUBJECT,GROUP]];
      return { rows: pairs.filter((_,i)=>i===0?state.sourceContext:state.destinationContext).map(([subject_id,academic_group_id])=>({id:`context-${academic_group_id}`,subject_id,academic_group_id})) };
    }
    if (sql.includes('FROM student_academic_habilitations')) {
      const ids = Array.isArray(params[0]) ? params[0] : [params[0]];
      return { rows: ids.map(id => ({ id, student_id: 'student', academic_group_id: id === TARGET ? TARGET_GROUP : GROUP })) };
    }
    if (sql.includes('FROM patients WHERE id')) return { rows: [{ id: PATIENT }] };
    if (sql.includes('FROM patient_assignments') && sql.includes('FOR UPDATE')) return { rows: state.assignment ? [{ ...state.assignment }] : [] };
    if (sql.includes('FROM patient_assignments') && sql.includes('JOIN student_academic_habilitations')) return { rows: state.assignment ? [{ ...state.assignment }] : [] };
    if (sql.includes('UPDATE patient_assignments')) {
      state.mutations++;
      state.assignment.ended_by = params[1]; state.assignment.ended_at = new Date('2026-01-02T00:00:00Z');
      if (sql.includes('end_reason = $3')) state.assignment.end_reason = params[2];
      return { rows: [{ ...state.assignment }] };
    }
    if (sql.includes('INSERT INTO patient_assignments')) {
      if(state.failReplacement)throw new Error('synthetic replacement insert failure');
      state.mutations++;
      const row = { ...INITIAL, id: '9007199254740994', student_habilitation_id: params[1], assigned_by: params[3], assigned_at: new Date('2026-01-02T00:00:00Z') };
      state.history.push({ ...state.assignment }); state.assignment = row; return { rows: [{ ...row }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return { state, query, async connect() { return { query, release() {} }; } };
}
async function withServer(pool, run) {
  const server = createServer(createApp(pool)); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const tokens = new JwtTokenService({ secret: process.env.JWT_SECRET, secretKid: process.env.JWT_SECRET_KID, previousSecrets: [], expiresIn: '1h' });
  try { await run(`http://127.0.0.1:${server.address().port}`, await tokens.sign({ role:'teacher', sub:ACTOR, username:'actor', permissions:['patient-assignments:write'] })); }
  finally { await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
}
async function request(base, auth, path, body) {
  const response=await fetch(`${base}${path}`,{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify(body)});
  return { status:response.status, body:await response.json() };
}
const base='/patient-assignments';
const reassignBody={student_habilitation_id:TARGET,subject_id:SUBJECT,academic_group_id:TARGET_GROUP};

test('T3 public reassignment preserves BIGINT/history and attributes replacement to verified actor', async()=>{
  const db=fakePool(); await withServer(db,async(url,auth)=>{
    const response=await request(url,auth,`${base}/${ID}/reassign`,reassignBody);
    assert.equal(response.status,200); assert.equal(response.body.id,'9007199254740994');
    assert.equal(response.body.assigned_by,ACTOR); assert.equal(response.body.student_habilitation_id,TARGET);
    assert.equal(db.state.history.length,1); assert.equal(db.state.history[0].ended_by,ACTOR);
    assert.ok(db.state.history[0].ended_at); assert.equal(db.state.history[0].end_reason,null);
  });
});

test('replacement insert failure rolls back closure and preserves source audit/history/counters', async()=>{
  const db=fakePool({failReplacement:true});const before={assignment:{...db.state.assignment},history:structuredClone(db.state.history),mutations:db.state.mutations};
  await withServer(db,async(url,auth)=>{
    const response=await request(url,auth,`${base}/${ID}/reassign`,reassignBody);
    assert.equal(response.status,500);assert.equal(response.body.error.code,'INTERNAL_SERVER_ERROR');
  });
  assert.deepEqual(db.state.assignment,before.assignment);assert.deepEqual(db.state.history,before.history);
  assert.equal(db.state.mutations,before.mutations);assert.equal(db.state.rollbacks,1);assert.equal(db.state.commits,0);
});

test('fresh write grant and both source/destination contexts gate both lifecycle routes', async()=>{
  for(const options of [{writePermission:false},{sourceContext:false},{destinationContext:false}]){
    const db=fakePool(options);await withServer(db,async(url,auth)=>{
      const reassign=await request(url,auth,`${base}/${ID}/reassign`,reassignBody);
      assert.equal(reassign.status,403);
      const ended=await request(url,auth,`${base}/${ID}/end`,{end_reason:'close'});
      assert.equal(ended.status,options.destinationContext===false&&options.sourceContext!==false&&options.writePermission!==false?200:403);
    });
    if(options.destinationContext===false&&options.sourceContext!==false&&options.writePermission!==false){
      assert.equal(db.state.assignment.ended_by,ACTOR);assert.ok(db.state.assignment.ended_at);assert.equal(db.state.assignment.end_reason,'close');
    }else{assert.deepEqual(db.state.assignment,INITIAL);assert.equal(db.state.mutations,0);}
    assert.equal(db.state.history.length,0);
    if(options.destinationContext!==false||options.sourceContext===false||options.writePermission===false)assert.equal(db.state.queries.some(query=>query.sql.includes('UPDATE patient_assignments')||query.sql.includes('INSERT INTO patient_assignments')),false);
  }
});

test('ended-state conflict is not disclosed before source context authorization',async()=>{
  const db=fakePool({initiallyEnded:true,sourceContext:false});await withServer(db,async(url,auth)=>{
    for(const [path,body] of [[`${base}/${ID}/reassign`,reassignBody],[`${base}/${ID}/end`,{end_reason:'close'}]]){
      const response=await request(url,auth,path,body);assert.equal(response.status,403);
      assert.notEqual(response.body.error.message,'assignment is already ended');
    }
  });
});

test('lifecycle endpoints reject malformed and overflowing BIGINT IDs before database work', async()=>{
  for(const id of ['0','01','9223372036854775808','not-an-id']){
    const db=fakePool();await withServer(db,async(url,auth)=>{
      const response=await request(url,auth,`${base}/${id}/end`,{end_reason:'valid'});
      assert.equal(response.status,400);assert.equal(response.body.error.message,'assignment id must be a positive BIGINT decimal string');
      assert.equal(db.state.mutations,0);assert.equal(db.state.queries.some(q=>q.sql.includes('FROM patient_assignments')),false);
    });
  }
});

test('manual end requires a nonblank string reason and rejects without mutation', async()=>{
  for (const reason of [undefined,null,7,' \t ']) {
    const db=fakePool(); await withServer(db,async(url,auth)=>{
      const body=reason===undefined?{}:{end_reason:reason};
      const response=await request(url,auth,`${base}/${ID}/end`,body);
      assert.equal(response.status,400);
      assert.equal(response.body.error.code,'BAD_REQUEST');
      assert.equal(response.body.error.message,'end_reason must be a non-empty string');
      assert.equal(db.state.mutations,0); assert.equal(db.state.assignment.ended_at,null);
      assert.equal(db.state.commits,0); assert.equal(db.state.rollbacks,0);
    });
  }
});

test('manual end stores trimmed reason, verified actor and timestamp; repeated end does not overwrite facts', async()=>{
  const db=fakePool(); await withServer(db,async(url,auth)=>{
    const response=await request(url,auth,`${base}/${ID}/end`,{end_reason:'  completed  '});
    assert.equal(response.status,200); assert.equal(response.body.id,ID);
    assert.equal(response.body.ended_by,ACTOR); assert.equal(response.body.end_reason,'completed');
    const facts={ended_by:db.state.assignment.ended_by,ended_at:db.state.assignment.ended_at,end_reason:db.state.assignment.end_reason};
    const repeated=await request(url,auth,`${base}/${ID}/end`,{end_reason:'replacement reason'});
    assert.equal(repeated.status,409); assert.deepEqual({ended_by:db.state.assignment.ended_by,ended_at:db.state.assignment.ended_at,end_reason:db.state.assignment.end_reason},facts);
  });
});
