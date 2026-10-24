import { register, stripTypeScriptTypes } from 'node:module';
import { isMainThread } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Test-only loader. Git objects stay in memory; no checkout, files, or DB setup.
const revisions = new Set([
  '50c56b6ea7d81b95df0e6ba41dff183b11860001',
  '0d92890bf7a34fe2279c66ba97e698efd20698ab',
]);
const revision = process.env.CLINICAL_DIFF_REVISION;
if (!revisions.has(revision)) throw new Error('Unsupported clinical differential revision');
const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = new URL('../../src/modules/', import.meta.url).href;
const modules = ['kinesiology-evaluations/', 'patient-assignments/'];

// Async hooks compose with tsx's loader, including CommonJS dependencies.
export async function load(url, context, nextLoad) {
  if (url.startsWith(sourceRoot) && modules.some(name => url.startsWith(sourceRoot + name)) && url.endsWith('.ts')) {
    const path = `src/modules/${decodeURIComponent(url.slice(sourceRoot.length))}`;
    const source = execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8' });
    console.log('CLINICAL_SOURCE ' + Buffer.from(JSON.stringify({ revision, path })).toString('base64'));
    return { format: 'module', source: stripTypeScriptTypes(source, { mode: 'transform' }), shortCircuit: true };
  }
  return nextLoad(url, context);
}

if (isMainThread) {
register(import.meta.url);
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== '127.0.0.1') throw new Error('Differential harness only allows loopback HTTP');
  const response = await originalFetch(input, init);
  // Cloning keeps the real Response available to the unchanged test assertions.
  const text = await response.clone().text();
  console.log('CLINICAL_HTTP ' + Buffer.from(JSON.stringify({
    method: init?.method ?? 'GET', path: url.pathname + url.search,
    requestBody: init?.body ?? null, status: response.status, body: text,
  })).toString('base64'));
  return response;
};
}
