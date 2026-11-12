import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import { CreatePatient } from '../../../patients/application/create-patient.usecase.js';
import type { CreatePatientInput } from '../../../patients/application/create-patient.usecase.js';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../../shared/domain/errors.js';
import { normalizeEmail } from '../../../shared/domain/validation.js';
import { PermissionGuard } from '../../../shared/application/guard.js';
import type { Guard } from '../../../shared/application/guard.js';
import type { ReceptionPatientRepository } from '../../application/reception-patients.ports.js';
import { listSearchQuery } from '../../../shared/infrastructure/list-search-query.js';
import { defaultGetActor } from '../../../shared/infrastructure/default-get-actor.js';
import type { AuthenticatedRequest } from '../../../shared/application/authenticated-request.js';
import type { Queryable } from '../../../shared/application/unit-of-work.js';
import type { Patient } from '../../../patients/domain/patient.entity.js';

const CAREERS = new Set(['kinesiology', 'odontology']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createReceptionPatientRouter({ repository, guard = new PermissionGuard('reception:patients:manage'), getActor = defaultGetActor, authenticate }: {
  repository: ReceptionPatientRepository; guard?: Guard; getActor?: (req: Request) => Promise<string | null>; authenticate?: RequestHandler;
}): Router {
  const router = Router();
  const authentication = authenticate ? [authenticate] : [];
  const actor = async (req: Request): Promise<string> => {
    await guard.authorize(req);
    const auth = (req as AuthenticatedRequest).auth;
    const id = await getActor(req);
    if (auth?.role !== 'reception') throw new ForbiddenError('Reception role required');
    if (!id || !UUID.test(id)) throw new UnauthorizedError('verified Reception actor is required');
    return id;
  };
  const career = (value: unknown): string => {
    if (typeof value !== 'string' || !CAREERS.has(value)) throw new BadRequestError('career must be kinesiology or odontology');
    return value;
  };
  const inScope = <T>(req: Request, userId: string, scope: string, work: (db: Queryable) => Promise<T>): Promise<T> => repository.withActiveCareerScope(userId, scope, work, (req as AuthenticatedRequest).auth?.roleGrantId);
  const pathId = (value: string | string[]): string => {
    if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestError('id must be a UUID');
    return value;
  };

  router.post('/match', ...authentication, async (req: Request, res: Response) => {
    const userId = await actor(req), scope = career(req.body?.career);
    const documento = typeof req.body?.documento === 'string' || typeof req.body?.documento === 'number' ? String(req.body.documento).trim() : '';
    if (!/^\d{4,8}$/.test(documento)) throw new BadRequestError('documento must be 4-8 digits');
    const match = await inScope<{ id: string } | null>(req, userId, scope, db => repository.matchByDocumento(db, documento));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(match ? { match: true, patient_id: match.id } : { match: false });
  });
  router.post('/reuse', ...authentication, async (req: Request, res: Response) => {
    const userId = await actor(req), scope = career(req.body?.career), id = req.body?.patient_id;
    if (typeof id !== 'string' || !UUID.test(id)) throw new BadRequestError('patient_id must be a UUID');
    const documento = typeof req.body?.documento === 'string' || typeof req.body?.documento === 'number' ? String(req.body.documento).trim() : '';
    if (!/^\d{4,8}$/.test(documento)) throw new BadRequestError('documento must be 4-8 digits');
    await inScope(req, userId, scope, async db => {
      const match = await repository.matchByDocumento(db, documento);
      if (!match || match.id !== id) throw new NotFoundError('matching patient was not found');
      await repository.enrollExisting(db, id, scope);
    });
    res.status(200).json({ patient_id: id, career: scope, enrolled: true });
  });
  router.post('/register', ...authentication, async (req: Request, res: Response) => {
    const userId = await actor(req);
    const body = registrationBody(req.body);
    const scope = career(body.career);
    const patient = await inScope<Patient>(req, userId, scope, async db => {
      const input = validateRegistrationInput(body);
      const useCase = new CreatePatient({ repository: {
        findByDocumento: documento => repository.findPatientByDocumento(db, documento),
        create: value => repository.createAndEnroll(db, value, scope),
      } });
      return useCase.execute({ ...input, createdBy: userId });
    });
    res.status(201).json(serializePatient(patient));
  });
  router.get('/', ...authentication, async (req: Request, res: Response) => {
    const userId = await actor(req), scope = career(req.query.career);
    const { q, limit, offset } = listSearchQuery(req, 100, ['career']);
    const items = await inScope<Patient[]>(req, userId, scope, db => repository.list(db, scope, limit, offset, q));
    res.setHeader('Cache-Control', 'no-store'); res.status(200).json({ items: items.map(serializePatient), limit, offset });
  });
  router.get('/:id', ...authentication, async (req: Request, res: Response) => {
    const userId = await actor(req), scope = career(req.query.career);
    const id = pathId(req.params.id);
    const patient = await inScope<Patient | null>(req, userId, scope, db => repository.findEnrolled(db, id, scope));
    if (!patient) throw new NotFoundError('enrolled patient was not found');
    res.setHeader('Cache-Control', 'no-store'); res.status(200).json(serializePatient(patient));
  });
  router.patch('/:id', ...authentication, async (req: Request, res: Response) => {
    const userId = await actor(req), scope = career(req.query.career);
    const id = pathId(req.params.id);
    const body = req.body ?? {}, allowed = new Set(['email', 'celular', 'direccion']);
    if (Object.keys(body).some(key => !allowed.has(key))) throw new BadRequestError('only email, celular and direccion may be updated');
    if (!Object.keys(body).length || Object.values(body).some(value => typeof value !== 'string')) throw new BadRequestError('contact fields must be strings');
    for (const field of ['celular', 'direccion'] as const) {
      if (body[field] !== undefined && !(body[field] as string).trim()) throw new BadRequestError(`${field} is required`);
    }
    const updated = await inScope<Patient | null>(req, userId, scope, async db => {
      const current = await repository.findEnrolled(db, id, scope);
      if (!current) throw new NotFoundError('enrolled patient was not found');
      const email = body.email === undefined ? current.email : normalizeEmail(body.email);
      if (email === null) throw new BadRequestError('email is required');
      return repository.updateContact(db, id, scope, { email, celular: body.celular ?? current.celular, direccion: body.direccion ?? current.direccion }, userId);
    });
    if (!updated) throw new NotFoundError('enrolled patient was not found');
    res.status(200).json(serializePatient(updated));
  });
  return router;
}

function registrationBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestError('patient body must be an object');
  }
  return value as Record<string, unknown>;
}

function validateRegistrationInput(body: Record<string, unknown>): Omit<CreatePatientInput, 'createdBy'> {
  const document = body.documento;
  if (document === undefined || document === null || (typeof document === 'string' && document.trim() === '')) {
    throw new BadRequestError('documento is required');
  }
  if (typeof document !== 'string' && typeof document !== 'number') {
    throw new BadRequestError('documento must be a string or number');
  }
  const requiredString = (field: 'nombres' | 'apellidos' | 'fecha_nacimiento' | 'email' | 'celular' | 'sexo' | 'direccion'): string => {
    const value = body[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      throw new BadRequestError(`${field} is required`);
    }
    if (typeof value !== 'string') throw new BadRequestError(`${field} must be a string`);
    return value;
  };
  return {
    documento: document,
    nombres: requiredString('nombres'),
    apellidos: requiredString('apellidos'),
    fecha_nacimiento: requiredString('fecha_nacimiento'),
    email: requiredString('email'),
    celular: requiredString('celular'),
    sexo: requiredString('sexo'),
    direccion: requiredString('direccion'),
  };
}

function serializePatient(patient: Patient) {
  return {
    id: patient.id,
    documento: patient.documento,
    nombres: patient.nombres,
    apellidos: patient.apellidos,
    fecha_nacimiento: patient.fechaNacimiento || null,
    email: patient.email,
    celular: patient.celular,
    sexo: patient.sexo,
    direccion: patient.direccion,
  };
}
