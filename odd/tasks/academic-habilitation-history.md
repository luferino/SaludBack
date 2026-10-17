# Academic habilitation history

## Objective and rationale
Persist teacher and student habilitation periods within an existing subject/group context. Preserve activation, revocation and reactivation history instead of replacing current-state bookkeeping.

## Approved requirements
- The administrator enables teachers; enabled teachers manage student habilitations within their context. Enforcement is subsequent application work, not granted by this schema.
- Each period records activation actor/time and, when closed, revocation actor/time. Reactivation creates another period.
- Reference the existing composite subject_academic_groups association and the respective teacher/student profile.
- At most one active period per profile and context; retain closed periods and historical references.
- Creating another group must not automatically revoke older habilitations.

## Scope and constraints
- Persistence-only: migration 010, focused SQL schema tests, dependency-safe cleanup and bounded README documentation.
- No routes, repositories, grants, patient assignments or clinical behavior.
- Do not encode student ownership by granting teacher or automatic teacher-to-student revocation. Peer management and operation idempotency remain deferred.
- Preserve prior uncommitted catalog implementation and tracker, package.json, .pi/ and .codegraph/.
- Existing branch: feat/academic-context-foundation. No staging, commits, push or PR authorized. Commit identity: none; this restriction overrides work-unit commit defaults.
- TDD configured off in openspec/config.yaml; tests required, no unobserved RED/GREEN claims.
- No database access/mutations or integration execution without fresh disposable-target verification and explicit authorization. Never fall back to .env.

## Tasks
- [x] H1 — Implement migration, lifecycle constraint tests, cleanup ordering and documentation. Status: implemented; independent static and DB-free checks passed after fixture correction. Uncommitted; PostgreSQL behavior remains H2.
- [x] H2 — Verify database behavior on an explicitly authorized disposable target. Status: passed; only 010 committed transactionally with ledger insertion, focused integration process exited 0, pre/post identity and ledger checks passed. Runtime numeric test counters not retained.
- [x] H3 — Complete candidate-scoped native review and report evidence and remaining decisions. Status: approved and acknowledged for frozen candidate; no delivery authorized. This completion-only tracker update is outside that reviewed snapshot.

## Acceptance and checks
- Valid teacher/student habilitations reference an associated subject/group pair, not independently valid catalog IDs.
- Missing profile/context/actor references, duplicate active periods and incoherent lifecycle timestamps are rejected.
- Activation actor/time required; closure actor/time paired; end cannot precede start.
- Closing and reactivating retains the prior period and allows a new active period.
- Referenced history cannot silently disappear via cascades; older contexts remain unaffected.
- Integration fixtures are isolated per test and clean dependent rows before catalog/profile/user tables.
- Schema does not claim application authorization or immutable audit enforcement beyond actual constraints.

## Verification plan
Writer-authorized DB-free commands:
- node node_modules/typescript/bin/tsc --noEmit
- node --check tests/integration/academic-habilitation-schema.test.js
- node --check tests/integration/helpers/clean-db.js
- node --import tsx --test --test-concurrency=1 tests/unit/guard.test.js tests/unit/authenticate.test.js tests/unit/pg-teacher-repository.test.js tests/unit/pg-student-repository.test.js
- git diff --check

Do not run pnpm, migrations or integration tests in H1. Database checks are pending, not proven by syntax or unit tests. Full suite remains outside scope.

## Review scope and progress
- Catalog foundation recovery reconciled with its full Engram mirror and working-tree status.
- Read-only scout muvujgpn-1-yziu mapped composite context key, identity/profile role mismatch, global-only permissions and migration/test conventions.
- User approved retaining every activation period with actors and timestamps; decision observation 405.
- Expected new slice: approximately 250–400 authored lines; worker must report actual size and stop before substantial expansion. Prior dirty catalog work makes accumulated scope larger; preserve it and resolve review boundaries before freezing a new candidate.
- Writer muvuv2h2-2-1qj2 implemented the four authorized files, approximately 290 incremental authored lines. Reported installed TypeScript check, both JavaScript syntax checks, 24 selected DB-free unit tests and whitespace check passed. Integration cases authored but not executed; no database operations.
- Parent read migration 010 and its tests, and reran new-test syntax check successfully. Negative actor-FK fixture may collide with an existing active-period unique index; independent verifier must check before H1 is accepted.
- Native assessment returned unassessable because untracked paths need declaration; unknown native review outcome and unknown writer profile require separate verification. Read-only verifier muvv2la5-3-m2gf launched with exact DB-free commands, no database access or edits.
- Independent verifier confirmed one blocking fixture collision: an existing active period makes invalid activation-actor insertion fail with unique violation 23505 before FK violation 23503. Static constraint-order evidence only; DB not executed. All five authorized DB-free checks passed (24 unit tests).
- Parent applied the exact one-file mechanical correction: moved the valid insertion to the end of the first test loop, after negative assertions. No schema changes. Follow-up verifier muvv4yrz-4-s0k5 is checking the corrected region and repeating the five DB-free commands.
- Follow-up verifier muvv4yrz-4-s0k5 confirmed the fixture blocker resolved by static inspection; TypeScript, both syntax checks, 24 selected unit tests and whitespace check passed again. No database operations. H1 complete at this bounded static/DB-free scope; database behavior remains unverified.
- Parent requested explicit authorization to verify the .env.test disposable target, apply only migration 010 and run focused habilitation integration tests, disclosing destructive application-data cleanup and excluding the full suite. Human answer pending; no authorization inferred from subagent completion.

## Next step
User explicitly authorized H2 with 'si, adelante :)', including destructive cleanup in the disposable .env.test target. Preflight muvv8cip-5-vzp6 stopped with schema_ambiguous: required config complete, effective config matched parsed .env.test with fallback disabled, endpoint local, database name matched, session/transaction read-only asserted. Combined public/current-schema/resolved-schema assertion failed; exact differing component unknown. No fingerprint, ledger or table-state evidence obtained; no migrations/tests/cleanup or repository writes performed by verifier.

User explicitly authorized additional read-only schema diagnostics with 'okey, autorizado' (decision observation 408). Diagnostic muvvg1dn-6-77vy conclusively found a representation bug: PostgreSQL name[] OID 1003 is returned as string '{public}' by pg, not a JS array. SQL equality confirmed only public resolves; public exists and USAGE is true. No search_path changes. Validate using SQL equality or text[] cast, but preserve raw name[] representation for fingerprint.

Read-only checks confirmed exact repository migration filenames 001–009 applied, only 010 pending, both habilitation relations absent across schemas, unqualified ledger resolves public, required config complete and isolated, .env fallback forbidden, read-only settings enabled. First overlong heredoc failed parsing before execution; shorter retry completed successfully. Git status unchanged. No mutations.

Pinned target v1 fingerprint: 2ea331913f1915ef2d96af078a64d8a38cb8d3d656b77bb65678471838a55001. SHA-256 of UTF-8 JSON.stringify ordered array: ['academic-habilitation-target-v1', URL.protocol, lowercased hostname without IPv6 brackets, numeric configured/default port, decoded database name, database OID as text, server address as text, server port, server_version_num string, search_path, original raw name[] string, public OID as text]. Do not substitute normalized array. Migration 010 UTF-8 SHA-256: 6c11ad59b9010a17f3af5725b77d5546630de1cd484d5b2029c0f8494bed36ed.

Endpoint DNS is loopback and connected database/port matched, but server-reported address is non-loopback. User stated database runs locally, requested a connection retry, then confirmed 'esta todo ok, continua' after fresh successful connectivity evidence. Exact forwarding/container topology remains technically unverified, not claimed. User continuation confirms the previously authorized disposable target; pin exact identity rather than infer safety from localhost.

Fresh read-only verifier muvw05qx-7-6zwi observed DNS, IPv4/IPv6 TCP, PostgreSQL authentication and SELECT 1 success; five-second timeouts, isolated config, read-only enforcement, corrected schema check and exact unchanged fingerprint. Ledger remains 001–009 with only 010 pending, both habilitation tables absent; no writes. Decision observation 409 records continuation. Proceed only on unchanged identity and migration hash under prior explicit destructive-test authorization.

H2 executed by verifier muvwl970-9-irgd: fresh configuration/hash/DNS/TCP and read-only fingerprint/001–009/absence checks passed. Only migration 010 plus ledger insertion ran in one explicit transaction after EXCLUSIVE ledger lock and recheck; COMMIT acknowledged. Pre/posttest read-only checks confirmed exact pinned identity, ledger 001–010 and public habilitation relations. Exact isolated focused Node test vector exited 0, no stderr/signal/failure reason. Authorized destructive cleanup ran. Wrapper filtered TAP-style summaries but actual output did not match: numeric runtime counters not preserved; four declared tests are not an observed runtime count. No rerun or full suite.

User explicitly authorized taskkill.exe scoped only to the spawned test runner tree on timeout/output-limit/spawn failure. First execution launch stopped before DB work when permission query expired; continuation received actual UI approval. Exceptional taskkill was NOT used. Git status unchanged; no source edits, installs, commits or config changes by verifier.

H3 native review review-461a3c6a7d81d28a approved and acknowledged. Frozen tree: 4e597607df61c69789e08bf237f06fcc4701e6fc; target sha256:da91f0d71125508fe497fb53cb77427d1ea3fa680a516301d8952fd0d8a9862d. Medium tier, one reliability reviewer, 701 accumulated authored lines across nine paths, including prior uncommitted catalog work and preserved package.json. .pi/ and .codegraph/ excluded. Non-blocking informational advisory R3-001 at migration 009 line 12 did not open correction; defer rather than reopen approved candidate.

Review applies only to the frozen candidate, not this subsequent progress-only tracker update. Implementation complete for persistence slice, not the entire academic feature. Await user direction on catalog APIs/protected habilitation operations or delivery; deferred peer-management, teacher-revocation effects and API idempotency decisions remain. No staging, commits or publishing authorized.
