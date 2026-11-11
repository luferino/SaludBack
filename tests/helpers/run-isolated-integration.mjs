import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  DISPOSABLE_DATABASE_PATTERN, DISPOSABLE_MANIFEST_DIRECTORY, REQUIRED_EMPTY_BASELINE_TABLES,
  computeDisposableSchemaFingerprint, validateDisposableTarget, verifyDisposableIntegrationTarget,
} from './disposable-integration-target.js';

const ROOT = process.cwd();
const OPTIONS = '-c statement_timeout=5000 -c lock_timeout=1500';
const safe = (message) => { const error = new Error(message); error.safe = true; throw error; };
const norm = (value) => value?.replace(/^::ffff:/, '').replace(/^\[|\]$/g, '').split('/')[0].toLowerCase();
const loopback = (value) => { const ip = norm(value); return net.isIP(ip) === 4 ? ip.startsWith('127.') : ip === '::1'; };
function discoverIntegrationSuites() {
  const integrationRoot = path.join(ROOT, 'tests', 'integration');
  const suites = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) safe('integration test discovery refuses symbolic links');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) {
        suites.push(path.relative(ROOT, file).split(path.sep).join('/'));
      }
    }
  };
  visit(integrationRoot);
  suites.sort((a, b) => a.localeCompare(b));
  if (suites.length === 0) safe('no integration test files discovered');
  return suites;
}
const usage = `Usage: node tests/helpers/run-isolated-integration.mjs --disposable
Requires DISPOSABLE_INTEGRATION_TARGET=true. Creates a fresh salud_e2e_<16 hex> database, migrates it, and runs every sorted tests/integration/**/*.test.js file (including history-dependent fixtures) without skipping failures. It migrates the current full ledger 001–048, then drops only this run's exact database identity when it has zero connections. Never points writes at .env.test's database.
Upgrade-only mode: node tests/helpers/run-isolated-integration.mjs --disposable --career-upgrade-rehearsal
Applies 001–035, seeds synthetic legacy data, then applies 036/037 and checks preservation, backfill, constraints and grants instead of running the full suite. Uses the same target guards and cleanup.`;
function preflight(args, env) {
  if (args.includes('--help')) { console.log(usage); process.exit(0); }
  if (args[0] !== '--disposable' || !(args.length === 1 || (args.length === 2 && args[1] === '--career-upgrade-rehearsal'))) safe('use the explicit --disposable option (or --help)');
  if (env.DISPOSABLE_INTEGRATION_TARGET !== 'true') safe('explicit disposable-target opt-in required');
  const injected = Object.keys(env).find((key) => {
    const upper = key.toUpperCase();
    return upper.startsWith('PG') || upper.startsWith('JWT_') || upper.startsWith('API_') || upper.startsWith('TOKEN_')
      || upper.startsWith('ACCESS_') || upper.startsWith('SUBJECTS_TEST_') || upper.startsWith('SUBJECT_GROUPS_TEST_')
      || upper.startsWith('GROUPS_TEST_') || upper.startsWith('PATIENT_AVAILABILITY_')
      || (upper.startsWith('DISPOSABLE_INTEGRATION_') && upper!=='DISPOSABLE_INTEGRATION_TARGET')
      || ['NODE_PG_FORCE_NATIVE','DATABASE_URL','CLIENT_URL'].includes(upper);
  });
  if (injected) safe('ambient database or application credentials are forbidden; use a clean shell');
  if (!fs.existsSync(path.join(ROOT, 'package.json')) || !fs.existsSync(path.join(ROOT, 'src', 'db', 'migrate.ts'))) safe('run from the project root');
}
function sourceUrl() {
  const text = fs.readFileSync(path.join(ROOT, '.env.test'), 'utf8');
  const rows = text.split(/\r?\n/).map((line) => line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$/)).filter(Boolean);
  if (rows.length !== 1) safe('could not safely parse the single .env.test DATABASE_URL');
  const raw = rows[0][1], value = raw.replace(/^("|')(.*)\1$/, '$2');
  let url;
  try { url = new URL(value); } catch { safe('.env.test DATABASE_URL is invalid'); }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.username || !url.password || !url.port
      || url.search || url.hash || !['localhost','127.0.0.1','::1'].includes(norm(url.hostname))
      || database !== 'saludback_test') safe('.env.test must identify the unchanged loopback test source');
  return url;
}
function safeDirectory() {
  let current = ROOT;
  for (const part of ['.git','gentle-scratch','disposable-integration']) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) safe('manifest directory must be canonical and non-symlinked');
    } catch (error) {
      if (error.code !== 'ENOENT' || part !== 'disposable-integration') safe('manifest directory cannot be verified');
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  if (fs.realpathSync(current) !== current) safe('manifest directory is not canonical');
  return current;
}
export function makeEnvironment(databaseUrl, targetFingerprint = '') {
  const env = Object.fromEntries(['PATH','SystemRoot','ComSpec','TEMP','TMP','TMPDIR'].filter((k) => process.env[k]).map((k) => [k,process.env[k]]));
  const secret = crypto.randomBytes(48).toString('base64url');
  Object.assign(env, { NODE_ENV:'test', APP_ENV:'test', DATABASE_URL:databaseUrl, JWT_SECRET:secret,
    JWT_PREVIOUS_SECRETS:'[]', JWT_SECRET_KID:'current', JWT_EXPIRES_IN:'2h', CLIENT_URL:'http://127.0.0.1:4610',
    BCRYPT_COST:'4', RESET_TOKEN_TTL:'15', RESET_TOKEN_MAX_OUTSTANDING:'3', PORT:'0',
    DISPOSABLE_INTEGRATION_TARGET:'true', DISPOSABLE_INTEGRATION_DATABASE_URL:databaseUrl,
    SUBJECTS_TEST_ISOLATED:'true', SUBJECTS_TEST_DATABASE_URL:databaseUrl, SUBJECTS_TEST_JWT_SECRET:secret,
    SUBJECTS_TEST_CLIENT_URL:'http://127.0.0.1:4610', SUBJECTS_TEST_JWT_SECRET_KID:'current',
    SUBJECTS_TEST_JWT_EXPIRES_IN:'2h', SUBJECTS_TEST_BCRYPT_COST:'4', SUBJECTS_TEST_RESET_TOKEN_TTL:'15',
    SUBJECTS_TEST_RESET_TOKEN_MAX_OUTSTANDING:'3', SUBJECT_GROUPS_TEST_ISOLATED:'true',
    SUBJECT_GROUPS_TEST_DATABASE_URL:databaseUrl, SUBJECT_GROUPS_TEST_EXPECTED_DATABASE:new URL(databaseUrl).pathname.slice(1),
    SUBJECT_GROUPS_TEST_EXPECTED_SCHEMA:'public', SUBJECT_GROUPS_TEST_EXPECTED_TARGET_FINGERPRINT:targetFingerprint,
    SUBJECT_GROUPS_TEST_JWT_SECRET:secret, SUBJECT_GROUPS_TEST_CLIENT_URL:'http://127.0.0.1:4610',
    SUBJECT_GROUPS_TEST_JWT_SECRET_KID:'current', SUBJECT_GROUPS_TEST_JWT_EXPIRES_IN:'2h',
    SUBJECT_GROUPS_TEST_BCRYPT_COST:'4', SUBJECT_GROUPS_TEST_RESET_TOKEN_TTL:'15',
    SUBJECT_GROUPS_TEST_RESET_TOKEN_MAX_OUTSTANDING:'3',
    GROUPS_TEST_ISOLATED:'true', GROUPS_TEST_DATABASE_URL:databaseUrl,
    GROUPS_TEST_EXPECTED_DATABASE:new URL(databaseUrl).pathname.slice(1), GROUPS_TEST_EXPECTED_SCHEMA:'public',
    GROUPS_TEST_EXPECTED_TARGET_FINGERPRINT:targetFingerprint, GROUPS_TEST_JWT_SECRET:secret,
    GROUPS_TEST_CLIENT_URL:'http://127.0.0.1:4610', GROUPS_TEST_JWT_SECRET_KID:'current',
    GROUPS_TEST_JWT_EXPIRES_IN:'2h', GROUPS_TEST_BCRYPT_COST:'4',
    GROUPS_TEST_RESET_TOKEN_TTL:'15', GROUPS_TEST_RESET_TOKEN_MAX_OUTSTANDING:'3',
    PATIENT_AVAILABILITY_DISPOSABLE_DATABASE_URL:databaseUrl });
  return env;
}
async function identify(client, resolved) {
  await client.query('BEGIN READ ONLY');
  const { rows } = await client.query(`SELECT current_database() AS db,current_user AS usr,
    inet_server_addr()::text AS server,inet_server_port() AS port,inet_client_addr()::text AS peer,
    current_setting('transaction_read_only') AS readonly,
    (SELECT rolcreatedb OR rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AS can_create`);
  if (rows.length !== 1) safe('read-only maintenance identity is not verified loopback');
  const id = rows[0], socket = client.connection.stream;
  if (id.db !== 'postgres' || id.readonly !== 'on' || !id.can_create
      || !loopback(id.server) || !loopback(id.peer) || !loopback(socket.remoteAddress) || !loopback(socket.localAddress)
      || norm(id.server) !== norm(socket.remoteAddress) || norm(id.peer) !== norm(socket.localAddress)
      || Number(id.port) !== Number(socket.remotePort) || !resolved.some((r) => norm(r.address) === norm(id.server))) safe('read-only maintenance identity is not verified loopback');
  return { ...id, user:id.usr };
}
export async function verifyCreatorSocket(client, resolved, maintenance) {
  await client.query('BEGIN READ ONLY');
  const check=await client.query(`SELECT current_database() db,current_user usr,inet_server_addr()::text server,inet_server_port() port,
    inet_client_addr()::text peer,current_setting('transaction_read_only') readonly,
    (SELECT rolcreatedb OR rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) can_create`);
  const socket=client.connection?.stream, id=check.rows[0];
  if (check.rows.length!==1 || !socket || id.db!=='postgres'||id.usr!==maintenance.user||id.readonly!=='on'||!id.can_create
      ||!loopback(id.server)||!loopback(id.peer)||!loopback(socket.remoteAddress)||!loopback(socket.localAddress)
      ||norm(id.server)!==norm(socket.remoteAddress)||norm(id.peer)!==norm(socket.localAddress)
      ||Number(id.port)!==Number(socket.remotePort)||norm(id.server)!==norm(maintenance.server)||Number(id.port)!==Number(maintenance.port)
      ||!resolved.some((r)=>norm(r.address)===norm(id.server))) safe('fresh creator socket identity is not verified loopback');
  await client.query('ROLLBACK');
  return id;
}
async function readIdentity(client, name) {
  const { rows } = await client.query(`SELECT current_database() AS "databaseName",current_user AS "databaseUser",
    (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOid",
    (SELECT pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=current_database()) AS "databaseOwner",
    inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort",
    inet_client_addr()::text AS peer,
    (SELECT oid::text FROM pg_catalog.pg_namespace WHERE nspname='public') AS public_oid,
    current_setting('server_version') AS server_version`);
  if (rows.length !== 1) safe('new database live identity mismatch');
  const id = rows[0], socket = client.connection?.stream;
  if (!socket || id.databaseName !== name || !/^\d+$/.test(id.databaseOid ?? '') || !id.databaseOwner || !id.databaseUser
      || !loopback(id.serverAddress) || !loopback(id.peer) || !loopback(socket.remoteAddress) || !loopback(socket.localAddress)
      || norm(id.serverAddress) !== norm(socket.remoteAddress) || norm(id.peer) !== norm(socket.localAddress)
      || Number(id.serverPort) !== Number(socket.remotePort) || !/^\d+$/.test(id.public_oid ?? '')) safe('new database live identity mismatch');
  return id;
}
export { readIdentity };
function baselineEmptySchema(client, emptyBaseline) {
  return client.query("SELECT count(*)::int AS n FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')")
    .then(({ rows }) => { if (rows[0].n !== 0) safe('new database schema is not empty before migration'); return emptyBaseline; });
}
function manifestPath(directory, suffix) { return path.join(directory, `manifest-${suffix}.json`); }
function writeManifest(handle, manifest, initial = false) {
  const data = `${JSON.stringify(manifest, null, 2)}\n`;
  if (initial) fs.writeSync(handle, data, 0, 'utf8');
  else { fs.ftruncateSync(handle, 0); fs.writeSync(handle, data, 0, 'utf8'); }
  fs.fsyncSync(handle);
}
function targetFingerprint(url, id) {
  return crypto.createHash('sha256').update(JSON.stringify({ host:url.hostname.replace(/^\[|\]$/g,''), port:Number(url.port),
    database:id.databaseName, database_oid:id.databaseOid, public_oid:id.public_oid,
    server_address:id.serverAddress, server_port:Number(id.serverPort), server_version:id.server_version })).digest('hex');
}
export function sanitizedOutput(text, env) {
  let safeText=text.replace(/postgres(?:ql)?:\/\/[^\s'"),]+/gi,'[database-url]');
  for(const key of ['JWT_SECRET','SUBJECTS_TEST_JWT_SECRET','SUBJECT_GROUPS_TEST_JWT_SECRET','GROUPS_TEST_JWT_SECRET'])
    if(env[key]) safeText=safeText.split(env[key]).join('[redacted-secret]');
  return safeText;
}
function hasSkippedTests(output) { return /^# skipped [1-9]\d*$/m.test(output); }
export function mayDropRun(run) {
  return Boolean(run?.creationAcknowledged && /^\d+$/.test(String(run.oid ?? '')) && run.name && run.owner
    && typeof run.serverAddress === 'string' && loopback(run.serverAddress) && Number.isInteger(Number(run.serverPort)));
}
export function cleanupIdentity(run) {
  return `${run.name} oid=${mayDropRun(run) ? run.oid : 'unavailable'} owner=${run.owner} server=${run.serverAddress}:${run.serverPort}; manifest=${run.manifestPath}`;
}
async function cleanup(source, resolved, run, handle) {
  if (!run) return;
  const fileStat=fs.lstatSync(run.manifestPath);
  if(fileStat.isSymbolicLink()||!fileStat.isFile()||fs.realpathSync(run.manifestPath)!==run.manifestPath) safe('cleanup manifest path changed; refusing database removal');
  const saved=JSON.parse(fs.readFileSync(run.manifestPath,'utf8'));
  if(saved.createdByRun!==true||saved.database?.createdByRun!==true||saved.database.name!==run.name
      ||saved.database.oid!==run.oid||saved.database.owner!==run.owner
      ||norm(saved.database.serverAddress)!==norm(run.serverAddress)||Number(saved.database.serverPort)!==Number(run.serverPort)) safe('cleanup manifest identity changed; refusing database removal');
  const url = new URL(source); url.pathname='/postgres';
  const client = new pg.Client({ connectionString:url.toString(), connectionTimeoutMillis:5000, statement_timeout:5000, query_timeout:6000, options:OPTIONS });
  try {
    await client.connect();
    const maint = await identify(client,resolved);
    const { rows } = await client.query('SELECT oid::text AS oid,pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datname=$1',[run.name]);
    const active = await client.query('SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[run.name]);
    if (!rows[0] || rows[0].oid!==run.oid || rows[0].owner!==run.owner || norm(maint.server)!==norm(run.serverAddress)
        || Number(maint.port)!==Number(run.serverPort) || active.rows[0].n!==0) {
      await client.query('ROLLBACK'); safe(`cleanup required; stop owned connections, verify ${run.name} oid=${run.oid} owner=${run.owner} server=${run.serverAddress}:${run.serverPort}; manifest=${run.manifestPath}`);
    }
    await client.query('ROLLBACK'); await client.end();
    const dropper=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,options:OPTIONS});
    try {
      await dropper.connect();
      const check=await identify(dropper,resolved);
      const verify=await dropper.query('SELECT oid::text AS oid,pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datname=$1',[run.name]);
      const connections=await dropper.query('SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[run.name]);
      if (!verify.rows[0] || verify.rows[0].oid!==run.oid || verify.rows[0].owner!==run.owner || norm(check.server)!==norm(run.serverAddress)
          || Number(check.port)!==Number(run.serverPort) || connections.rows[0].n!==0) safe('cleanup identity changed; refusing database removal');
      await dropper.query('ROLLBACK'); await dropper.query(`DROP DATABASE "${run.name}"`);
      if((await dropper.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname=$1',[run.name])).rowCount!==0) safe('exact disposable database remains after cleanup');
    } finally { await dropper.end(); }
    run.manifest.state='database-dropped'; writeManifest(handle,run.manifest);
    console.log(`CLEANUP_OK ${run.name} oid=${run.oid} owner=${run.owner} server=${run.serverAddress}:${run.serverPort} connections=0`);
  } finally { try { await client.end(); } catch {} }
}

export async function finishRun({ run, manifestHandle, result, status=process, cleanup:cleanupRun=cleanup, log=(line)=>console.error(line), source, resolved }) {
  if(run&&manifestHandle&&mayDropRun(run)) {
    try { await cleanupRun(source.toString(),resolved,run,manifestHandle); }
    catch(error) { log(`CLEANUP_REQUIRED ${error?.safe?error.message:'cleanup refused'}; ${cleanupIdentity(run)}`); result=1; }
  } else if(run) log(`CLEANUP_REQUIRED creation ${run.creationAcknowledged?'acknowledged':'attempted'}; ${cleanupIdentity(run)}`);
  status.exitCode=result;
}

async function main() {
  let source, resolved, run, manifestHandle, result=1, manifest;
  preflight(process.argv.slice(2),process.env);
  try {
    const suites = discoverIntegrationSuites();
    const appUrl=sourceUrl(), host=norm(appUrl.hostname);
    resolved=host==='localhost' ? await dns.lookup('localhost',{all:true}) : [{address:host}];
    if (!resolved.length || resolved.some((row)=>!loopback(row.address))) safe('source DNS must resolve only to loopback');
    source=new URL(appUrl); source.pathname='/postgres';
    const readonly=new pg.Client({connectionString:source.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,options:`-c default_transaction_read_only=on ${OPTIONS}`});
    let maintenance;
    try { await readonly.connect(); maintenance=await identify(readonly,resolved); const role=await readonly.query('SELECT rolcreatedb OR rolsuper AS allowed FROM pg_catalog.pg_roles WHERE rolname=current_user');
      if (!role.rows[0]?.allowed) safe('verified maintenance role lacks database-creation authority');
    } finally { try { await readonly.end(); } catch {} }
    const name=`salud_e2e_${crypto.randomBytes(8).toString('hex')}`;
    if (!DISPOSABLE_DATABASE_PATTERN.test(name)) safe('generated database name failed its safety check');
    const directory=safeDirectory(), suffix=name.slice('salud_e2e_'.length), file=manifestPath(directory,suffix);
    if (fs.existsSync(file)) safe('generated manifest already exists; refusing overwrite');
    const endpoint=norm(maintenance.server), targetUrl=new URL(appUrl); targetUrl.hostname=endpoint.includes(':')?`[${endpoint}]`:endpoint; targetUrl.pathname=`/${name}`;
    const creator=new pg.Client({connectionString:source.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,options:OPTIONS});
    let creatorOpen=true;
    try {
      await creator.connect();
      const creatorIdentity=await verifyCreatorSocket(creator,resolved,maintenance);
      if ((await creator.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname=$1',[name])).rowCount) safe('fresh maintenance identity or database absence check failed');
      manifest={format:1,createdByRun:false,creationMode:'exclusive',state:'creation-attempted',database:{name,oid:'unavailable',owner:maintenance.user,
        databaseName:name,databaseOid:'unavailable',databaseOwner:maintenance.user,databaseUser:maintenance.user,
        serverAddress:norm(creatorIdentity.server),serverPort:Number(creatorIdentity.port),createdByRun:false}};
      manifestHandle=fs.openSync(file,'wx',0o600); writeManifest(manifestHandle,manifest,true);
      run={name,oid:null,owner:maintenance.user,serverAddress:norm(creatorIdentity.server),serverPort:Number(creatorIdentity.port),manifestPath:file,manifest,creationAcknowledged:false};
      await creator.query(`CREATE DATABASE "${name}"`);
      run.creationAcknowledged=true; manifest.state='create-acknowledged'; writeManifest(manifestHandle,manifest);
      const catalog=await creator.query('SELECT oid::text AS oid,pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datname=$1',[name]);
      if(!catalog.rows[0]||!/^\d+$/.test(catalog.rows[0].oid??'')||catalog.rows[0].owner!==maintenance.user) safe('created database owner did not match verified maintenance role');
      run={name,oid:catalog.rows[0].oid,owner:catalog.rows[0].owner,serverAddress:norm(creatorIdentity.server),serverPort:Number(creatorIdentity.port),manifestPath:file,manifest:null,creationAcknowledged:true};
      manifest={format:1,createdByRun:true,creationMode:'exclusive',state:'database-created',database:{name,oid:catalog.rows[0].oid,
        owner:catalog.rows[0].owner,databaseName:name,databaseOid:catalog.rows[0].oid,databaseOwner:catalog.rows[0].owner,
        databaseUser:maintenance.user,serverAddress:run.serverAddress,serverPort:run.serverPort,createdByRun:true}};
      run.manifest=manifest; writeManifest(manifestHandle,manifest);
      await creator.end(); creatorOpen=false;
      const target=new pg.Client({connectionString:targetUrl.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,options:`-c default_transaction_read_only=on ${OPTIONS}`});
      try {
        await target.connect(); await target.query('BEGIN READ ONLY');
        const id=await readIdentity(target,name), socket=target.connection.stream;
        if(id.databaseOid!==catalog.rows[0].oid||id.databaseOwner!==catalog.rows[0].owner
          ||norm(id.serverAddress)!==norm(maintenance.server)||Number(id.serverPort)!==Number(maintenance.port)
          ||!loopback(id.peer)||!loopback(socket.remoteAddress)||!loopback(socket.localAddress)||norm(socket.remoteAddress)!==norm(id.serverAddress)) safe('created database socket/server identity mismatch');
        const schemaFingerprint=await computeDisposableSchemaFingerprint(target);
        const emptyBaseline=Object.fromEntries(REQUIRED_EMPTY_BASELINE_TABLES.map((table)=>[table,0]));
        await baselineEmptySchema(target,emptyBaseline);
        await target.query('ROLLBACK');
        const identity={...id};
        const env={...process.env,DISPOSABLE_INTEGRATION_TARGET:'true',DISPOSABLE_INTEGRATION_DATABASE_URL:targetUrl.toString(),DATABASE_URL:targetUrl.toString()};
        const pathName=file;
        manifest.database.databaseUser=identity.databaseUser;
        manifest.database.serverAddress=norm(identity.serverAddress); manifest.database.serverPort=Number(identity.serverPort);
        manifest.database.schemaFingerprint=schemaFingerprint; writeManifest(manifestHandle,manifest);
        const stat=fs.lstatSync(pathName), real=fs.realpathSync(pathName);
        Object.assign(run,{serverAddress:norm(identity.serverAddress),serverPort:Number(identity.serverPort),manifestPath:pathName,manifest});
        if(stat.isSymbolicLink()||!stat.isFile()||real!==pathName) safe('new run manifest is not a canonical file');
        validateDisposableTarget({env,cwd:ROOT,manifestPath:pathName,manifestRealPath:real,manifestPathHasSymlink:false,
          manifest,identity,schemaFingerprint,emptyBaseline});
        if (process.argv.includes('--career-upgrade-rehearsal')) {
          // Reuse this exact identity-verified, empty database socket. No new write target.
          const { rehearseCareerUpgrade } = await import('./career-upgrade-rehearsal.js');
          await target.query('SET default_transaction_read_only = off');
          const proof = await rehearseCareerUpgrade(target);
          console.log(`CAREER_UPGRADE_OK ${JSON.stringify(proof)}`);
          result=0;
          return;
        }
      } finally { await target.end(); }
      const migrationEnv=makeEnvironment(targetUrl.toString());
      const migrated=spawnSync(process.execPath,['--import','tsx','src/db/migrate.ts'],{cwd:ROOT,env:migrationEnv,encoding:'utf8',timeout:120000,windowsHide:true});
      if(migrated.error||migrated.status!==0) safe(`migration failed for ${name}; manifest=${file}; inspect and clean only after identity verification`);
      const finalTarget=new pg.Client({connectionString:targetUrl.toString(),connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000,options:`-c default_transaction_read_only=on ${OPTIONS}`});
      let testEnv;
      try {
        await finalTarget.connect(); await finalTarget.query('BEGIN READ ONLY');
        const schemaFingerprint=await computeDisposableSchemaFingerprint(finalTarget);
        const counts=await finalTarget.query(`SELECT ${REQUIRED_EMPTY_BASELINE_TABLES.map((table)=>`(SELECT count(*)::int FROM public."${table}") AS "${table}"`).join(',')}`);
        const actual=await readIdentity(finalTarget,name), targetMeta=await finalTarget.query("SELECT (SELECT oid::text FROM pg_catalog.pg_namespace WHERE nspname='public') public_oid,current_setting('server_version') server_version");
        if(Object.values(counts.rows[0]).some(n=>n!==0)) safe('post-migration application baseline is not empty');
        const ledger=await finalTarget.query('SELECT name FROM public.schema_migrations ORDER BY name');
        if(ledger.rowCount!==48) safe('migration ledger is incomplete');
        manifest.database.schemaFingerprint=schemaFingerprint; writeManifest(manifestHandle,manifest);
        run.manifest=manifest;
        const fp=targetFingerprint(targetUrl,{...actual,...targetMeta.rows[0]});
        testEnv=makeEnvironment(targetUrl.toString(),fp);
        await finalTarget.query('ROLLBACK');
      } finally { await finalTarget.end(); }
      await verifyDisposableIntegrationTarget({env:testEnv,cwd:ROOT});
      const suiteResult=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','--test-reporter=tap',...suites],{cwd:ROOT,env:testEnv,encoding:'utf8',timeout:900000,windowsHide:true});
      process.stdout.write(sanitizedOutput(suiteResult.stdout??'',testEnv)); process.stderr.write(sanitizedOutput(suiteResult.stderr??'',testEnv));
      const skipped=hasSkippedTests(suiteResult.stdout??'');
      if(suiteResult.error) console.error('INTEGRATION_RUN_FAILED test runner did not exit cleanly');
      if(skipped) console.error('INTEGRATION_RUN_FAILED skipped tests are not accepted');
      result=suiteResult.error||suiteResult.status!==0||skipped?1:0;
    } finally { if(creatorOpen) await creator.end(); }
  } catch(error) {
    const message=error?.safe?error.message:'isolated integration run failed; inspect the canonical run manifest';
    console.error(`RUN_REFUSED_OR_FAILED ${message}`); result=1;
  } finally {
    await finishRun({run,manifestHandle,result,source,resolved});
    if(manifestHandle) try { fs.closeSync(manifestHandle); } catch {}
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    console.error(`RUN_REFUSED ${error?.safe?error.message:'isolated integration preflight failed'}`);
    process.exitCode=2;
  }
}
