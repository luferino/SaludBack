-- Schema-only habilitation periods for teacher and student profiles.
-- Activation and revocation are recorded as period facts; application policy
-- must authorize actors and operations separately. These references do not
-- establish that an actor is authorized to perform the recorded action.
-- Historical profile, context, and actor references are restrictive.
-- src/db/migrate.ts owns the per-file transaction and migration ledger.

CREATE TABLE teacher_academic_habilitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE NO ACTION,
  subject_id UUID NOT NULL,
  academic_group_id UUID NOT NULL,
  activated_by UUID NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  activated_at TIMESTAMPTZ NOT NULL,
  revoked_by UUID REFERENCES users(id) ON DELETE NO ACTION,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT teacher_habilitations_context_fk
    FOREIGN KEY (subject_id, academic_group_id)
    REFERENCES subject_academic_groups(subject_id, academic_group_id)
    ON DELETE NO ACTION,
  CONSTRAINT teacher_habilitations_revocation_pair
    CHECK ((revoked_by IS NULL) = (revoked_at IS NULL)),
  CONSTRAINT teacher_habilitations_chronology
    CHECK (revoked_at IS NULL OR revoked_at >= activated_at)
);

CREATE UNIQUE INDEX teacher_habilitations_one_active_context
  ON teacher_academic_habilitations (teacher_id, subject_id, academic_group_id)
  WHERE revoked_at IS NULL;

CREATE TABLE student_academic_habilitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE NO ACTION,
  subject_id UUID NOT NULL,
  academic_group_id UUID NOT NULL,
  activated_by UUID NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  activated_at TIMESTAMPTZ NOT NULL,
  revoked_by UUID REFERENCES users(id) ON DELETE NO ACTION,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT student_habilitations_context_fk
    FOREIGN KEY (subject_id, academic_group_id)
    REFERENCES subject_academic_groups(subject_id, academic_group_id)
    ON DELETE NO ACTION,
  CONSTRAINT student_habilitations_revocation_pair
    CHECK ((revoked_by IS NULL) = (revoked_at IS NULL)),
  CONSTRAINT student_habilitations_chronology
    CHECK (revoked_at IS NULL OR revoked_at >= activated_at)
);

CREATE UNIQUE INDEX student_habilitations_one_active_context
  ON student_academic_habilitations (student_id, subject_id, academic_group_id)
  WHERE revoked_at IS NULL;
