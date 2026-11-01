import path from 'node:path';
import net from 'node:net';

export const DISPOSABLE_DATABASE_PATTERN = /^salud_e2e_[a-f0-9]{16}$/;
export const DISPOSABLE_MANIFEST_DIRECTORY = path.join('.git', 'gentle-scratch', 'disposable-integration');
const HASH_PATTERN = /^[a-f0-9]{64}$/;

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
  if (env?.DISPOSABLE_INTEGRATION_TARGET !== 'true') reject('explicit disposable-target opt-in required');
  const connectionString = env.DISPOSABLE_INTEGRATION_DATABASE_URL;
  if (typeof connectionString !== 'string' || !connectionString || env.DATABASE_URL !== connectionString) {
    reject('disposable database environment binding mismatch');
  }
  if (/production/i.test(env.NODE_ENV ?? '') || /production/i.test(env.APP_ENV ?? '')) {
    reject('production runtime is forbidden');
  }
  if (Object.keys(env).some((name) => name.toUpperCase().startsWith('PG')
      || name.toUpperCase() === 'NODE_PG_FORCE_NATIVE')) {
    reject('inherited PostgreSQL connection overrides are forbidden');
  }

  let url;
  try { url = new URL(connectionString); } catch { reject('disposable database URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password
      || !url.port || url.search || url.hash || !isLoopback(url.hostname)) {
    reject('disposable database URL must be credentialed, plain, and loopback');
  }
  let databaseName;
  try { databaseName = decodeURIComponent(url.pathname.slice(1)); } catch { reject('disposable database name is invalid'); }
  if (!DISPOSABLE_DATABASE_PATTERN.test(databaseName)) reject('generated disposable database name required');

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
      || Object.keys(emptyBaseline).length === 0
      || Object.values(emptyBaseline).some((count) => !Number.isInteger(count) || count !== 0)) {
    reject('disposable database empty baseline required');
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
