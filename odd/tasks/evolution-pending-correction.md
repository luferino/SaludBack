# Evolution pending-correction marker
Tell origin readers that an evolution draft was returned for correction, with its reason, without exposing it across care contexts.
Branch: feat/evolution-pending-correction from main f857f62. Frontend rendering is owned by a separate SaludFrond session.

## Specs
- S1: Human decision verbatim (option «Campo en la lista (recomendado)»): «Backend: un campo opcional nuevo `pending_correction` { reason, requested_at, reviewed_by } en la lista y el detalle, solo para lectores de origen y solo si el borrador viene de una corrección. Front: «Corrección solicitada: <motivo>» en el ítem. Una sola request, cambio aditivo.»
- S2: Question framing verbatim: «¿Cómo querés que el estudiante se entere de que le devolvieron una evolución para corregir? En todas las opciones, el contexto cruzado sigue sin ver las correcciones.»
- S3: Backend contract (parent technical decision from S1): `GET /kinesiology-evolutions/:id` and `GET /kinesiology-evolutions?patient_id=…` include `pending_correction: { reason, requested_at, reviewed_by }` only when the reader is an origin reader (author with live origin assignment, or active origin teacher), the evolution status is `draft`, and a correction request targets the evolution's latest submission. Otherwise the key is absent (not null). After the student resubmits, after validation, or for a draft never submitted, it is absent. Cross-context readers never receive it. Additive: no existing key, status, filter or ordering changes.
- S4: Frontend shows «Corrección solicitada: <motivo>» on the evolution list item when `pending_correction` is present (separate frontend session).

## Tasks
- T1 [S1-S3] done — RED observed inline (L5); GREEN by gentle-ai-worker mwgjjtnl-1-2xz4, parent diff spot-check (L6). Commit: see L6.
- T2 [S3] done — gentle-ai-verify mwgjw1xp-2-6d0q: S1/S2/S3 PASS, no blockers (L7).
- T3 [S1-S3] done — RDD assess medium, reviewDue false (under_budget); no native review due (L8).
- T4 [S3] done — issue #73, PR #74 merged 174043f (L9-L10).
- T5 [S4] blocked — awaiting human-opened Pi session in SaludFrond/.pi/evolution-correction-marker reading .pi/TASK-evolution-correction-marker.md (L12).

## Log
- L1: User request verbatim: «empecemos con el 1 y sigamos» (item 1 = «Una decisión de producto: las evoluciones corregidas aparecen como «Enviada» porque no tienen página de detalle. ¿Les agregamos una marca de corrección?»).
- L2: Exploration: requestCorrection restores the latest snapshot into the draft and sets status `draft` (pg-kinesiology-evolution.repository.ts:226); origin readers saw «Borrador» without a reason; cross-context readers see the latest submitted snapshot by design (README:358). Corrected the earlier «Enviada for everyone» claim. Human chose S1.
- L3: Supersedes clinical-followup-fixes.md T5 (blocked product decision).
- L4: First RED run refused in 5s (migration failed: root node_modules partially emptied by the parent's earlier rm -rf of leftover pnpm worktree dirs). Repaired with `pnpm install --force --frozen-lockfile --offline`; frontend unaffected.
- L5: RED observed (job-3): 183 pass / 1 fail; the only failure is the new assertion 'author detail exposes the pending correction' (actual undefined); absence assertions for never-submitted and awaiting-review states already pass. CLEANUP_OK salud_e2e_eace39c00edbbca8. GREEN delegated to gentle-ai-worker.
- L6: GREEN (worker mwgjjtnl-1-2xz4): pendingCorrectionJoin LATERAL (newest request for latest submission) in detail/list only; three CASE columns gated by (originRead) AND e.status='draft'; serialize emits pending_correction only when present; README endpoint rows + evolutions paragraph. Checks: tsc exit 0; unit 671/671; guarded PG 184/184 CLEANUP_OK salud_e2e_5c344238b457474c; git diff --check 0. Parent spot-check confirms gating reuses originRead with parentheses and submissions() untouched. Committed as the T1 work unit (high-risk item 2, own commit).
- L7: Independent verify (mwgjw1xp-2-6d0q) on bc428bb: S1/S2/S3 PASS; tsc 0; guarded PG 184/184 CLEANUP_OK salud_e2e_13f25fcc194c1542; status unchanged. Confirmed originRead parenthesized in new CASEs, LATERAL LIMIT 1 + UNIQUE(submission_id) (migration 033) so no duplicate rows, create/amend/edit and submissions/corrections unchanged. Non-blocking: untested-but-correct cases (former origin reader with cross access during pending correction, origin teacher list, uncorrected amendment, other-career and admin during pending); PATCH /:id response omits pending_correction (frontend must not rely on it); keep the redundant draft gate.
- L8: gentle_review assess (base f857f62, committedOnly): risk medium, reviewDue false (under_budget), plan independentVerifier false; independent verification already done for item 2.
- L9: Human «si» authorized issue+PR. Issue #73 (status:approved, type:feature); pushed feat/evolution-pending-correction; PR #74 base main head b6fbe8f, Closes #73, type:feature, OPEN/MERGEABLE. Not merged. This tracking update is local (uncommitted).
- L10: Human «si» authorized merge. PR #74 merged 2026-11-14T15:56:15Z, merge commit 174043fcde7cf67c70a0b9e7434841458f80239d (head guard b6fbe8f, branch kept); issue #73 closed. Frontend validateItem tolerates unknown keys, so main is not broken by the new field.
- L11: Frontend worktree SaludFrond/.pi/evolution-correction-marker on feat/evolution-correction-marker from origin/main a5335a8 (deps installed offline); task file .pi/TASK-evolution-correction-marker.md inside it (ignored). Opening a pane failed: HERDR_UNAVAILABLE. Main frontend checkout untouched (other session on fix/oral-authorize-assignment, clean).
- L12: Human chose «Abro yo una sesión ahí (recomendado)»: the human opens Pi manually in the frontend worktree and points it at the task file. Backend tracking edits (L9-L12) stay uncommitted on main working tree until a docs PR (with the D4 close patch).
