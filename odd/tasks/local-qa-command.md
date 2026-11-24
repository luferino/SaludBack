# Reusable local QA command
Branch: feat/local-qa-command. Status: verified.
Risk: item 2 (disposable cluster isolation and generated test credentials).

## Specs
- S1: «ahora no tengo, déjemos la prueba como pendiente y tabajemos en otra cosa por ahora»
- S2: «Comando reutilizable de QA» — «Preparar el arranque y cierre del entorno descartable, sin retomar la prueba manual.»

## Tasks
- T1 [S1,S2] done; inline; work-unit commit `cf11e34` (`feat(qa): add disposable local QA command`). Provide a standalone local command, fixture, no-database CLI tests, and usage documentation. Preserve existing commands and do not resume browser QA.

## Log
- L1: «ahora no tengo, déjemos la prueba como pendiente y tabajemos en otra cosa por ahora»
- L2: Selected «Comando reutilizable de QA». Isolated worktree created from 8928741. Main checkout has unrelated package changes; do not touch them. Historical scratch bootstrap evidence is in Engram #1540; this feature makes an independently checked repository command, not an automatic restart of the browser environment.
- L3: CLI RED 0/4 before command existed; GREEN 4/4 and syntax checks passed. Independent verifier mwumbmxr-6-m5fa separately passed 4/4 and found no static blocker. User selected «Autorizar un smoke aislado» for one execution using the listed executables. job-3 launched; no browser or real database use.
- L4: job-3 exited 0. Verified Windows ACL, migrations, two synthetic drafts, five public API filter assertions, and confirmed stop and directory removal. No credential handoff file in smoke mode. Authenticated browser QA remains deferred.
- L5: Executable work unit is the single slice `8928741..cf11e34` (414 authored lines, including tests and docs). The original branch remains intact. For delivery, the user selected a draft integration tracker based on `main` (`5db2f16`), with one executable child slice (398 lines: CLI, fixtures, tests and usage guide). The tracker holds the delivery record; integrate the child before merging the tracker.
