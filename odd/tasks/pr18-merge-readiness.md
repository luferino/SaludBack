# PR #18 split and merge readiness

Feature: `pr18-merge-readiness` | Workflow: ODD, canonical Gentle AI v3.7.0.
Objective: replace oversized PR #18 (1,656 changed lines) with a feature-branch chain of reviewable slices (~400 lines each), then document deployment/rollback readiness.
Status: in progress.

## Context and boundaries

- Source of truth: branch `feat/permission-matrix-in-db` @ `8c3727e` (PR #18). It stays untouched as a backup.
- User decisions (2026-09-29): split instead of `size:exception`; chain strategy `feature-branch-chain` (nothing lands on `main` until the chain completes; migration `007` is not idempotent).
- Delivery strategy: `ask-on-risk` resolved to chaining. Push and PR creation of the chain are authorized. Merges are the user's decision.
- No Docker, database connections, migrations, seeds, integration tests, or `pnpm test` (its `pretest` migrates the `.env.test` database). No `.env`/`.env.test` reads.
- Commit `2c1ca72` alone breaks integration fixtures (fixed by `6460a9f`), so slices are rebuilt from `main` by file, not cherry-picked.
- CodeGraph index absent; bounded read fallback.

## Branches

- Tracker: `feat/permission-matrix-db` from `main`, draft/no-merge PR to `main`.
- Children, each based on the previous branch:
  1. `feat/permission-matrix-db-01-proposal-specs`
  2. `feat/permission-matrix-db-02-design-tasks`
  3. `feat/permission-matrix-db-03-data-layer`
  4. `feat/permission-matrix-db-04-wiring` (may split into 04a/04b if cohesive)
  5. `feat/permission-matrix-db-05-remove-hardcoded`
  6. `feat/permission-matrix-db-06-readme-readiness`

## Tasks

- [x] **SP-0 — Tracker.** Route: inline (one mechanical file). Commit this document on the tracker branch, push, open draft tracker PR.
  Evidence: tracker PR #19, commit `f68f395`.
- [x] **SP-1..SP-5 — Rebuild slices.** Route: delegated direct (writer trigger: many non-trivial files). One work-unit commit per slice; typecheck + unit tests per slice; push and open child PR with Chain Context.
  - SP-1: `openspec/changes/permission-matrix-in-db/{proposal.md,specs/**}` (~382). Evidence: PR #20, commit `1c3d9ab`, ~382 lines.
  - SP-2: `design.md`, `tasks.md` at `8c3727e` state (~367). Evidence: PR #21, commit `517d527`, ~337 lines.
  - SP-3: migrations `006`/`007`, `auth.ports.ts`, `pg-permission-matrix.repository.ts` + unit test (~160). Evidence: PR #22, commit `0e98e2a`, ~162 lines.
  - SP-4: `app.ts`, `login-user.usecase.ts`, `authenticate.ts`, `auth.routes.ts`, unit tests, integration fixtures from `6460a9f` (~540; over budget unless a cohesive split exists). Evidence: PR #23, commit `6935767`, ~537 lines. No cohesive split exists: `createApp` wires `matrixReader` into both `LoginUser` and `authenticate`'s changed signature in the same unit, so the slice stayed a single over-budget commit.
  - SP-5: delete `domain/permissions.ts` + `tests/unit/permissions.test.js`, main-spec sweep from `8c3727e`, `apply-progress.md` (~268). Evidence: PR #24, commit `dd31b58`, ~238 lines.
- [x] **SP-6 — README readiness docs (former MR-2).** Review the uncommitted draft against the acceptance criteria below; commit as the last slice.
  Evidence: PR #25 (`feat/permission-matrix-db-06-readme-readiness`, this slice).
- [x] **SP-7 — Close PR #18** as superseded, linking the tracker, once the chain is published. Done: #18 closed with a comment pointing to #19 (#20-#25); branch `feat/permission-matrix-in-db` kept as backup.

## Verification

- TDD: not applicable; this is a re-slicing of already written code, no new behavior.
- Per slice: `pnpm exec tsc --noEmit`, `node --import tsx --test --test-concurrency=1 tests/unit/*.test.js` (no DB), `git diff --check`.
- Final invariant: the last code slice's tree equals `8c3727e` (excluding `odd/` and `README.md`).
- Integration suite (291 historical passes) is not re-run in this scope; the evidence gap stays declared in every PR.

## README acceptance criteria

- Complete migrations `006` and `007` before new application traffic. Transactions are per file: `006` may persist if `007` fails.
- A fresh seed has 7 permissions and 13 grants; not universal policy counts.
- Migration `007` is not idempotent. Do not drop customized grants or reset the migration ledger.
- Distinguish missing/unreadable matrix (`500`) from missing grants (`403`); heartbeat is not matrix health.
- Rollback must preserve policy and deploy a compatible application.
- State destructive test prerequisites and evidence gaps without reusing historical results as current proof.

## Progress

- Tracker PR #19 (`f68f395`).
- Slices: #20 `1c3d9ab` (~382 lines), #21 `517d527` (~337 lines), #22 `0e98e2a` (~162 lines),
  #23 `6935767` (~537 lines — no cohesive split: `createApp` wires `matrixReader` into both
  `LoginUser` and `authenticate`'s changed signature), #24 `dd31b58` (~238 lines), #25 (this
  06 PR).
- Invariant verified: slice 05's tree equals `8c3727e` (excluding `odd/` and `README.md`) —
  `git diff 8c3727e feat/permission-matrix-db-05-remove-hardcoded -- . ':!odd' ':!README.md'`
  is empty.
- Unit test counts per slice (`node --import tsx --test --test-concurrency=1 tests/unit/*.test.js`):
  229 / 229 / 233 / 226 / 215 (slices 01-05 in order); 06 does not touch `src/`, still 215.
- RDD native reviews: 01 approved and acknowledged (`review-05142475c9518dd1`); 02+03 reviewed
  together and approved (`review-ba0f71ec379fdcb8`; 02 alone was medium/`under_budget`); 04
  approved (`review-09e351b349a6206a`); 05 approved (`review-3008560b107040f1`). All advisory
  findings across these reviews were non-blocking.

## Follow-ups (from advisory review findings, not in scope)

- [x] (a) Slice 04 dropped the `authenticate` 401-path unit tests and the `LoginUser`
  input-validation unit tests. Done in PR #26 (`39f09f0`): 7 tests restored, 222/222 unit pass,
  fail-to-pass proven by temporarily breaking src.
- [x] (b) `authenticate` ignores the token's `permissions` claim and grants the role's full DB set.
  No change: DB-wins is a deliberate, documented design (PG-001) and only `LoginUser` mints tokens,
  always with the full role set. Revisit only if a scoped-token issuer is ever added.
- [ ] (c) Deferred by user decision (2026-09-29): keep one uncached DB read per authenticated
  request. Future improvement: a short-TTL in-process cache keyed by role (e.g. 30 s) would cut
  most matrix reads. Trade-off: a revoked grant could stay effective up to the TTL, which
  requires amending the immediate-revocation spec (user-auth, PG-001). Do it only when load is
  measured as a problem.
- (d) `tasks.md`/`apply-progress.md` (carried over from `8c3727e`) contain status claims that
  do not all match independently verified state — reconcile or annotate them.

## Next step

Paused 2026-09-29. Done: #20-#25 and follow-up #26 merged into the tracker branch
`feat/permission-matrix-db` (merge `7cdb3c2`); #18 closed; tracker PR #19 still draft; `main` untouched.

Resume with:

1. Run the integration suite against the `.env.test` database (user confirmed it is disposable
   and credentials are loaded). It applies pending migrations, deletes all app data, truncates
   and reseeds the permission matrix, and exercises the 005 precheck (drops/restores UNIQUE
   constraints). From `feat/permission-matrix-db`: `pnpm test` (pretest migrates `.env.test`),
   or `node --import tsx --env-file=.env.test src/db/migrate.ts` then
   `node --import tsx --env-file=.env.test --test --test-concurrency=1 tests/integration/*.test.js`.
   Record the real counts here; do not reuse the historical 291.
2. If green, mark #19 ready and let the user decide the merge to `main`.
3. Optional: follow-up (d) reconcile `tasks.md`/`apply-progress.md` status claims; drop the
   redundant stash "pr18 README readiness draft" (content lives in `e0db120`).
