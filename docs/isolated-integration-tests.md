# Run the isolated full integration suite

Run the disposable integration runner only after independent Risk 2 privacy and Risk 4 transition verification, plus explicit parent GO. It creates a new `salud_e2e_<16 hex>` database from the loopback maintenance endpoint in `.env.test`, runs migrations and the complete integration test set, then removes only that run's database after identity and zero-connection checks. It never writes to `.env.test`'s database.

## Command

Use a clean shell with only the explicit opt-in set:

```sh
DISPOSABLE_INTEGRATION_TARGET=true node tests/helpers/run-isolated-integration.mjs --disposable
```

Do not supply `DATABASE_URL`, `PG*`, JWT/API/token secrets, or subject-suite settings. The runner creates a child environment with disposable credentials and the project-local temporary directory inherited through `TEMP`, `TMP`, and `TMPDIR`.

## Populated career upgrade rehearsal

For the separately authorized synthetic legacy-data rehearsal, use:

```sh
DISPOSABLE_INTEGRATION_TARGET=true node tests/helpers/run-isolated-integration.mjs --disposable --career-upgrade-rehearsal
```

This explicit mode replaces the full suite, not its default behavior. It reuses the runner's exact identity-verified empty database socket and unchanged cleanup. It applies 001–035 with per-file transactions and ledger entries, inserts synthetic academic contexts, habilitations, assignments, availability, a patient, clinical record, evaluation and evolution, then commits 036/037. It compares complete legacy rows and sequence state, verifies kinesiology backfill and permission grants, and probes per-career uniqueness, same-career association FKs and unknown-career FK names. Every rejected probe must leave rows and counters unchanged.

Success prints `CAREER_UPGRADE_OK` followed by identity-checked `CLEANUP_OK`; either alone is insufficient. SQLSTATE/constraint checks prove database enforcement and constraint names, not HTTP error translation (covered separately by integration tests). No production data is read or copied. It does not claim an odontology ficha or exhaustive historical snapshot coverage.

## What runs and what is checked

- The runner recursively discovers and sorts every `*.test.js` file under `tests/integration/`. It does not search `.pi`, `odd`, scratch directories, or run only a hand-picked subset. Discovery errors or an empty set fail the run; test failures and any skipped tests are never treated as success.
- History-dependent integration fixtures run from the original repository clone, with its original Git objects available. The runner does not fetch, rewrite, or substitute repository history.
- Before migration, the runner can verify that the new database's `public` schema has no relations; application tables do not yet exist, so it does not claim a pre-migration table-count check. After migration, it checks the complete empty application baseline, migration ledger, live database identity, and schema fingerprint.
- Read-only target connections close before the integration tests start. Each test file is passed explicitly to Node's test runner, serially; a nonzero result remains a failed run.
- The groups fixture receives its complete `GROUPS_TEST_*` private contract, including the same ordered-JSON identity fingerprint used by the other exact-target guards. Its live verifier runs before its fixture pool or cleanup; its existing fingerprint, permission/grant, and seed checks remain active.
- Patient availability runs a read-only disposable-target preflight in this route: the shared verifier checks the live target, empty baseline, schema fingerprint, and complete migration ledger before the test opens its read-only pool. It does not require synthetic/pre-created fixture UUIDs, mutate rows, or claim CRUD or concurrency proof. The legacy optional route retains its existing localhost/port/database suffix and UUID requirements.
- The canonical exclusive manifest records sanitized identity, never credentials. Cleanup rechecks manifest path, database name, OID, owner, server, port, and zero active connections before dropping. There is no force-drop or adoption path.

If a check or cleanup refuses, stop. Preserve the manifest and database for independent review; do not edit `.env.test`, disable guards, or manually drop/adopt the database. Runner output redacts database URLs and generated secrets.

## Evolution suite coverage

`tests/integration/kinesiology-evolutions.test.js` joins the automatically discovered complete suite; it is not a separate runner mode. The suite opens no database connection without the explicit disposable opt-in, verifies the generated target and shared empty baseline before its fixture pool, then uses the existing FK-safe `cleanDb` helper. It seeds only user/profile/context/assignment prerequisites directly; it creates and validates the required evaluation through public HTTP routes.

The suite covers immutable submissions, corrections and amendments, replacement authorship through a newly activated origin period and assignment, cross-context snapshots during an unsubmitted correction draft (kinesiology cross-context reads are limited to the same career; odontology-context readers get the stranger response, covered by `tests/integration/kinesiology-career-isolation.test.js`), private correction reasons, revoked-context denial, SQLSTATE/constraint-identified savepoint probes, and two simultaneously issued public validation requests. That concurrent request case is bounded and does not claim exhaustive lock scheduling. No live PostgreSQL pass is established by source checks.

Review the integration source, runner, and independent Risk 2/Risk 4 evidence before the parent authorizes one actual invocation. If target verification or cleanup refuses, retain the manifest/database unchanged for review; never force cleanup or adopt the target.
