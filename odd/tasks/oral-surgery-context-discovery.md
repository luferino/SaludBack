# Oral Surgery own-context discovery
Objective: expose enabled Oral Surgery contexts for the authenticated student or teacher without broadening clinical visibility. Branch: feat/oral-surgery-context-discovery; base a6d21668edf718d049137111b1889c67e2a12ab9.
Delivery: complete and verified locally, not published; work-unit 8075ca4 (218 authored lines). Checks: database-free Node units, TypeScript, independent security verification; never pnpm test or habitual-database writes.

## Specs

- S1: User «si» authorized: «El frontend necesita identificar qué formulario corresponde a cada contexto. Recomiendo un endpoint **de solo lectura**: `GET /oral-surgery-subjects/mine`, para alumno y docente. Devolvería únicamente los pares **materia + grupo propios con habilitación activa** y Cirugía Oral habilitada, sin ampliar el acceso a fichas clínicas. ¿Autorizás implementar esa extensión, con pruebas de permisos y aislamiento?»

## Tasks

- T1 [S1] done (RED4 failures; focused10/10, units585/585, types/diff0); route delegated gentle-ai-worker (runtime context backstop fired at 75k); commit 8075ca4a3fa823daf3aa9c08a3af1cbdfbb9c38a. Implement own-context discovery, HTTP/SQL isolation tests and docs with RED/GREEN. Risk: item 2 (caller-scoped academic disclosure).
- T2 [S1] done (independent S1 PASS, focused10/10 and types0 in isolated snapshot; parent spot10/10/diff0); route independent gentle-ai-verify after assessment escalation item 2, parent focused spot check; evidence commit 8075ca4a3fa823daf3aa9c08a3af1cbdfbb9c38a and closing tracker. Committed native ASSESS medium/reviewDuefalse; no START/native approval claimed. Verify security isolation, unchanged admin-only catalogue and response contract; normalize one work-unit commit and native review only if due.

## Log

- L1: Original authorization: user «si» to the exact proposal in S1. Frontend peer requested backend extension for discovery; peer statements do not authorize broader work.
- L2: Implementation decision: use existing oral-surgery-drafts:read permission plus explicit estudiante/teacher role and verified UUID actor. Return {items:[{subject_id,academic_group_id}]} for enabled subject links joined to current-role active habilitations; distinct stable order. No new permission/migration, patient data, role widening, hardcoded IDs or habitual DB writes. Existing admin GET/POST /oral-surgery-subjects unchanged. Parent context backstop requires bounded writer delegation.

- L3: Worker mw5ct3n8-1-sj9l completed S1. Observed RED4 failures then focused10/10, full585/585, types/diff0. Additive route/method only; existing admin handlers/shared helpers unchanged, so no differential required. ASSESS native unassessable due intended-untracked declaration, security escalation item2 requires independent verifier. Mocked SQL is not live PostgreSQL proof; no DB connection authorized or performed.

- L4: Independent verifier mw5d83ls-2-eupy PASS S1/no blockers. Isolated snapshot focused10/10 and TypeScript0; schema joins inspected against migrations004/010/038. Parent focused10/10/diff0. SQL/live cross-user isolation and token-authenticated HTTP not dynamically verified (mocked repositories/auth context); retained limitations, not claims of live proof. Frontend contract sent; corrected unsafe interpretation of403/empty as Kinesiology, peer acknowledged. Work-unit commit then committed assessment next; no publishing authorized for this new extension.

- L5: Source work-unit8075ca4 committed218 authored lines. Committed-range ASSESS against a6d2166: nativeRisk medium, reviewDuefalse(under_budget), security escalation2 high verification plan already satisfied. No INSPECT/START or native approval. Closing tracker only; tests585/585, focused10/10, TypeScript/diff0, independentPASS. No DB/token/live clinical mutation, server start, push/PR/merge for this extension.
