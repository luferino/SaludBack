# Patient assignment management report
Branch: feat/assignment-report. Base: 65b360b. Status: functionally verified.
Risk: item 2 (dedicated authorization and aggregate patient data).

## Specs
- S1: «Asignaciones de pacientes (recomendado)» — «Cuántas asignaciones se crearon en el período, por carrera, materia y grupo. Una persona puede tener más de una.»
- S2: «Solo administración (recomendado)» — «Acceso con permiso específico, sin ampliar los permisos de otros roles.»
- S3: «okey, y la misma zona horaria PYT, también preguntame lo que necesites para avanzar o confirmar»
- S4: «Sí, contar todas las creadas (recomendado)» — «El reporte mide actividad histórica; cerrar una asignación no cambia el conteo del período.»
- S5: «Implementar primero la API (recomendado)» — «Dejar el contrato, permiso y conteos probados en SaludBack; la pantalla de SaludFrond llega aparte.»

## Tasks
- T1 [S1-S5] functionally verified; inline; work unit `feat(reports): add administrative assignment report`. Add admin-only read-only aggregate endpoint, permission seed and public checks; no frontend, deployment or existing database writes.

## Log
- L1: «okey, definamos el alcance»
- L2: Follow-up decisions S1–S5; Engram #1545. Use assigned_at and the original student habilitation period, including ended assignments; America/Asuncion local calendar boundaries. No personal or clinical fields.
- L3: Explorer mwuo5ike-7-37jl mapped authentication, permission, schema and test seams. Use required inclusive from/to dates, converted to half-open instants, and return a combined breakdown by career/subject/group plus total.
- L4: Observed RED (report module absent), then GREEN 3/3 public HTTP checks and TypeScript pass. Migration 063 adds only the dedicated admin grant; exact-ledger fixtures and permission reset were updated. Full unit job-11 and independent verifier mwuobmed-8-ysxo in flight. Real PostgreSQL validation not yet run.
- L5: Independent static review found exact-baseline drift: permission/grant fixtures retained 55/72 and patient-personal-data expected 061 at ledger[-2]. Updated canonical inventories to 56/73 and the migration tail to 061/062/063. Focused guard checks initially failed on the remaining revocation count (27/28); corrected exact count and passed 28/28 with diff check. Final full suite and real PostgreSQL verification remain pending.
- L6: Initial full suite also found two cleanup mocks that expected 51 calls; 063 adds one seed call. Updated the counts and asserted the enforced admin grant is reseeded. Recheck mwuogkkw-9-b4i5 passed 31/31; final job-12 passed 787/787 unit tests, TypeScript and diff check.
- L7: User selected «Autorizar la prueba aislada» (one run). Job-13 started a report-specific scratch probe using the existing disposable cluster safeguards. It will check real login, migration 063 and exact admin grant, Paraguay boundaries and ended rows, denials, and cleanup. Exit 0: verified private ACL, migrations through 063, enforced permission granted only to admin, four report cases including both Paraguay midnight boundaries and an ended assignment, and two real HTTP auth denials. Verified cluster stop and directory removal. Full repository integration suite was not run.
