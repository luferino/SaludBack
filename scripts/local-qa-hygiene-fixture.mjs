import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Username rules: A-Z0-9 after uppercasing. Password rules: >= 10 chars with a letter and a digit.
const randomSuffix = () => crypto.randomBytes(4).toString('hex').toUpperCase();
const generatedPassword = () => `E2e${crypto.randomBytes(6).toString('hex')}x1`;

async function call(base, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    throw Object.assign(new Error('Fixture API request failed'), { code: `HTTP_${response.status}` });
  }
  return json;
}

// Reads the login-time permission snapshot from our own token (signature not needed here).
function claimsOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function requirePermissions(token, required, who) {
  const have = new Set(claimsOf(token).permissions ?? []);
  const missing = required.filter((permission) => !have.has(permission));
  if (missing.length) {
    throw new Error(`${who} token lacks ${missing.join(', ')}; check the permission seed migrations`);
  }
}

export async function seed(baseArg, adminUser, adminPassword) {
  const target = new URL(baseArg);
  assert.match(target.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
  assert.equal(target.href, `${target.origin}/`);
  const base = target.origin;

  // 1. Admin login. Migrations 055 and 057 grant the hygiene permissions to admin by default.
  const adminToken = (await call(base, 'POST', '/auth/login', {
    body: { username: adminUser, password: adminPassword },
  })).token;
  if (claimsOf(adminToken).role !== 'admin') throw new Error('admin login did not return an admin role');
  requirePermissions(adminToken, [
    'hygiene-preventive-subjects:read',
    'hygiene-preventive-subjects:write',
    'hygiene-preventive-drafts:read',
  ], 'admin');

  // 2. Odontology career (seeded by migration 036).
  const careers = await call(base, 'GET', '/careers', { token: adminToken });
  const odontology = careers.items.find((career) => career.code === 'odontology');
  if (!odontology) throw new Error('career with code odontology was not found (migration 036)');

  // 3. Subject, academic group, and subject-group link (same career required).
  const subject = await call(base, 'POST', '/subjects', {
    token: adminToken,
    body: { name: `QA Hygiene Subject ${randomSuffix()}`, career_id: odontology.id },
  });
  const group = await call(base, 'POST', '/groups', {
    token: adminToken,
    body: {
      academic_year: 2026,
      curriculum_semester: 1,
      name: `QA Hygiene Group ${randomSuffix()}`,
      career_id: odontology.id,
    },
  });
  await call(base, 'POST', '/subject-groups', {
    token: adminToken,
    body: { subject_id: subject.id, academic_group_id: group.id },
  });

  // 4. Teacher account and profile, then teacher habilitation in that context (admin only).
  const teacher = { username: `E2EDOC${randomSuffix()}`, password: generatedPassword() };
  const teacherProfile = await call(base, 'POST', '/teachers', {
    token: adminToken,
    body: { username: teacher.username, password: teacher.password, nombres: 'E2E', apellidos: 'Teacher' },
  });
  await call(base, 'POST', '/teacher-habilitations', {
    token: adminToken,
    body: { teacher_id: teacherProfile.id, subject_id: subject.id, academic_group_id: group.id },
  });

  // 5. Student account and profile.
  const student = { username: `E2ESTU${randomSuffix()}`, password: generatedPassword() };
  const studentProfile = await call(base, 'POST', '/students', {
    token: adminToken,
    body: {
      username: student.username,
      password: student.password,
      nombres: 'E2E',
      apellidos: 'Student',
      codalumno: `E2E${randomSuffix()}`,
    },
  });

  // Both generated accounts must be able to log in with the generated passwords.
  await call(base, 'POST', '/auth/login', { body: student });
  const teacherToken = (await call(base, 'POST', '/auth/login', { body: teacher })).token;
  requirePermissions(teacherToken, ['student-habilitations:write', 'patient-assignments:write'], 'teacher');

  // 6. Student habilitation. Only the teacher role holds student-habilitations:write (migration 016).
  const studentHabilitation = await call(base, 'POST', '/student-habilitations', {
    token: teacherToken,
    body: { student_id: studentProfile.id, subject_id: subject.id, academic_group_id: group.id },
  });

  // 7. Patient, then the availability the assignment checks (patient_context_availabilities).
  const patient = await call(base, 'POST', '/patients', {
    token: adminToken,
    body: {
      documento: String(crypto.randomInt(10000000, 100000000)),
      nombres: 'E2E',
      apellidos: 'Patient',
      fecha_nacimiento: '1990-01-15',
      email: `e2e.${randomSuffix().toLowerCase()}@example.com`,
      celular: '1155550100',
      sexo: 'F',
      direccion: 'E2E Address 123',
    },
  });
  await call(base, 'POST', '/patient-availabilities', {
    token: adminToken,
    body: { patient_id: patient.id, subject_id: subject.id, academic_group_id: group.id },
  });

  // 8. Assignment, created by the teacher (patient-assignments:write is teacher-only).
  const assignment = await call(base, 'POST', '/patient-assignments', {
    token: teacherToken,
    body: {
      patient_id: patient.id,
      student_habilitation_id: studentHabilitation.id,
      subject_id: subject.id,
      academic_group_id: group.id,
    },
  });

  await call(base, 'POST', '/hygiene-preventive-subjects', { token: adminToken, body: { subject_id: subject.id } });
  const studentToken = (await call(base,'POST','/auth/login',{body:student})).token;
  const context = {patient_id:patient.id,subject_id:subject.id,academic_group_id:group.id};
  const draft = await call(base, 'POST', '/hygiene-preventive-drafts', { token: studentToken, body: context });
  return { ...context, draftId: String(draft.id) };
}
