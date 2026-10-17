# Academic context catalog foundation

## Objective and rationale
Establish the persistence foundation for subjects and shared academic groups before adding context habilitations or clinical access. Keep this delivery limited to schema, focused tests, cleanup compatibility and documentation.

## Approved requirements
- A group can be associated with multiple subjects; group identity is independent of any subject.
- Semester means curriculum semester, not calendar half-year.
- Each new curriculum-semester offering gets a new group; historical groups remain.
- A group is uniquely identified by academic year, curriculum semester and group name.
- Creating a new group never automatically revokes old habilitations.
- Administrators will create subjects/groups/associations and enable teachers. Enabled teachers will manage student habilitations only in their own subject/group context.
- That management policy is future application work, not a grant introduced by this migration.

## Scope and constraints
- Add migration 009 with subjects, groups and unique subject-group associations.
- Use minimal catalog fields: subject identifier/name; group identifier/academic year/curriculum semester/name; relationship keys and existing audit conventions where appropriate.
- No course catalog codes, imposed curriculum-semester ceiling, enrollment, routes, permissions, habilitation tables, patient assignments or clinical content in this slice.
- Preserve existing migration files, completed feature documents, package.json (pre-existing pnpm version change), .pi/ and .codegraph/.
- No real database mutation until fresh disposable-target verification and user authorization. Never load .env for tests.
- No commit, push, PR or publication without explicit user request. Implementation authorization does not supersede this restriction.
- Configured TDD is off: openspec/config.yaml testing.strict_tdd=false and rules.apply.tdd=false. Tests are still required; do not claim RED/GREEN evidence not observed.

## Tasks
- [x] T1 — Implement the academic catalog schema, focused constraint tests, cleanup ordering and brief README documentation. Status: implemented and verified; uncommitted. Route: delegated gentle-ai-worker; multi-file write trigger.
- [x] T2 — Verify the slice with static and DB-free checks, then safely authorized disposable-database migration/integration checks. Status: passed; TypeScript, 24 selected unit tests and six academic integration tests. Route: delegated gentle-ai-verify; command-running verification trigger. Database mutation gated on successful fresh target verification.
- [x] T3 — Complete candidate-scoped native review and report remaining delivery decisions. Status: approved and acknowledged; no delivery authorized. Route: parent native review, bounded delegated correction only if required. Commit identity: none; commit not authorized.

## Acceptance criteria
- Database constraints enforce required nonblank names, agreed group identity and unique subject-group pairs.
- One group can link to several subjects; one subject can participate in multiple groups.
- Invalid relationships are rejected and deletes do not silently cascade away linked academic history.
- Focused tests cover valid associations, duplicates, required fields and foreign keys.
- Existing cleanup remains dependency-safe without altering unrelated seed behavior.
- No automatic access or endpoint is introduced.
- Every executed check has an observed result; missing DB evidence remains explicitly pending.

## Verification plan
DB-free commands, authorized for the bounded writer:
- node node_modules/typescript/bin/tsc --noEmit (installed compiler; avoids failed pnpm version fetch)
- node --check tests/integration/academic-context-schema.test.js
- node --check tests/integration/helpers/clean-db.js
- node --import tsx --test --test-concurrency=1 tests/unit/guard.test.js tests/unit/authenticate.test.js tests/unit/pg-teacher-repository.test.js tests/unit/pg-student-repository.test.js
- git diff --check

User authorized .env.test target verification, migration 009 and focused academic integration tests, explicitly informed that cleanup deletes application data. Read-only target evidence passed; current execution rechecks the pinned target before mutation and before/after focused tests. Full-suite execution is not part of this narrow authorization. Do not invoke pnpm (known executable-version fetch failure); use installed Node/tsx only after parent authorizes exact execution commands.

## Delivery and review forecast
- Branch: feat/academic-context-foundation.
- Base: e2bbab6b918cb065bb37a420b33556b177c3155d.
- This bounded slice forecast: 220–350 authored source/test/documentation lines plus this tracker; report actual size, never compress tests or code to fit.
- Strategy: ask-on-risk. No publishing or chain strategy selected. Reassess scope before expanding beyond this coherent catalog slice.
- Subsequent separate slices: habilitation persistence; catalog application/API; protected teacher/student habilitation operations. They are not part of this writer's edit authority.
- Native review switch: on. Review review-b0dde287d9b3c7e1 approved and acknowledged. Tier: medium; one reliability lens; 330 authored changed lines across six frozen paths, including the preserved pre-existing package.json change.
- Reviewed candidate tree: f08d990401f3839a06f406d935bc6a00aca164c2. Target: sha256:a4f5a469cb73b40ddb35e0bef902fd7ffd451b31eb32b3d6dc2928ae1794eb91. Receipt applies to that snapshot; this subsequent progress-only tracker update is not part of the frozen candidate.
- Non-blocking advisory R3-001 at migration 009 line 13 was informational, did not open a correction, and is deferred rather than modifying the approved implementation.
- Commits: none. Running committed authored lines: 0.

## Progress and evidence
- Read-only scout muu37lgc-1-61y8 completed. Next migration is 009; no academic schema exists; global permissions do not implement context relationships.
- Existing package.json difference is only packageManager pnpm@10.20.0 to pnpm@12.9.1; preserved.
- Product decisions are recorded in Engram observations 396–400.
- Writer muu4zrv5-2-8zis returned partial: four implementation files written, approximately 236 authored lines. UUID catalog keys; clinical BIGINT convention unchanged.
- Writer observed both JavaScript syntax checks pass, 24 DB-free unit tests pass, and git diff --check pass. pnpm exec tsc --noEmit failed during an attempted package-manager version fetch; no config change or workaround performed by writer.
- Native assessment returned unassessable because untracked paths need explicit declaration; candidate treated as high risk and independent verification required. No native review closure or approval exists.
- Verifier muu56ajr-3-k4h5 completed: direct installed TypeScript compiler passed; both syntax checks passed; 24 DB-free unit tests passed; diff whitespace check passed. Only pre-existing packageManager change confirmed in package.json.
- Independent review confirmed fixture collisions caused by file-level cleanup and README wording incorrectly extending pending academic DB evidence to delivered clinical migration 008. These are blocking corrections, statically established without DB execution.
- Correction writer muu59ioe-4-ftqe completed both fixes: beforeEach test cleanup with final cleanup/pool closure retained, and README pending evidence scoped to migration 009. Post-correction direct TypeScript check, both syntax checks, 24 DB-free unit tests and whitespace check passed. No pnpm fetch or configuration change.
- Parent read back both corrected regions and reran node --check tests/integration/academic-context-schema.test.js successfully (exit 0).
- User answered 'si, adelante' to explicit .env.test verification, migration 009 and destructive academic integration-test authorization.
- Read-only verifier muu5mal6-5-zjd9 passed parsed test configuration, ambient override, effective config, local TCP/server identity and public-schema checks. Eight migrations applied, only 009 pending, academic tables absent. No mutations occurred in preflight.
- Pinned target fingerprint: 0e643e59c74cf721b257adbe71f3355990110a74ffbbd59c570fd9dfbaa007b5. Disposability relies on the user's explicit authorization, not merely localhost or a test-named database.
- Verifier muu5owyn-6-oz9x executed the authorized guarded Node wrapper once: all target checks passed, migration runner skipped 001–008 and applied 009 only, then six academic integration tests passed (zero failed/skipped/cancelled). Final guard confirmed nine applied migrations and academic tables present. No failures or retries.
- Child environment came from parsed .env.test with all required config present; .env fallback was prevented. Authorized destructive test cleanup executed. Full suite was not run.
- Parent updated README to record actual focused evidence and full-suite limitation. Implementation and verification task checkoffs describe observed outcomes, not commit/delivery authorization; no commits exist.

## Next step
Report completed catalog foundation and observed tests. Await next user instruction for continuation into context habilitations or delivery. No commits or publication authorized. Preserve the unrelated package.json change; it was included in the native frozen review scope but is not authored feature work.
