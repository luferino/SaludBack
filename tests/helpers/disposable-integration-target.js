import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

export const DISPOSABLE_DATABASE_PATTERN = /^salud_e2e_[a-f0-9]{16}$/;
export const DISPOSABLE_MANIFEST_DIRECTORY = path.join('.git', 'gentle-scratch', 'disposable-integration');
const HASH_PATTERN = /^[a-f0-9]{64}$/;
export const REQUIRED_EMPTY_BASELINE_TABLES = [
  'kinesiology_evolution_correction_requests','kinesiology_evolution_validation_reviews','kinesiology_evolution_submissions',
  'kinesiology_evaluation_correction_requests','kinesiology_evaluation_validation_reviews','kinesiology_evaluation_submission_studies',
  'kinesiology_evaluation_submissions','kinesiology_consent_attestations','kinesiology_evaluation_amendment_links',
  'kinesiology_evolution_amendment_links','kinesiology_evolutions','kinesiology_evaluations','patient_assignments','patient_context_availabilities','student_academic_habilitations',
  'teacher_academic_habilitations','students','teachers','subject_academic_groups','academic_groups','subjects',
  'oral_surgery_authorizations', 'oral_surgery_consent_declarations', 'oral_surgery_drafts', 'oral_surgery_subjects','reception_career_grants','clinical_records','patients','password_reset_tokens','users',
];
const MIGRATIONS = [
  'create_users.sql','create_patients.sql','add_email_and_reset_tokens.sql','multi_role_and_audit.sql','user_id_unique_profiles.sql',
  'create_permission_matrix.sql','seed_permission_matrix.sql','create_clinical_records.sql','create_academic_contexts.sql',
  'create_academic_habilitations.sql','seed_subject_permissions.sql','seed_group_permissions.sql','seed_subject_group_permissions.sql',
  'seed_teacher_habilitation_permissions.sql','seed_teacher_habilitation_revocation_permission.sql','seed_student_habilitation_permissions.sql',
  'create_patient_assignments.sql','seed_patient_assignment_permissions.sql','seed_student_habilitation_revocation_permission.sql',
  'create_kinesiology_evaluations.sql','seed_kinesiology_evaluation_permissions.sql','create_kinesiology_consent_attestations.sql',
  'create_kinesiology_submissions.sql','create_kinesiology_correction_requests.sql','create_kinesiology_validation_reviews.sql',
  'create_kinesiology_amendment_links.sql','seed_profile_read_permissions.sql','seed_habilitation_read_permissions.sql',
  'create_patient_context_availabilities.sql','seed_patient_availability_permissions.sql','create_kinesiology_evolutions.sql','seed_kinesiology_evolution_permissions.sql',
  'create_kinesiology_evolution_reviews.sql','seed_kinesiology_evolution_review_permissions.sql',
  'create_kinesiology_evolution_amendment_links.sql',
  'create_careers.sql', 'seed_career_permissions.sql','create_oral_surgery_subjects.sql','seed_oral_surgery_subject_permissions.sql','create_oral_surgery_drafts.sql','seed_oral_surgery_draft_permissions.sql','create_oral_surgery_consent_declarations.sql','create_oral_surgery_authorizations.sql','seed_oral_surgery_authorization_permission.sql','create_reception_access.sql',
].map((name, index) => `${String(index + 1).padStart(3, '0')}_${name}`);

function reject(message) {
  const error = new Error(message);
  error.code = 'DISPOSABLE_TARGET_INVALID';
  throw error;
}

function address(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase();
  return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
}

function isLoopback(value) {
  const ip = address(value);
  return net.isIP(ip) === 4 ? ip.startsWith('127.') : ip === '::1';
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

export function validateDisposableTargetEnvironment(env) {
  if (env?.DISPOSABLE_INTEGRATION_TARGET !== 'true') reject('explicit disposable-target opt-in required');
  const connectionString = env.DISPOSABLE_INTEGRATION_DATABASE_URL;
  if (typeof connectionString !== 'string' || !connectionString || env.DATABASE_URL !== connectionString) reject('disposable database environment binding mismatch');
  if (/production/i.test(env.NODE_ENV ?? '') || /production/i.test(env.APP_ENV ?? '')) reject('production runtime is forbidden');
  if (Object.keys(env).some((name) => name.toUpperCase().startsWith('PG') || name.toUpperCase() === 'NODE_PG_FORCE_NATIVE')) reject('inherited PostgreSQL connection overrides are forbidden');
  let url;
  try { url = new URL(connectionString); } catch { reject('disposable database URL is invalid'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.username || !url.password || !url.port
      || url.search || url.hash || !isLoopback(url.hostname)) reject('disposable database URL must be credentialed, plain, and loopback');
  let databaseName;
  try { databaseName = decodeURIComponent(url.pathname.slice(1)); } catch { reject('disposable database name is invalid'); }
  if (!DISPOSABLE_DATABASE_PATTERN.test(databaseName)) reject('generated disposable database name required');
  return Object.freeze({ databaseName });
}

/**
 * Validate the explicit disposable target before a caller connects or writes.
 * The caller must read the manifest without following symlinks and supply the
 * realpath/symlink facts below; it must create new manifests with exclusive
 * creation. The return value is a sanitized identity descriptor, never a URL.
 * Errors contain no caller-supplied values.
 */
export function validateDisposableTarget({
  env,
  cwd,
  manifestPath,
  manifestRealPath,
  manifestPathHasSymlink,
  manifest,
  identity,
  schemaFingerprint,
  emptyBaseline,
}) {
  const { databaseName } = validateDisposableTargetEnvironment(env);
  const connectionString = env.DISPOSABLE_INTEGRATION_DATABASE_URL;
  const url = new URL(connectionString);

  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) reject('canonical in-project non-symlink manifest required');
  const expectedPath = path.resolve(cwd, DISPOSABLE_MANIFEST_DIRECTORY,
    `manifest-${databaseName.slice('salud_e2e_'.length)}.json`);
  if (!samePath(manifestPath ?? '', expectedPath)
      || !samePath(manifestRealPath ?? '', expectedPath) || manifestPathHasSymlink !== false) {
    reject('canonical in-project non-symlink manifest required');
  }
  const database = manifest?.database;
  if (manifest?.format !== 1 || manifest.createdByRun !== true || manifest.creationMode !== 'exclusive'
      || database?.createdByRun !== true || database.name !== databaseName
      || !/^\d+$/.test(String(database.oid ?? '')) || !database.owner
      || !HASH_PATTERN.test(database.schemaFingerprint ?? '')) {
    reject('fresh created-database manifest mismatch');
  }
  if (!identity || identity.databaseName !== database.name || String(identity.databaseOid) !== String(database.oid)
      || identity.databaseOwner !== database.owner || identity.databaseUser !== decodeURIComponent(url.username)
      || !isLoopback(identity.serverAddress) || !isLoopback(database.serverAddress)
      || address(identity.serverAddress) !== address(database.serverAddress)
      || Number(identity.serverPort) !== Number(database.serverPort)
      || Number(identity.serverPort) !== Number(url.port)) {
    reject('live disposable database identity mismatch');
  }
  if (!HASH_PATTERN.test(schemaFingerprint ?? '') || schemaFingerprint !== database.schemaFingerprint) {
    reject('live schema fingerprint mismatch');
  }
  if (!emptyBaseline || typeof emptyBaseline !== 'object'
      || Object.keys(emptyBaseline).length !== REQUIRED_EMPTY_BASELINE_TABLES.length
      || REQUIRED_EMPTY_BASELINE_TABLES.some((table) => !Object.hasOwn(emptyBaseline, table)
        || !Number.isInteger(emptyBaseline[table]) || emptyBaseline[table] !== 0)) {
    reject('complete disposable database empty baseline required');
  }

  return Object.freeze({
    databaseName,
    manifestPath: expectedPath,
    identity: Object.freeze({
      databaseName: database.name,
      databaseOid: String(database.oid),
      databaseOwner: database.owner,
      serverAddress: address(database.serverAddress),
      serverPort: Number(database.serverPort),
    }),
    schemaFingerprint,
  });
}

function readCanonicalManifest(cwd, databaseName) {
  const manifestPath = path.resolve(cwd, DISPOSABLE_MANIFEST_DIRECTORY,
    `manifest-${databaseName.slice('salud_e2e_'.length)}.json`);
  try {
    if (fs.realpathSync(cwd) !== path.resolve(cwd)) reject('project root is not canonical');
    let current = path.resolve(cwd);
    for (const part of [...DISPOSABLE_MANIFEST_DIRECTORY.split(path.sep), path.basename(manifestPath)]) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) reject('manifest path contains a symbolic link');
      if (current !== manifestPath && !stat.isDirectory()) reject('manifest path is not canonical');
    }
    if (!samePath(fs.realpathSync(manifestPath), manifestPath)) reject('manifest path is not canonical');
    return { manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
  } catch (error) {
    if (error?.code === 'DISPOSABLE_TARGET_INVALID') throw error;
    reject('fresh disposable manifest is unavailable');
  }
}

export async function computeDisposableSchemaFingerprint(client) {
  const relations = await client.query(`SELECT c.relname,c.relkind,
      coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
        'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FILTER (WHERE a.attnum>0),'[]'::jsonb) AS columns,
      coalesce((SELECT jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,
        'definition',pg_get_constraintdef(k.oid,true)) ORDER BY k.conname)
        FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),'[]'::jsonb) AS constraints
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
    GROUP BY c.oid ORDER BY c.relname`);
  const indexes = await client.query("SELECT indexname,indexdef FROM pg_catalog.pg_indexes WHERE schemaname='public' ORDER BY indexname");
  return createHash('sha256').update(JSON.stringify({ relations: relations.rows, indexes: indexes.rows })).digest('hex');
}

export async function verifyDisposableIntegrationTarget({ env = process.env, cwd = process.cwd() } = {}) {
  const { databaseName } = validateDisposableTargetEnvironment(env);
  const connectionString = env.DISPOSABLE_INTEGRATION_DATABASE_URL;
  const { manifestPath, manifest } = readCanonicalManifest(cwd, databaseName);
  let manifestRealPath;
  try { manifestRealPath = fs.realpathSync(manifestPath); } catch { reject('fresh disposable manifest is unavailable'); }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000,
    query_timeout: 6000, options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=5000' });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`SELECT current_database() AS "databaseName",current_user AS "databaseUser",
      (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOid",
      (SELECT pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOwner",
      inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort",
      inet_client_addr()::text AS peer,current_setting('transaction_read_only') AS readonly`);
    const identity = rows[0], socket = client.connection.stream;
    if (rows.length !== 1 || identity.readonly !== 'on' || !isLoopback(identity.peer)
        || !isLoopback(socket.remoteAddress) || !isLoopback(socket.localAddress)
        || address(socket.remoteAddress) !== address(identity.serverAddress)) reject('read-only disposable socket identity mismatch');
    const schemaFingerprint = await computeDisposableSchemaFingerprint(client);
    const baselineResult = await client.query(`SELECT ${REQUIRED_EMPTY_BASELINE_TABLES.map((table) =>
      `(SELECT count(*)::int FROM public."${table}") AS "${table}"`).join(',')}`);
    const emptyBaseline = baselineResult.rows[0];
    const ledger = await client.query('SELECT name FROM public.schema_migrations ORDER BY name');
    if (JSON.stringify(ledger.rows.map(({ name }) => name)) !== JSON.stringify(MIGRATIONS)) reject('exact migration ledger mismatch');
    await client.query('ROLLBACK');
    return validateDisposableTarget({ env, cwd, manifestPath, manifestRealPath,
      manifestPathHasSymlink: false, manifest, identity, schemaFingerprint, emptyBaseline });
  } catch (error) {
    if (error?.code === 'DISPOSABLE_TARGET_INVALID') throw error;
    reject('read-only disposable-target preflight failed');
  } finally {
    try { await client.end(); } catch { reject('read-only disposable connection could not close cleanly'); }
  }
}
