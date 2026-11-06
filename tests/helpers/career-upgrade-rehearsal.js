import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const migrations = new URL('../../src/db/migrations/', import.meta.url);
const careerTables = new Set(['subjects', 'academic_groups', 'subject_academic_groups']);

// Called only by the disposable runner, on its verified fresh socket.
async function apply(client, files) {
  for (const file of files) {
    await client.query('BEGIN');
    try {
      await client.query(await readFile(new URL(file, migrations), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function snapshot(client, tables, stripCareer = false) {
  const result = {};
  for (const table of tables) {
    assert.match(table, /^[a-z_]+$/);
    const rows = (await client.query(`SELECT to_jsonb(t) AS row FROM public."${table}" t`)).rows.map(({ row }) => {
      if (stripCareer && careerTables.has(table)) delete row.career_id;
      return JSON.stringify(row);
    });
    result[table] = rows.sort();
  }
  return result;
}

async function sequenceSnapshot(client) {
  const names = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  const result = {};
  for (const { sequencename: name } of names) {
    assert.match(name, /^[a-z_]+$/);
    result[name] = (await client.query(`SELECT last_value::text, is_called FROM public."${name}"`)).rows;
  }
  return result;
}

async function seedLegacy(client) {
  const [admin, teacherUser, studentUser] = (await client.query(`INSERT INTO users(username,password_hash,role) VALUES
    ('upgrade_admin','unused','admin'),('upgrade_teacher','unused','teacher'),('upgrade_student','unused','estudiante') RETURNING id`)).rows;
  const teacher = (await client.query("INSERT INTO teachers(user_id,nombres,apellidos) VALUES ($1,'Synthetic','Teacher') RETURNING id", [teacherUser.id])).rows[0];
  const student = (await client.query("INSERT INTO students(user_id,nombres,apellidos,codalumno) VALUES ($1,'Synthetic','Student','UPGRADE01') RETURNING id", [studentUser.id])).rows[0];
  const subjects = (await client.query("INSERT INTO subjects(name,created_by) VALUES ('Legacy subject',$1),('Unused legacy subject',$1) RETURNING id", [admin.id])).rows;
  const groups = (await client.query("INSERT INTO academic_groups(academic_year,curriculum_semester,name,created_by) VALUES (2098,1,'Group A',$1),(2098,1,'Unused group',$1) RETURNING id", [admin.id])).rows;
  const subject = subjects[0], group = groups[0];
  await client.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id,created_by) VALUES ($1,$2,$3)', [subject.id, group.id, admin.id]);
  await client.query(`INSERT INTO teacher_academic_habilitations(teacher_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,'2026-01-01')`, [teacher.id, subject.id, group.id, admin.id]);
  const period = (await client.query(`INSERT INTO student_academic_habilitations(student_id,subject_id,academic_group_id,activated_by,activated_at)
    VALUES ($1,$2,$3,$4,'2026-01-01') RETURNING id`, [student.id, subject.id, group.id, admin.id])).rows[0];
  const patient = (await client.query(`INSERT INTO patients(documento,nombres,apellidos,fecha_nacimiento,email,celular,sexo,direccion)
    VALUES ('UPGRADE0001','Synthetic','Patient','2000-02-29','upgrade@example.test','00000000','F','Synthetic address') RETURNING id`)).rows[0];
  await client.query(`INSERT INTO patient_context_availabilities(patient_id,subject_id,academic_group_id,enabled_by)
    VALUES ($1,$2,$3,$4)`, [patient.id, subject.id, group.id, teacherUser.id]);
  await client.query(`INSERT INTO patient_assignments(patient_id,student_habilitation_id,subject_id,assigned_by)
    VALUES ($1,$2,$3,$4)`, [patient.id, period.id, subject.id, teacherUser.id]);
  const record = (await client.query('INSERT INTO clinical_records(patient_id,created_by) VALUES ($1,$2) RETURNING id', [patient.id, teacherUser.id])).rows[0];
  const evaluation = (await client.query(`INSERT INTO kinesiology_evaluations(clinical_record_id,patient_id,author_id,
    origin_student_habilitation_id,origin_subject_id,origin_group_id,content) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
  [record.id, patient.id, studentUser.id, period.id, subject.id, group.id, { illness_history: 'Synthetic pre-career history', objectives: 'Preserve' }])).rows[0];
  await client.query(`INSERT INTO kinesiology_evolutions(clinical_record_id,patient_id,evaluation_id,author_id,
    origin_student_habilitation_id,origin_subject_id,origin_group_id,content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [record.id, patient.id, evaluation.id, studentUser.id, period.id, subject.id, group.id, { current_status: 'Synthetic legacy session' }]);
  return { subject: subject.id, group: group.id };
}

export async function rehearseCareerUpgrade(client) {
  // The upgrade under rehearsal is 036/037; later migrations are outside its scope.
  const files = (await readdir(migrations)).filter(file => file.endsWith('.sql')).sort().slice(0, 37);
  assert.equal(files.length, 37, 'rehearsal is pinned to migrations 001–037');
  assert.equal(files[35], '036_create_careers.sql');
  assert.equal(files[36], '037_seed_career_permissions.sql');
  await client.query('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  await apply(client, files.slice(0, 35));
  const legacy = await seedLegacy(client);
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
  const before = await snapshot(client, tables);
  const counters = await sequenceSnapshot(client);
  await apply(client, files.slice(35));
  const after = await snapshot(client, tables, true);
  for (const table of tables) {
    if (!['schema_migrations', 'permissions', 'role_permissions'].includes(table)) {
      assert.deepEqual(after[table], before[table], `${table}: every legacy row, identity, audit field and content preserved`);
    }
  }
  assert.deepEqual(await sequenceSnapshot(client), counters, 'upgrade must not advance legacy sequences');
  const ledger = (await client.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row => row.name);
  assert.deepEqual(ledger, files);
  assert.deepEqual(after.schema_migrations.filter(row => files.slice(0, 35).includes(JSON.parse(row).name)), before.schema_migrations);
  const careers = (await client.query('SELECT id,code,name FROM careers ORDER BY code')).rows;
  assert.deepEqual(careers.map(({ code, name }) => ({ code, name })), [
    { code: 'kinesiology', name: 'Kinesiología' }, { code: 'odontology', name: 'Odontología' },
  ]);
  const kine = careers[0].id, odonto = careers[1].id;
  for (const table of careerTables) {
    const rows = (await client.query(`SELECT career_id FROM "${table}"`)).rows;
    assert.ok(rows.length > 0);
    assert.ok(rows.every(row => row.career_id === kine), `${table}: all existing rows backfilled`);
  }
  for (const table of ['permissions', 'role_permissions']) {
    const added = after[table].filter(row => JSON.parse(row).permission === 'careers:read');
    assert.equal(added.length, 1);
    assert.deepEqual(after[table].filter(row => JSON.parse(row).permission !== 'careers:read'), before[table]);
    if (table === 'permissions') assert.equal(JSON.parse(added[0]).enforced, true);
  }
  const grants = async permission => (await client.query('SELECT role FROM role_permissions WHERE permission=$1 ORDER BY role', [permission])).rows;
  assert.deepEqual(await grants('careers:read'), await grants('subjects:read'));
  assert.deepEqual(await grants('careers:read'), [{ role: 'admin' }]);

  // A valid second career may reuse the original group name and period.
  const dentalSubject = (await client.query("INSERT INTO subjects(name,career_id) VALUES ('Dental subject',$1) RETURNING id", [odonto])).rows[0].id;
  const dentalGroup = (await client.query("INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,'Group A',$1) RETURNING id", [odonto])).rows[0].id;
  await client.query('INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id) VALUES ($1,$2,$3)', [dentalSubject, dentalGroup, odonto]);
  const allTables = [...tables, 'careers'];
  const rejected = async (sql, args, code, constraint) => {
    const rows = await snapshot(client, allTables), sequences = await sequenceSnapshot(client);
    await assert.rejects(client.query(sql, args), error => error.code === code && error.constraint === constraint);
    assert.deepEqual(await snapshot(client, allTables), rows, 'rejected input must leave all stored rows unchanged');
    assert.deepEqual(await sequenceSnapshot(client), sequences, 'rejected input must leave counters unchanged');
  };
  const duplicateGroup = "INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,'Group A',$1)";
  for (const career of [kine, odonto]) {
    await rejected(duplicateGroup, [career], '23505', 'academic_groups_career_year_semester_name_unique');
  }
  const association = 'INSERT INTO subject_academic_groups(subject_id,academic_group_id,career_id) VALUES ($1,$2,$3)';
  await rejected(association, [legacy.subject, dentalGroup, kine], '23503', 'subject_academic_groups_academic_group_career_fkey');
  await rejected(association, [dentalSubject, legacy.group, kine], '23503', 'subject_academic_groups_subject_career_fkey');
  const unknown = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await rejected("INSERT INTO subjects(name,career_id) VALUES ('Unknown career',$1)", [unknown], '23503', 'subjects_career_id_fkey');
  await rejected("INSERT INTO academic_groups(academic_year,curriculum_semester,name,career_id) VALUES (2098,1,'Unknown career',$1)", [unknown], '23503', 'academic_groups_career_id_fkey');
  return { legacyMigrations: 35, upgradedMigrations: 37, preservedTables: tables.length,
    backfilledTables: 3, rejectedWrites: 6, legacySequencesPreserved: true, grants: 'admin-only' };
}
