# Academic read listings
Branch: feat/academic-read-listings (base: feat/kinesiology-amendments). Delivery: feature-branch-chain; forecast 1200–1800 authored lines, slices: profile selectors, habilitation history. No push/PR authorized.
Runner: node --import tsx --test tests/unit/*.test.js; pnpm exec tsc --noEmit. Risk: item 2 (read permissions and academic context isolation).

## Specs
S1. "GET /teachers: docentes seleccionables, con UUID del perfil, nombres y apellidos."
S2. "GET /students: estudiantes seleccionables, con UUID del perfil, nombres, apellidos y código de alumno."
S3. "GET /teacher-habilitations: períodos docentes con sus identificadores, contexto académico y datos de activación/revocación."
S4. "GET /student-habilitations: períodos de estudiantes con los mismos datos."
S5. "Paginación { items, limit, offset }, consistente con los catálogos existentes."
S6. "Filtros por perfil, asignatura, grupo y estado activo/revocado para habilitaciones."
S7. "Diferenciar explícitamente el UUID del perfil del UUID de la cuenta."
S8. "Definir permisos de lectura y alcance por contexto: no asumir que tener permiso de escritura habilita los listados."
S9. "No exponer contraseñas ni datos personales innecesarios."
S10. "Documentar respuestas, filtros, permisos y errores en el README, con sus pruebas."
S11. Accepted policy: "Administración + docentes — recomendada: admin consulta todo; los docentes pueden seleccionar estudiantes —solo UUID, nombres, apellidos y código— y consultar habilitaciones estudiantiles únicamente dentro de sus contextos académicos activos. No acceden al listado general de docentes ni de habilitaciones docentes." User: "si, la segunda opcion".

## Tasks
T1 | S1,S2,S5,S7-S11 | delegated profile selectors + parent wiring/seeds/README | done | commit bf6e0991ed346d8bb8c5f1e3b276b118e3bbc338; RED 404/absent list; GREEN 20 focused tests, 2 seed tests, real PostgreSQL selector tests
T2 | S3-S11 | delegated habilitation history + parent wiring/seeds/README | done | commit b07b723b7d67ef639da3b017ab599d9a50e7e3a0; RED 404 then GREEN 22 focused tests; uppercase UUID RED fixed, 10 focused + 5 PostgreSQL tests and tsc passed
T3 | S1-S11 | inline seam checks + independent security verification + native review when due | done | functional/security checks PASS; native review of slice 2 b07b723 approved and acknowledged, authority burned (review-66b3cedf588ccc4b); slice 1 selectors retain functional/independent verification, no separate native approval claimed

## Log
L1. Original request (verbatim):
hola, la sesion del frod me pidio estos requisitos:  Necesitamos integrar habilitaciones docentes y de estudiantes en el frontend sin ingresar
 │ UUID manualmente.
 │
 │ Endpoints propuestos:
 │ - GET /teachers: docentes seleccionables, con UUID del perfil, nombres y apellidos.
 │ - GET /students: estudiantes seleccionables, con UUID del perfil, nombres, apellidos y
 │   código de alumno.
 │ - GET /teacher-habilitations: períodos docentes con sus identificadores, contexto académico
 │   y datos de activación/revocación.
 │ - GET /student-habilitations: períodos de estudiantes con los mismos datos.
 │
 │ Contrato necesario:
 │ - Paginación { items, limit, offset }, consistente con los catálogos existentes.
 │ - Filtros por perfil, asignatura, grupo y estado activo/revocado para habilitaciones.
 │ - Diferenciar explícitamente el UUID del perfil del UUID de la cuenta.
 │ - Definir permisos de lectura y alcance por contexto: no asumir que tener permiso de
 │   escritura habilita los listados.
 │ - No exponer contraseñas ni datos personales innecesarios.
 │ - Documentar respuestas, filtros, permisos y errores en el README, con sus pruebas.
L2. User authorized: "primero verifica y luego implementa". Exploration confirmed all four GETs absent; existing catalog validation and exact permission matching must be reused. Existing local .gitignore/.engram/.pi/odd/delivery changes are unrelated and must remain untouched.
L3. User approved policy in S11: "si, la segunda opcion". Admin reads all four with explicit permissions; teachers receive students:read and student-habilitations:read, the latter scoped to live teacher contexts. Minimal global student selector intentionally includes not-yet-habilitated students.
L4. Delivery choice: "Cadena sobre rama de funcionalidad — recomendada" (feature-branch-chain). Each behavior includes its tests and README; approximate slice size is advisory, not a reason to omit coverage. No publishing authorized.
L5. Planned contract: defaults limit=50/offset=0, bounds 1..100 and 0..10000; teacher_id/student_id, subject_id, academic_group_id UUID filters; status=active|revoked. Profile id is not account id; actor ids are account ids. Admin global access still requires exact read grant; teachers' scope is applied before pagination. Unknown valid IDs produce empty lists, explicit unauthorized teacher contexts are forbidden. Tests must not mutate an unverified existing database.
L6. Parent seam check: 377/377 unit tests passed; pnpm exec tsc --noEmit passed. The full legacy pnpm test was intentionally not run because its pretest and integration cleanup mutate shared state. New real-PostgreSQL tests use a unique schema in one transaction, schema-only search_path and unconditional rollback; selectors, grants, invalid reads and teacher scope pass. Integration fixture corrections: BAD_REQUEST is the existing error code; Express simple query parser treats bracketed names as unknown parameters; timestamps now use SET LOCAL TIME ZONE UTC. A genuine new RED found case-sensitive comparison of accepted uppercase UUID context filters; writer is normalizing only new list-usecase inputs. Independent verification and native review remain pending.
L7. Uppercase-filter correction GREEN: both list-usecase filters normalize validated UUIDs to lowercase, leaving shared validators/write paths untouched. Worker ran 10 focused unit tests, all 5 rollback-isolated PostgreSQL integration tests, and tsc successfully. Independent verifier launched once over S1-S11, including public POST differential probes against baseline c89e4a9a1392bdcdea3f9cf9d4224d0ce74890b8. ASSESS reports security escalation item 2; native assessment awaits explicit untracked scope, to be resolved at committed slice review. No review authority created yet.
L8. Independent verifier PASS S1-S11, no candidate-caused blockers. Focused suite 16/16, PostgreSQL API 5/5, tsc exit 0. Differential: 72 observations/version over six existing create/revoke endpoints, four query variants and three request modes; stdout identical (18540 bytes), stderr empty, exits 0, mocked persistence only. Parent final focused spot-check also 16/16.
L9. Slice 1 committed bf6e0991ed346d8bb8c5f1e3b276b118e3bbc338 (284 authored additions), profile selectors with tests/docs/seed027. Slice 2 starts from that exact boundary and contains habilitation history, tests/docs/seed028 and this feature record (about 750 authored lines). It remains one cohesive security-sensitive unit: shared context-filter semantics, real PostgreSQL scope tests and documentation must be reviewed together; no artificial test/docs split. Existing base-branch changes are not part of this feature's review scope.
L10. Native assessment unavailable (untracked declaration required despite committedOnly). After inspect excluding unrelated untracked paths, START requested committed-only slice 1 from c89e4a9a1392bdcdea3f9cf9d4224d0ce74890b8 with risk/readability/reliability lenses; controller returned native-start-retained-selection-candidate-mismatch, mutation_performed=false, mutation_outcome=none. Fresh required INSPECT returned workspace-bound intended-untracked selection, not the requested committed slice. No lineage, consent, authority, verdict or acknowledgement was created. No retry/workaround/recovery is authorized or attempted. Native proof is unavailable; human decision required: leave this candidate unreviewed or separately authorize integration repair. Source implementation, README and functional/security verification are complete. No push/PR/migration on existing data performed.
L11. Slice 2 committed b07b723b7d67ef639da3b017ab599d9a50e7e3a0 (741 additions/11 deletions); total feature 1025 additions/11 deletions from c89e4a9a1392bdcdea3f9cf9d4224d0ce74890b8. First slice bf6e099 is 284 additions. git diff --cached --check passed after removing one trailing space in a new test. No observable code changed after independent PASS. This final task-hash bookkeeping is retained locally; native review remains unavailable/not approved for both slices and no lifecycle was created. Only required decision remains the native-review disposition/repair; no further verification loop is started.
L12. User authorized separate investigation: "si, autorizo investigar por separado" and explicitly allowed read-only access to installed gentle-pi. Diagnosis corrected the prior package-defect hypothesis: parent used workspace INSPECT before committed-range START. Source and read-only probe confirm INSPECT accepts serialized input {baseRef,committedOnly:true}; matching range returns ready/base-diff. ASSESS requires explicit fresh inventory and does not inherit INSPECT retention. Package gentle-pi 4.3.0 intentionally pins native Gentle AI 4.2.0; no package repair justified or performed.
L13. User authorized review resumption: "si, adelante". Fresh INSPECT on base bf6e0991ed346d8bb8c5f1e3b276b118e3bbc338 with committedOnly=true and untrackedScope=exclude selected only slice 2 b07b723 (15 paths, 752 authored lines). START created lineage review-66b3cedf588ccc4b with native medium tier and risk/readability/reliability lenses. Forecast relayed: three pi_host_relay model runs. Complete current reviewer group submitted once; last event closed approved. Exact facade acknowledgement completed with authority=burned, outcome=native-approved-acknowledgement-completed, target sha256:ab88f4345cd4eb548d0b927f84161aacb24112619b05be2333cb6bd139ce2179, consumed revision sha256:55dc1f9e380afea6b0e63d5ffaac0d5b3f4e344ca95bce75f662c92bbdfbc041. No STATUS after burn. No correction, code change, push/PR or existing-database migration. Approval covers slice 2 only; slice 1 selectors have prior functional and independent PASS, not a separate native approval. Historical pending entries above are superseded by this evidence. Final tracking updates remain local.
