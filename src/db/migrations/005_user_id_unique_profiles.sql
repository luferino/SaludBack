-- Additive migration: enforce the one-profile-per-account rule (STU-006 /
-- TEA-005). Nothing stopped a second students/teachers row from referencing
-- the same user_id before; these UNIQUE constraints close the gap.
--
-- Guarded pre-check: a DO $$ block scans for existing duplicates BEFORE any
-- DDL. A repo carrying duplicates aborts loudly, listing every affected
-- user_id with its profile ids -- no auto-repair: operators reconcile rows
-- manually and re-run. migrate.ts wraps the whole file in one transaction,
-- so the raise rolls the DDL back and skips the schema_migrations row.
--
-- Rollback: DROP CONSTRAINT students_user_id_unique / teachers_user_id_unique
-- (additive, no data loss). Constraint naming mirrors students_codalumno_unique
-- (004).

DO $$DECLARE d text;BEGIN
  SELECT string_agg(format('%s -> {%s}', user_id, ids), '; ')
    INTO d
    FROM (SELECT user_id, string_agg(id::text, ', ') AS ids
          FROM students GROUP BY user_id HAVING count(*) > 1) dup;
  IF d IS NOT NULL THEN RAISE EXCEPTION 'students.user_id duplicates: %', d; END IF;
  SELECT string_agg(format('%s -> {%s}', user_id, ids), '; ')
    INTO d
    FROM (SELECT user_id, string_agg(id::text, ', ') AS ids
          FROM teachers GROUP BY user_id HAVING count(*) > 1) dup;
  IF d IS NOT NULL THEN RAISE EXCEPTION 'teachers.user_id duplicates: %', d; END IF;
END $$;

ALTER TABLE students ADD CONSTRAINT students_user_id_unique UNIQUE (user_id);
ALTER TABLE teachers ADD CONSTRAINT teachers_user_id_unique UNIQUE (user_id);