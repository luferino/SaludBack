# Disposable local QA (Windows)

From SaludBack with its Node dependencies installed, run:

```sh
node scripts/local-qa.mjs --help
node scripts/local-qa.mjs --disposable --smoke
node scripts/local-qa.mjs --disposable
```

This command is separate from the regular development and integration commands. It requires PostgreSQL 18 at `C:/Program Files/PostgreSQL/18/bin` and the Windows `whoami.exe` and `icacls.exe` under `C:/Windows/System32`. Use a clean shell without injected PostgreSQL, database URL, JWT, admin, or Node loader settings. The command does not read project environment files, accept a database URL, or connect to an existing PostgreSQL instance.

`--smoke` starts a new loopback-only PostgreSQL cluster and SaludBack API, applies all repository migrations, seeds two fictitious Hygiene II drafts in distinct subject/group pairs, then checks the unfiltered list, subject, group, matching pair, and empty crossed pair. It does not create a browser handoff file or wait for a tester. Treat the smoke run as successful only if it exits zero **and** prints `QA_STOPPED_AND_REMOVED`.

Without `--smoke`, wait for `QA_READY`. Use the displayed API URL with the frontend bound to `http://127.0.0.1:4610`. Open the displayed `QA_LOCAL_LOGIN_FILE` locally for manual login only; do not copy its contents into logs, screenshots, or chat. The window closes after 24 minutes. To end it sooner, create the empty file at the printed `QA_FINISH_MARKER` path or press Ctrl+C once and let the runner shut down. Do not forcibly terminate the process during cleanup.

If startup or a check fails, the command exits nonzero. If it cannot verify the cluster stopped, it reports `QA_STOP_UNVERIFIED` and leaves the restricted directory in place for operator inspection. Do not delete it or stop any other PostgreSQL service by guesswork. A hard process kill may prevent cleanup; inspect the exact temporary cluster identity before any manual intervention. No real data should be added to this environment.
