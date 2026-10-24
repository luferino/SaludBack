import test from 'node:test';
import assert from 'node:assert/strict';
import { EvaluationService } from '../../src/modules/kinesiology-evaluations/application/evaluation.service.ts';
import { PatientAssignmentService } from '../../src/modules/patient-assignments/application/patient-assignment.service.ts';

// Application entry points must work with an operation port, without a pg pool,
// Express request, or concrete repository instance.
for (const [Service, cases] of [
  [EvaluationService, [
    ['create', ['patient', { subjectId: 'subject', groupId: 'group' }, { antecedents: { diu: null } }, 'actor']],
    ['edit', ['evaluation', { studies: [{ type: ' X-ray ', description: ' study ', date: null }] }, 'actor']],
    ['createAmendment', ['evaluation', 'actor']],
    ['submit', ['evaluation', 'actor']],
    ['requestCorrection', ['evaluation', 'submission', 'reason', 'actor']],
    ['validate', ['evaluation', 'submission', 'actor']],
    ['corrections', ['evaluation', 'actor']],
    ['submissions', ['evaluation', 'actor']],
    ['consent', ['evaluation', 'actor']],
    ['verifyConsent', ['evaluation', '2026-10-01', 'actor']],
    ['detail', ['evaluation', 'actor']],
    ['list', ['patient', 'actor', 'subject', 'group']],
  ]],
  [PatientAssignmentService, [
    ['create', [{ patientId: 'patient', periodId: 'period', subjectId: 'subject', groupId: 'group', actorId: 'actor' }]],
    ['reassign', ['assignment', { periodId: 'period', subjectId: 'subject', groupId: 'group', actorId: 'actor' }]],
    ['end', ['assignment', 'actor', 'reason']],
    ['listTeacher', ['actor', 50, 0]],
    ['listOwn', ['actor', 10, 20]],
  ]],
]) {
  test(`${Service.name} preserves arguments, results and failures through an injected port`, async () => {
    for (const [method, args] of cases) {
      const calls = [];
      const result = { marker: method };
      const repository = { [method]: async (...received) => { calls.push(received); return result; } };
      const service = new Service(repository);
      assert.equal(await service[method](...args), result);
      assert.deepEqual(calls, [args]);
      const failure = new Error(`atomic ${method} rejected`);
      repository[method] = async () => { throw failure; };
      await assert.rejects(service[method](...args), error => error === failure);
      assert.deepEqual(calls, [args]);
    }
  });
}

test('evaluation create/edit validate clinical content before calling any persistence port', () => {
  const calls = [];
  const service = new EvaluationService({
    create: (...args) => calls.push(args),
    edit: (...args) => calls.push(args),
  });
  assert.throws(() => service.create('patient', {}, { admission_date: '2026-02-31' }, 'actor'),
    { message: 'admission_date must be a valid YYYY-MM-DD date or null' });
  assert.throws(() => service.edit('evaluation', { antecedents: { diu: 'yes' } }, 'actor'),
    { message: 'antecedents.diu must be a boolean or null' });
  assert.deepEqual(calls, []);
});
