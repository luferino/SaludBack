import { evolutionActor, evolutionPatient, evolutionSubject, evolutionGroup, evolutionGrants } from './evolution-http.js';

const teacherActor = '30000000-0000-4000-8000-000000000002';
const profileId = actor => actor === evolutionActor ? '31000000-0000-4000-8000-000000000001' : '31000000-0000-4000-8000-000000000004';
const defaultPeriod = '60000000-0000-4000-8000-000000000001';

export function evolutionSyntheticPool() {
  const state = {
    queries: [], evolutions: [], submissions: [], corrections: [], reviews: [], commits: 0, rollbacks: 0, releases: 0,
    grantsByRole: { estudiante: evolutionGrants, teacher: ['kinesiology-evolutions:read', 'kinesiology-evolutions:review'], admin: [] },
    profiles: new Map([[evolutionActor, profileId(evolutionActor)]]),
    teachers: new Map([[teacherActor, '32000000-0000-4000-8000-000000000002']]),
    periods: [{ id: defaultPeriod, studentId: profileId(evolutionActor), subject: evolutionSubject, group: evolutionGroup, revoked: false }],
    teacherPeriods: [{ id: '62000000-0000-4000-8000-000000000002', teacherId: '32000000-0000-4000-8000-000000000002', subject: evolutionSubject, group: evolutionGroup, revoked: false }],
    assignments: [{ id: '9007199254740992', patient: evolutionPatient, subject: evolutionSubject, period: defaultPeriod, ended: false }],
    failAfterInsert: false, mutateBeforeLock: null, failUpdate: false,
    evaluation: { id: '9007199254740993', clinical_record_id: '9007199254740994', patient_id: evolutionPatient,
      author_id: '30000000-0000-4000-8000-000000000009', origin_student_habilitation_id: '60000000-0000-4000-8000-000000000009',
      status: 'validated', origin_subject_id: '10000000-0000-4000-8000-000000000009', origin_group_id: '20000000-0000-4000-8000-000000000009' },
  };
  const actorForProfile = id => [...state.profiles].find(([, profile]) => profile === id)?.[0];
  const periodsFor = (studentId, subject, group) => state.periods.filter(period => period.studentId === studentId &&
    period.subject === subject && period.group === group && !period.revoked);
  const assignmentsForStudent = (patient, actor, subject, group) => state.assignments.filter(assignment => {
    const period = state.periods.find(item => item.id === assignment.period);
    return assignment.patient === patient && !assignment.ended && period && !period.revoked &&
      period.studentId === state.profiles.get(actor) && period.subject === subject && period.group === group &&
      assignment.subject === period.subject;
  });
  const currentPatientAssignment = actor => state.assignments.some(assignment => {
    const period = state.periods.find(item => item.id === assignment.period);
    return period && !period.revoked && !assignment.ended && assignment.patient === state.evaluation.patient_id &&
      state.profiles.get(actor) === period.studentId && assignment.subject === period.subject;
  });
  const teacherHasContext = (actor, subject, group) => {
    const teacherId = state.teachers.get(actor);
    return !!teacherId && state.teacherPeriods.some(period => period.teacherId === teacherId && !period.revoked &&
      period.subject === subject && period.group === group);
  };
  const privateReadable = (row, actor) => {
    const ownAssignment = state.assignments.some(assignment => {
      const period = state.periods.find(item => item.id === assignment.period);
      return row.author_id === actor && state.profiles.has(actor) && period && !period.revoked && !assignment.ended &&
        assignment.patient === row.patient_id && period.studentId === state.profiles.get(actor) &&
        assignment.subject === period.subject && period.subject === row.origin_subject_id && period.group === row.origin_group_id;
    });
    return ownAssignment || teacherHasContext(actor, row.origin_subject_id, row.origin_group_id);
  };
  const currentCareReadable = (row, actor) => {
    if (!state.submissions.some(item => item.evolution_id === row.id)) return false;
    const profile = state.profiles.get(actor);
    const studentCare = !!profile && state.assignments.some(assignment => {
      const period = state.periods.find(item => item.id === assignment.period);
      return assignment.patient === row.patient_id && !assignment.ended && period && !period.revoked &&
        period.studentId === profile && assignment.subject === period.subject;
    });
    const teacherId = state.teachers.get(actor);
    const teacherCare = !!teacherId && state.teacherPeriods.filter(period => period.teacherId === teacherId && !period.revoked).some(period =>
      state.assignments.some(assignment => {
        const studentPeriod = state.periods.find(item => item.id === assignment.period);
        return assignment.patient === row.patient_id && !assignment.ended && studentPeriod && !studentPeriod.revoked &&
          studentPeriod.subject === period.subject && studentPeriod.group === period.group && assignment.subject === period.subject;
      }));
    return studentCare || teacherCare;
  };
  const canRead = (row, actor) => privateReadable(row, actor) || currentCareReadable(row, actor);
  const projected = (row, actor) => {
    if (!privateReadable(row, actor) && currentCareReadable(row, actor)) {
      const latest = state.submissions.filter(item => item.evolution_id === row.id).at(-1);
      if (!latest) return null;
      const review = state.reviews.find(item => item.evolution_id === row.id && item.submission_id === latest.id);
      return { ...row, status: review ? 'validated' : 'submitted', content: latest.content,
        projected_submission_id: latest.id, projected_submitted_by: latest.submitted_by, projected_submitted_at: latest.submitted_at,
        projected_reviewed_by: review?.reviewed_by ?? null, projected_reviewed_at: review?.reviewed_at ?? null,
        validation_status: review ? 'validated' : 'pending_validation', created_at: latest.submitted_at, updated_at: latest.submitted_at };
    }
    const latest = state.submissions.filter(item => item.evolution_id === row.id).at(-1);
    return row.status === 'draft' || !latest ? { ...row } : { ...row, content: latest.content,
      projected_submission_id: latest.id, projected_submitted_by: latest.submitted_by, projected_submitted_at: latest.submitted_at,
      validation_status: 'pending_validation' };
  };
  const assertOriginSql = sql => {
    for (const fragment of ['a.patient_id = e.patient_id', 'a.subject_id = sp.subject_id',
      'sp.subject_id = e.origin_subject_id', 'sp.academic_group_id = e.origin_group_id',
      'sp.revoked_at IS NULL', 'a.ended_at IS NULL', 'th.subject_id = e.origin_subject_id',
      'th.academic_group_id = e.origin_group_id', 'th.revoked_at IS NULL']) assertFragment(sql, fragment);
  };
  const assertFragment = (sql, fragment) => {
    if (!sql.includes(fragment)) throw new Error(`Draft SQL omitted required predicate '${fragment}': ${sql}`);
  };
  const assertLatestAlias = sql => {
    if (/\blatest\./i.test(sql) && !/\)\s*latest\s+ON\s+true/i.test(sql)) {
      throw new Error(`Evolution SQL references latest without joining its lateral alias: ${sql}`);
    }
  };
  const query = async (sql, params = []) => {
    state.queries.push({ sql, params });
    if (sql.includes('FROM kinesiology_evolutions e')) assertLatestAlias(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
      if (sql === 'BEGIN') state.snapshot = structuredClone({ evolutions: state.evolutions, submissions: state.submissions, corrections: state.corrections, reviews: state.reviews });
      if (sql === 'COMMIT') { state.commits++; state.snapshot = null; }
      if (sql === 'ROLLBACK') {
        state.rollbacks++;
        if (state.snapshot) { state.evolutions = state.snapshot.evolutions; state.submissions = state.snapshot.submissions;
          state.corrections = state.snapshot.corrections; state.reviews = state.snapshot.reviews; }
        state.snapshot = null;
      }
      return { rows: [] };
    }
    if (sql.includes('FROM role_permissions')) return { rows: (state.grantsByRole[params[0]] || []).map(permission => ({ permission })) };
    if (sql.includes('FROM students WHERE user_id')) return { rows: state.profiles.has(params[0]) ? [{ id: state.profiles.get(params[0]) }] : [] };
    if (sql.includes('FROM student_academic_habilitations') && sql.includes('WHERE student_id = $1')) {
      assertFragment(sql, 'student_id = $1');
      assertFragment(sql, 'subject_id = $2');
      assertFragment(sql, 'academic_group_id = $3');
      assertFragment(sql, 'revoked_at IS NULL');
      return { rows: periodsFor(params[0], params[1], params[2]).map(period => ({ id: period.id })) };
    }
    if (sql.includes('FROM patients')) return { rows: params[0] === evolutionPatient ? [{ id: params[0] }] : [] };
    if (sql.includes('FROM teachers t JOIN teacher_academic_habilitations th') &&
      sql.includes('WHERE t.user_id = $1 AND th.subject_id = $2 AND th.academic_group_id = $3')) {
      const teacherId = state.teachers.get(params[0]);
      const periods = state.teacherPeriods.filter(period => period.teacherId === teacherId && !period.revoked &&
        period.subject === params[1] && period.group === params[2]);
      return { rows: periods.map(period => ({ teacher_habilitation_id: period.id })) };
    }
    if (sql.includes('FROM patient_assignments')) {
      assertFragment(sql, 'a.patient_id = $1');
      assertFragment(sql, 'a.ended_at IS NULL');
      if (sql.includes('p.student_id = $4')) {
        assertFragment(sql, 'p.revoked_at IS NULL');
        assertFragment(sql, 'p.subject_id = a.subject_id');
        assertFragment(sql, 'a.subject_id = $2');
        assertFragment(sql, 'p.academic_group_id = $3');
        assertFragment(sql, 'p.student_id = $4');
        const rows = assignmentsForStudent(params[0], actorForProfile(params[3]), params[1], params[2]);
        return { rows: rows.map(assignment => ({ id: assignment.id, student_habilitation_id: assignment.period })) };
      }
      assertFragment(sql, 'sp.revoked_at IS NULL');
      assertFragment(sql, 's.user_id = $2');
      assertFragment(sql, 'a.subject_id = sp.subject_id');
      assertFragment(sql, 'sp.subject_id = $3');
      assertFragment(sql, 'sp.academic_group_id = $4');
      const rows = assignmentsForStudent(params[0], params[1], params[2], params[3]);
      return { rows: rows.map(assignment => ({ student_habilitation_id: assignment.period })) };
    }
    if (sql.includes('FROM kinesiology_evaluations e')) {
      const e = state.evaluation;
      assertFragment(sql, "e.status = 'validated'");
      assertFragment(sql, 'e.patient_id = $2');
      assertFragment(sql, 'a.patient_id = e.patient_id');
      assertFragment(sql, 'a.subject_id = sp.subject_id');
      assertFragment(sql, 'sp.revoked_at IS NULL');
      assertFragment(sql, 'a.ended_at IS NULL');
      assertFragment(sql, 'th.subject_id = e.origin_subject_id');
      assertFragment(sql, 'th.academic_group_id = e.origin_group_id');
      assertFragment(sql, 'th.revoked_at IS NULL');
      const readable = currentPatientAssignment(params[2]) || teacherHasContext(params[2], e?.origin_subject_id, e?.origin_group_id);
      return { rows: e && e.id === params[0] && e.patient_id === params[1] && e.status === 'validated' && readable ? [{ ...e }] : [] };
    }
    if (sql.includes('FROM clinical_records')) {
      const e = state.evaluation;
      return { rows: e && e.clinical_record_id === params[0] && e.patient_id === params[1] ? [{ id: e.clinical_record_id }] : [] };
    }
    if (sql.includes('SELECT id::text AS id, clinical_content FROM kinesiology_evolution_submissions')) {
      const row = state.submissions.find(item => item.id === params[0] && item.evolution_id === params[1]);
      return { rows: row ? [{ id: row.id, clinical_content: row.content }] : [] };
    }
    if (sql.includes('SELECT id::text AS id FROM kinesiology_evolution_submissions')) {
      if (sql.includes('AND evolution_id = $2')) {
        const target = state.submissions.find(item => item.id === params[0] && item.evolution_id === params[1]);
        return { rows: target ? [{ id: target.id }] : [] };
      }
      const latest = state.submissions.filter(item => item.evolution_id === params[0]).at(-1);
      return { rows: latest ? [{ id: latest.id }] : [] };
    }
    if (sql.includes('INSERT INTO kinesiology_evolution_correction_requests')) {
      const event = { id: String(state.corrections.length + 1), evolution_id: params[0], submission_id: params[1],
        reason: params[2], reviewed_by: params[3], requested_at: '2026-02-28T12:00:00Z' };
      state.corrections.push(event);
      return { rows: [{ id: event.id, requested_at: event.requested_at }] };
    }
    if (sql.includes('INSERT INTO kinesiology_evolution_validation_reviews')) {
      const review = { evolution_id: params[0], submission_id: params[1], reviewed_by: params[2],
        teacher_habilitation_id: params[3], reviewed_at: '2026-02-28T12:00:00Z' };
      state.reviews.push(review);
      return { rows: [{ reviewed_at: review.reviewed_at }] };
    }
    if (sql.includes("UPDATE kinesiology_evolutions SET status = 'validated'")) {
      const row = state.evolutions.find(item => item.id === params[0]);
      if (!row || row.status !== 'submitted' || state.failUpdate) return { rows: [] };
      row.status = 'validated'; row.updated_at = '2026-02-28T12:00:00Z';
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes("UPDATE kinesiology_evolutions SET content = $2::jsonb, status = 'draft'")) {
      const row = state.evolutions.find(item => item.id === params[0]);
      if (!row || row.status !== 'submitted' || state.failUpdate) return { rows: [] };
      row.status = 'draft'; row.content = JSON.parse(params[1]); row.updated_at = '2026-02-28T12:00:00Z';
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('INSERT INTO kinesiology_evolution_submissions')) {
      assertFragment(sql, 'COALESCE(MAX(ordinal), 0) + 1');
      const row = { id: String(1 + state.submissions.length), evolution_id: params[0], ordinal: String(1 + state.submissions.filter(item => item.evolution_id === params[0]).length),
        submitted_by: params[1], submitted_at: '2026-02-28T12:00:00Z', content: JSON.parse(params[2]) };
      state.submissions.push(row);
      return { rows: [{ ...row }] };
    }
    if (sql.includes("UPDATE kinesiology_evolutions SET status = 'submitted'")) {
      const row = state.evolutions.find(item => item.id === params[0]);
      if (!row || row.status !== 'draft' || state.failUpdate) return { rows: [] };
      row.status = 'submitted'; row.updated_at = '2026-02-28T12:00:00Z';
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes('INSERT INTO kinesiology_evolutions')) {
      const row = { id: String(9007199254740995n + BigInt(state.evolutions.length)), clinical_record_id: params[0], patient_id: params[1],
        evaluation_id: params[2], author_id: params[3], origin_student_habilitation_id: params[4], origin_subject_id: params[5],
        origin_group_id: params[6], content: JSON.parse(params[7]), status: 'draft', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
      state.evolutions.push(row);
      if (state.failAfterInsert) throw new Error('synthetic insert failure');
      return { rows: [{ ...row }] };
    }
    if (sql.includes('FROM kinesiology_evolutions e') && sql.includes('LEFT JOIN kinesiology_evolution_correction_requests')) {
      const row = state.evolutions.find(item => item.id === params[0]);
      if (!row || !privateReadable(row, params[1])) return { rows: [] };
      const events = state.corrections.filter(event => event.evolution_id === row.id);
      return { rows: (events.length ? events : [null]).map(event => ({ evolution_id: row.id,
        submission_id: event?.submission_id ?? null, reason: event?.reason ?? null, reviewed_by: event?.reviewed_by ?? null,
        requested_at: event?.requested_at ?? null })) };
    }
    if (sql.includes('JOIN kinesiology_evolution_submissions s ON s.evolution_id = e.id')) {
      assertOriginSql(sql);
      const row = state.evolutions.find(item => item.id === params[0]);
      if (!row || !canRead(row, params[1])) return { rows: [] };
      const history = state.submissions.filter(item => item.evolution_id === row.id);
      const visible = privateReadable(row, params[1]) ? history : history.slice(-1);
      return { rows: visible.map(item => {
        const review = state.reviews.find(entry => entry.evolution_id === row.id && entry.submission_id === item.id);
        return { evolution_id: row.id, id: item.id, ordinal: item.ordinal, submitted_by: item.submitted_by,
          submitted_at: item.submitted_at, content: item.content, validation_status: review ? 'validated' : 'pending_validation',
          reviewed_by: review?.reviewed_by ?? null, reviewed_at: review?.reviewed_at ?? null };
      }) };
    }
    if (sql.includes('FROM kinesiology_evolutions e')) {
      assertOriginSql(sql);
      const isList = sql.includes('WHERE e.patient_id = $1');
      let rows = state.evolutions.filter(row => isList ? row.patient_id === params[0] : row.id === params[0]);
      if (isList) {
        const subjectParam = sql.match(/e\.origin_subject_id = \$(\d+)/)?.[1];
        const groupParam = sql.match(/e\.origin_group_id = \$(\d+)/)?.[1];
        if (subjectParam) rows = rows.filter(row => row.origin_subject_id === params[Number(subjectParam) - 1]);
        if (groupParam) rows = rows.filter(row => row.origin_group_id === params[Number(groupParam) - 1]);
      }
      rows = rows.filter(row => canRead(row, params[1]));
      return { rows: rows.map(row => projected(row, params[1])).filter(Boolean) };
    }
    if (sql.includes('FROM kinesiology_evolutions WHERE id = $1')) {
      let row = state.evolutions.find(item => item.id === params[0]);
      if (row && sql.includes('FOR UPDATE') && state.mutateBeforeLock) {
        Object.assign(row, state.mutateBeforeLock);
        state.mutateBeforeLock = null;
      }
      return { rows: row ? [{ ...row }] : [] };
    }
    if (sql.includes('SELECT e.id FROM kinesiology_evolutions e')) {
      assertOriginSql(sql);
      const row = state.evolutions.find(item => item.id === params[0]);
      return { rows: row && privateReadable(row, params[1]) ? [{ id: row.id }] : [] };
    }
    if (sql.includes('UPDATE kinesiology_evolutions')) {
      const row = state.evolutions.find(item => item.id === params[0]);
      if (!row || row.status !== 'draft' || state.failUpdate) return { rows: [] };
      row.content = JSON.parse(params[1]); row.updated_at = '2026-01-02T00:00:00Z';
      return { rows: [{ ...row }] };
    }
    throw new Error(`Unexpected draft SQL: ${sql}`);
  };
  return { state, query, async connect() { return { query, release() { state.releases++; } }; } };
}
