# Hygiene and Preventive Dentistry II: plaque indices and remaining deliveries
Objective: second Hygiene and Preventive II delivery (Löe-Silness and O'Leary plaque indices on the clinical draft). Later deliveries (procedure log with teacher approval, informed consent) are recorded here as decisions only.
Branch: feat/hygiene-plaque-indices; base 6e0dc97. Source: .git/odonto-fichas/MODELO DE FICHA  Higiene y Preventiva II.txt (page 3).

## Specs

- S1: Delivery order selected: «Índices de placa (Recomendado)» — «Löe-Silness + O'Leary. Datos puros sobre el borrador, sin flujo docente; el más acotado.» Procedure log and informed consent are out of scope for this delivery.
- S2: Löe-Silness (range typo selected: «Corregir a 1,6–3 (Recomendado)» — «Asumir typo. Server promedia superficies registradas (pieza ausente se excluye) y clasifica POCA/MODERADA/ABUNDANTE.»). Confirmed rules («Confirmo (Recomendado)»): «Piezas fijas: 16, 21, 24, 36, 41, 44» «Sitios: distal, vestibular, mesial, palatino/lingual» «Grado entero 0-3 por sitio» «Pieza o sitio omitido = no presente (se excluye)» «Promedio = suma grados / sitios registrados (server, 2 decimales; sin sitios = sin promedio)» «Categoría: <=0,5 POCA | <=1,5 MODERADA | >1,5 ABUNDANTE»
- S3: O'Leary selected: «Diagrama completo, server calcula (Recomendado)» — «Por pieza presente: 4 superficies teñida sí/no. El server calcula % y categoría BUENO/REGULAR/MALO.» Confirmed rules: «Cualquier pieza FDI (permanente 11-48 y temporaria 51-85)» «Por pieza registrada: 4 superficies (M, D, V, P/L) teñida sí/no, las 4 obligatorias» «Pieza omitida = ausente / no evaluada» «% = teñidas x 100 / (4 x piezas registradas) (server, 1 decimal)» «Categoría: <=30 BUENO | <=60 REGULAR | >60 MALO»
- S4: General: «Nuevo bloque content.plaque en el borrador (sin migración, mismo PATCH versionado)» «promedio/%/categoría los calcula el server; si el cliente los envía -> 400 (como `total`)»
- S5 (later delivery, decision only): procedure log teacher signature selected: «Aprobación autenticada (Recomendado)» — «Un docente activo de la materia/grupo aprueba cada entrada con su sesión; queda quién y cuándo. Entrada aprobada = inmutable.»

## Tasks

- T1 [S1-S4] done; route inline; commit see L4. content.plaque validation, server-computed average/percentage/category on reads, unit tests, docs/hygiene-preventive.md.
- T2 [S5] pending (later session); procedure log with authenticated teacher approval. Needs its own product questions before coding.
- T3 [—] pending (later session); informed consent (consider reusing the Oral Surgery signed-paper declaration pattern). Needs product questions.

## Log

- L1: Original user request: «sigamos con Higiene y Preventiva».
- L2: Product decisions S1–S5 collected by structured questions.
- L3: Implementation choices: input is `plaque.loe_silness = { teeth: {...} }` and `plaque.oleary = { teeth: {...} }` (each section object or null); reads add computed siblings (`average`/`category`, `stained_surfaces`/`present_surfaces`/`percentage`/`category`). Surface names reuse the odontogram names (`mesial`, `distal`, `vestibular`, `lingual` = palatino/lingual). The category is derived from the rounded value shown, so displayed value and category never disagree.
- L4: RED: 5 new plaque tests failed (22 existing passed; log .git/gentle-scratch/plaque-red.log); the S1/S6 rejected-section list no longer includes `plaque`. GREEN: focused 27/27, full units 733/733 (0 skipped), tsc 0, diff-check 0. withIndexTotals renamed withComputedValues (module-internal; index totals still pinned by the S3 tests). No migration (content JSONB); migration 056 comment left untouched because applied migrations are not edited. No PostgreSQL run: the change touches only request validation and read mapping, already covered by the unit HTTP tests. Risk: none.
