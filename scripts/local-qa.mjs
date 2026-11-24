import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELP = 'Usage: node scripts/local-qa.mjs --disposable [--smoke]\n' +
  'Starts a disposable Windows PostgreSQL 18 and a loopback API with synthetic Hygiene II drafts.\n' +
  '--smoke verifies the API and stops without issuing browser login credentials.\n';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write(HELP);
  process.exit(0);
}
function refuse(reason) {
  console.error(`QA_REFUSED: ${reason}`);
  process.exit(2);
}
if (args[0] !== '--disposable' || !(args.length === 1 || (args.length === 2 && args[1] === '--smoke'))) {
  refuse('use --help or --disposable [--smoke].');
}
if (Object.keys(process.env).some((key) => /^(PG|DATABASE_URL$|JWT_|ADMIN_|NODE_OPTIONS$|NODE_PATH$|NODE_PG_FORCE_NATIVE$)/i.test(key))) {
  refuse('remove inherited database, authentication, and Node loader overrides.');
}
if (process.platform !== 'win32') refuse('this command requires Windows and PostgreSQL 18.');
const smoke = args.length === 2;
const workspace = fileURLToPath(new URL('../', import.meta.url));
const bin = 'C:/Program Files/PostgreSQL/18/bin';
const systemBin = 'C:/Windows/System32';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(Path|SystemRoot|ComSpec|TEMP|TMP|TMPDIR|SystemDrive|WINDIR)$/i.test(k)));
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
const secret = () => randomBytes(32).toString('hex');
const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'salud-hygiene-qa-')));
const data = path.join(root, 'pgdata');
const pwFile = path.join(root, 'bootstrap-input');
const handoff = path.join(root, 'qa-login.txt');
const finish = path.join(root, 'finish');
let stage = 'private directory ACL', startAttempted = false, started = false, stopping = false, server, pool;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
function invoke(program, args, options = {}) {
  return spawnSync(program, args, { cwd: workspace, env, timeout: 85000, stdio: 'pipe', windowsHide: true, ...options });
}
function run(program, args, options = {}) {
  const result = invoke(program, args, options);
  if (result.status !== 0) throw new Error(`${stage} (${result.error?.code ?? result.status})`);
  return result.stdout;
}
function protectDirectory() {
  const sid = run(`${systemBin}/whoami.exe`, ['/user', '/fo', 'csv', '/nh']).toString().match(/"(S-1-5-21-(?:\d+-){3}\d+)"/i)?.[1];
  assert.ok(sid);
  const icacls = `${systemBin}/icacls.exe`;
  run(icacls, [root, '/grant:r', `*${sid}:(OI)(CI)F`]);
  run(icacls, [root, '/inheritance:r']);
  const acl = path.join(root, 'acl-proof');
  try {
    run(icacls, [root, '/save', acl]);
    const dacl = readFileSync(acl, 'utf16le').replace(/^\uFEFF/, '').split(/\r?\n/).find((line) => line.startsWith('D:'));
    if (![ `D:P(A;OICI;FA;;;${sid})`, `D:PAI(A;OICI;FA;;;${sid})` ].includes(dacl)) {
      throw Object.assign(new Error('ACL must be protected with only the current SID'), { code: 'DACL_NOT_EXCLUSIVE' });
    }
  } finally {
    rmSync(acl, { force: true });
  }
  console.log('QA_PRIVATE_ACL_VERIFIED');
}
async function reservePort() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve,reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}
try {
  protectDirectory();
  stage = 'runtime dependencies';
  const { register } = await import('tsx/esm/api');
  register();
  const { default: pg } = await import('pg');
  const { seed } = await import('./local-qa-hygiene-fixture.mjs');
  stage = 'initdb';
  const dbPassword = secret();
  writeFileSync(pwFile, `${dbPassword}\n`, { flag: 'wx', mode: 0o600 });
  try {
    run(`${bin}/initdb.exe`, ['-D', data, '-U', 'qa_owner', '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256', '--pwfile', pwFile]);
  } finally {
    rmSync(pwFile, { force: true });
  }
  stage = 'PostgreSQL startup';
  const port = await reservePort();
  startAttempted = true;
  run(`${bin}/pg_ctl.exe`, ['-D', data, '-l', path.join(root, 'postgres.log'), '-w', '-t', '30', '-o', `-h 127.0.0.1 -p ${port}`, 'start']);
  started = true;
  stage = 'cluster identity';
  const baseDb = new URL(`postgresql://qa_owner:${dbPassword}@127.0.0.1:${port}/postgres`);
  const maintenance = new pg.Client({ connectionString: baseDb.href, connectionTimeoutMillis: 5000, statement_timeout: 8000 });
  await maintenance.connect();
  try {
    const { rows: [id] } = await maintenance.query("SELECT current_database() AS db, current_user AS owner, host(inet_server_addr()) AS ip, inet_server_port() AS port, current_setting('data_directory') AS dir");
    assert.equal(id.db, 'postgres');
    assert.equal(id.owner, 'qa_owner');
    assert.equal(id.ip, '127.0.0.1');
    assert.equal(id.port, port);
    assert.equal(realpathSync(id.dir), realpathSync(data));
    await maintenance.query('CREATE DATABASE salud_hygiene_qa');
  } finally {
    await maintenance.end();
  }
  baseDb.pathname = '/salud_hygiene_qa';
  Object.assign(env, { NODE_ENV: 'test', APP_ENV: 'test', DATABASE_URL: baseDb.href, JWT_SECRET: secret(), CLIENT_URL: 'http://127.0.0.1:4610', BCRYPT_COST: '4', JWT_EXPIRES_IN: '45m' });
  stage = 'migrations';
  run(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts']);
  console.log('QA_MIGRATIONS_OK');
  const account = { username: 'QAHYGIENEADMIN', password: `Qa${secret()}9` };
  stage = 'admin bootstrap';
  run(process.execPath, ['--import', 'tsx', 'src/scripts/create-admin.ts'], { env: { ...env, ADMIN_USERNAME: account.username, ADMIN_PASSWORD: account.password } });
  stage = 'API startup';
  Object.assign(process.env, env, { JWT_SECRET_KID: 'current', JWT_PREVIOUS_SECRETS: '[]', PORT: '0' });
  const { createApp } = await import('../src/app.ts');
  pool = new pg.Pool({ connectionString: baseDb.href, connectionTimeoutMillis: 5000 });
  server = createApp(pool).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const api = `http://127.0.0.1:${server.address().port}`;
  stage = 'synthetic seed and public readback';
  assert.equal((await fetch(api, { signal: AbortSignal.timeout(5000) })).status, 200);
  const a = await seed(api, account.username, account.password);
  const b = await seed(api, account.username, account.password);
  assert.notEqual(a.subject_id, b.subject_id);
  assert.notEqual(a.academic_group_id, b.academic_group_id);
  const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account), signal: AbortSignal.timeout(5000) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  async function ids(query) {
    const res = await fetch(`${api}/hygiene-preventive-drafts?${new URLSearchParams(query)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 200);
    return (await res.json()).items.map(({ id }) => String(id)).sort();
  }
  assert.deepEqual(await ids({}), [a.draftId, b.draftId].sort());
  assert.deepEqual(await ids({ subject_id: a.subject_id }), [a.draftId]);
  assert.deepEqual(await ids({ academic_group_id: b.academic_group_id }), [b.draftId]);
  assert.deepEqual(await ids({ subject_id: b.subject_id, academic_group_id: b.academic_group_id }), [b.draftId]);
  assert.deepEqual(await ids({ subject_id: a.subject_id, academic_group_id: b.academic_group_id }), []);
  if (smoke) {
    console.log('QA_SMOKE_OK drafts=2 public_filter_checks=5');
  } else {
    writeFileSync(handoff, `Username: ${account.username}\nPassword: ${account.password}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`QA_READY api=${api} drafts=2 public_filter_checks=5 expires_minutes=24`);
    console.log(`QA_LOCAL_LOGIN_FILE ${handoff}`);
    console.log(`QA_FINISH_MARKER ${finish}`);
    const until = Date.now() + 24 * 60 * 1000;
    await new Promise((resolve) => {
      const tick = setInterval(() => {
        if (stopping || existsSync(finish) || Date.now() >= until) { clearInterval(tick); resolve(); }
      }, 500);
    });
  }
} catch (error) {
  console.error(`QA_FAILED stage=${stage} kind=${error.code ?? error.name}`);
  process.exitCode = 1;
} finally {
  if (server?.listening) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  if (pool) await pool.end();
  rmSync(handoff, { force: true });
  const ctl = `${bin}/pg_ctl.exe`;
  let safeToRemove = !startAttempted;
  if (startAttempted) {
    try {
      stage = 'own cluster stop';
      if (started || existsSync(path.join(data, 'postmaster.pid'))) {
        run(ctl, ['-D', data, '-w', '-t', '30', '-m', 'fast', 'stop']);
      }
      const state = invoke(ctl, ['-D', data, 'status']);
      safeToRemove = !state.error && state.status === 3 && !existsSync(path.join(data, 'postmaster.pid'));
    } catch {
      safeToRemove = false;
    }
  }
  if (safeToRemove) {
    rmSync(root, { recursive: true, force: true });
    console.log('QA_STOPPED_AND_REMOVED');
  } else {
    console.error(`QA_STOP_UNVERIFIED restricted_directory=${root}; no login file retained`);
    process.exitCode = 1;
  }
}
