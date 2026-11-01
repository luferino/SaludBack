# Run the isolated full integration suite

Run the disposable integration runner only after independent Risk 2 verification and explicit parent GO. It creates a new `salud_e2e_<16 hex>` database from the loopback maintenance endpoint in `.env.test`, runs migrations and the complete integration test set, then removes only that run's database after identity and zero-connection checks. It never writes to `.env.test`'s database.

## Command

Use a clean shell with only the explicit opt-in set:

```sh
DISPOSABLE_INTEGRATION_TARGET=true node tests/helpers/run-isolated-integration.mjs --disposable
```

Do not supply `DATABASE_URL`, `PG*`, JWT/API/token secrets, or subject-suite settings. The runner creates a child environment with disposable credentials and the project-local temporary directory inherited through `TEMP`, `TMP`, and `TMPDIR`.

## What runs and what is checked

- The runner recursively discovers and sorts every `*.test.js` file under `tests/integration/`. It does not search `.pi`, `odd`, scratch directories, or run only a hand-picked subset. Discovery errors or an empty set fail the run; test failures and any skipped tests are never treated as success.
- History-dependent integration fixtures run from the original repository clone, with its original Git objects available. The runner does not fetch, rewrite, or substitute repository history.
- Before migration, the runner can verify that the new database's `public` schema has no relations; application tables do not yet exist, so it does not claim a pre-migration table-count check. After migration, it checks the complete empty application baseline, migration ledger, live database identity, and schema fingerprint.
- Read-only target connections close before the integration tests start. Each test file is passed explicitly to Node's test runner, serially; a nonzero result remains a failed run.
- The groups fixture receives its complete `GROUPS_TEST_*` private contract, including the same ordered-JSON identity fingerprint used by the other exact-target guards. Its live verifier runs before its fixture pool or cleanup; its existing fingerprint, permission/grant, and seed checks remain active.
- Patient availability runs a read-only disposable-target preflight in this route: the shared verifier checks the live target, empty baseline, schema fingerprint, and complete migration ledger before the test opens its read-only pool. It does not require synthetic/pre-created fixture UUIDs, mutate rows, or claim CRUD or concurrency proof. The legacy optional route retains its existing localhost/port/database suffix and UUID requirements.
- The canonical exclusive manifest records sanitized identity, never credentials. Cleanup rechecks manifest path, database name, OID, owner, server, port, and zero active connections before dropping. There is no force-drop or adoption path.

If a check or cleanup refuses, stop. Preserve the manifest and database for independent review; do not edit `.env.test`, disable guards, or manually drop/adopt the database. Runner output redacts database URLs and generated secrets.
