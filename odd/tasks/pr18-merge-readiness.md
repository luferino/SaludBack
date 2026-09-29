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

- [ ] **SP-0 — Tracker.** Route: inline (one mechanical file). Commit this document on the tracker branch, push, open draft tracker PR.
- [ ] **SP-1..SP-5 — Rebuild slices.** Route: delegated direct (writer trigger: many non-trivial files). One work-unit commit per slice; typecheck + unit tests per slice; push and open child PR with Chain Context.
  - SP-1: `openspec/changes/permission-matrix-in-db/{proposal.md,specs/**}` (~382).
  - SP-2: `design.md`, `tasks.md` at `8c3727e` state (~367).
  - SP-3: migrations `006`/`007`, `auth.ports.ts`, `pg-permission-matrix.repository.ts` + unit test (~160).
  - SP-4: `app.ts`, `login-user.usecase.ts`, `authenticate.ts`, `auth.routes.ts`, unit tests, integration fixtures from `6460a9f` (~540; over budget unless a cohesive split exists).
  - SP-5: delete `domain/permissions.ts` + `tests/unit/permissions.test.js`, main-spec sweep from `8c3727e`, `apply-progress.md` (~268).
- [ ] **SP-6 — README readiness docs (former MR-2).** Review the uncommitted draft against the acceptance criteria below; commit as the last slice.
- [ ] **SP-7 — Close PR #18** as superseded, linking the tracker, once the chain is published.

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

- (none yet)

## Next step

SP-0.
