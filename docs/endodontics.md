# Endodontics subject configuration

T1 delivers explicit administrator-managed Odontology subject links only. No existing subject is enabled by its name or other catalogue fields.

- `POST /endodontics-subjects` accepts only `{"subject_id":"<UUID>"}` and creates one link; it returns `201` with `subject_id`, `career_id`, `created_by` and `created_at`.
- `GET /endodontics-subjects` returns `{"items":[...]}` ordered by subject ID.
- Both operations require the `admin` role and their separate permissions: `endodontics-subjects:write` for create and `endodontics-subjects:read` for list.
- The subject must already exist and belong to the `odontology` career. Unknown and non-Odontology subjects return `404 odontology subject was not found`; duplicate links return `409 subject is already enabled for endodontics`.
- Malformed or extra input fields return `400`. There is no unlink, name-based inference, `/mine`, clinical draft, or clinical permission in this scope.
- Migrations 065 and 066 add the constrained link table and admin-only read/write grants. The table reuses the `(id, code)` career key introduced in migration 038; no catalogue semantics or existing grants change.
