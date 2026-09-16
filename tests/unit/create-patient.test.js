import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreatePatient } from '../../src/modules/patients/application/create-patient.usecase.ts';
import { Patient } from '../../src/modules/patients/domain/patient.entity.ts';
import { BadRequestError, ConflictError } from '../../src/modules/shared/domain/errors.ts';

function createFakeRepository(overrides = {}) {
  const calls = { findByDocumento: [], create: [] };
  return {
    calls,
    async findByDocumento(documento) {
      calls.findByDocumento.push(documento);
      return overrides.existing ?? null;
    },
    async create(patient) {
      calls.create.push(patient);
      if (overrides.createThrows) throw overrides.createThrows;
      return new Patient({
        ...patient,
        id: 'uuid-new',
        createdAt: new Date('2026-08-11T12:00:00Z'),
      });
    },
  };
}

const VALID_INPUT = {
  documento: '35123456',
  nombres: 'Ana',
  apellidos: 'Lopez',
  fecha_nacimiento: '1990-04-12',
  email: 'ana@mail.com',
  celular: '+5491100000000',
  sexo: 'F',
  direccion: 'Av. Siempre Viva 742',
};

test('successful create persists the patient and passes createdBy through', async () => {
  const repository = createFakeRepository();
  const useCase = new CreatePatient({ repository });

  const created = await useCase.execute({ ...VALID_INPUT, createdBy: 'actor-1' });

  assert.ok(created instanceof Patient);
  assert.equal(created.documento, '35123456');
  assert.equal(created.fechaNacimiento, '1990-04-12');
  assert.equal(created.createdBy, 'actor-1');
  assert.equal(repository.calls.findByDocumento.length, 1);
  assert.equal(repository.calls.findByDocumento[0], '35123456');
  assert.equal(repository.calls.create.length, 1);
  assert.equal(repository.calls.create[0].createdBy, 'actor-1');
});

test('anonymous create defaults createdBy to null', async () => {
  const repository = createFakeRepository();
  const useCase = new CreatePatient({ repository });

  const created = await useCase.execute(VALID_INPUT);

  assert.equal(created.createdBy, null);
  assert.equal(repository.calls.create[0].createdBy, null);
});

test('documento is trimmed before the duplicate check and persistence', async () => {
  const repository = createFakeRepository();
  const useCase = new CreatePatient({ repository });

  const created = await useCase.execute({ ...VALID_INPUT, documento: ' 35123456 ' });

  assert.equal(created.documento, '35123456');
  assert.equal(repository.calls.findByDocumento[0], '35123456');
  assert.equal(repository.calls.create[0].documento, '35123456');
});

test('missing, null, or blank required fields throw BadRequestError and never create', async () => {
  for (const field of Object.keys(VALID_INPUT)) {
    for (const badValue of [undefined, null, '', '   ']) {
      const repository = createFakeRepository();
      const useCase = new CreatePatient({ repository });

      await assert.rejects(
        () => useCase.execute({ ...VALID_INPUT, [field]: badValue }),
        BadRequestError,
      );
      assert.equal(repository.calls.create.length, 0, `${field} = ${JSON.stringify(badValue)} must not create`);
    }
  }
});

test('documento rejects non-digit and out-of-range values', async () => {
  for (const documento of ['12A4', '123', '123456789']) {
    const repository = createFakeRepository();
    const useCase = new CreatePatient({ repository });

    await assert.rejects(
      () => useCase.execute({ ...VALID_INPUT, documento }),
      BadRequestError,
    );
    assert.equal(repository.calls.create.length, 0);
  }
});

test('sexo rejects anything other than M or F', async () => {
  for (const sexo of ['m', 'X']) {
    const repository = createFakeRepository();
    const useCase = new CreatePatient({ repository });

    await assert.rejects(
      () => useCase.execute({ ...VALID_INPUT, sexo }),
      BadRequestError,
    );
    assert.equal(repository.calls.create.length, 0);
  }
});

test('fecha_nacimiento rejects invalid, malformed, or future dates', async () => {
  for (const fecha_nacimiento of ['2026-02-31', '2023-02-29', '1990/04/12', '2999-01-01']) {
    const repository = createFakeRepository();
    const useCase = new CreatePatient({ repository });

    await assert.rejects(
      () => useCase.execute({ ...VALID_INPUT, fecha_nacimiento }),
      BadRequestError,
    );
    assert.equal(repository.calls.create.length, 0);
  }
});

test('email rejects malformed addresses', async () => {
  for (const email of ['not-an-email', 'missing-at.com', 'two@@at.com']) {
    const repository = createFakeRepository();
    const useCase = new CreatePatient({ repository });

    await assert.rejects(
      () => useCase.execute({ ...VALID_INPUT, email }),
      BadRequestError,
    );
    assert.equal(repository.calls.create.length, 0);
  }
});

test('email rejects addresses without a TLD with the shared message', async () => {
  for (const email of ['a@b', 'x@y', 'ana@mail']) {
    const repository = createFakeRepository();
    const useCase = new CreatePatient({ repository });

    await assert.rejects(
      () => useCase.execute({ ...VALID_INPUT, email }),
      (error) => {
        assert.ok(error instanceof BadRequestError);
        assert.equal(error.message, 'email must be a valid address');
        return true;
      },
    );
    assert.equal(repository.calls.create.length, 0);
  }
});

test('a whitespace-padded valid email is trimmed before lookup and persistence', async () => {
  const repository = createFakeRepository();
  const useCase = new CreatePatient({ repository });

  const created = await useCase.execute({ ...VALID_INPUT, email: '  ana@mail.com  ' });

  assert.equal(created.email, 'ana@mail.com');
  assert.equal(repository.calls.create[0].email, 'ana@mail.com');
});

test('duplicate documento throws ConflictError and never creates', async () => {
  const repository = createFakeRepository({
    existing: new Patient({ ...VALID_INPUT, id: 'uuid-existing', fechaNacimiento: '1990-04-12' }),
  });
  const useCase = new CreatePatient({ repository });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    { name: 'ConflictError', message: 'documento already exists: 35123456' },
  );
  assert.equal(repository.calls.findByDocumento.length, 1);
  assert.equal(repository.calls.create.length, 0);
});

test('validation rejects a payload before the duplicate check runs', async () => {
  const repository = createFakeRepository({
    existing: new Patient({ ...VALID_INPUT, id: 'uuid-existing', fechaNacimiento: '1990-04-12' }),
  });
  const useCase = new CreatePatient({ repository });

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, documento: '123' }),
    BadRequestError,
  );
  assert.equal(repository.calls.findByDocumento.length, 0);
  assert.equal(repository.calls.create.length, 0);
});

/** Mimics a pg unique_violation error (SQLSTATE 23505) with its constraint name. */
function uniqueViolation(constraint, message) {
  return Object.assign(new Error(message), { code: '23505', constraint });
}

test('a unique-violation race on the documento insert maps to ConflictError with a clean message', async () => {
  const repository = createFakeRepository({
    createThrows: uniqueViolation(
      'patients_documento_key',
      'duplicate key value violates unique constraint "patients_documento_key"',
    ),
  });
  const useCase = new CreatePatient({ repository });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (error) => {
      assert.ok(error instanceof ConflictError);
      assert.ok(!error.message.includes('duplicate key value'), 'raw pg text must not leak');
      assert.equal(error.message, 'documento already exists: 35123456');
      return true;
    },
  );
  assert.equal(repository.calls.create.length, 1, 'the insert attempt reached the repository');
});

test('a non-unique database error propagates unchanged', async () => {
  const dbError = Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
  const repository = createFakeRepository({ createThrows: dbError });
  const useCase = new CreatePatient({ repository });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (error) => {
      assert.equal(error, dbError, 'non-23505 errors are not swallowed');
      assert.ok(!(error instanceof ConflictError));
      return true;
    },
  );
});
