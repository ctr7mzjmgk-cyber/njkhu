/*
# HR Module — Staff Management Architecture & RBAC

## Summary
Adds a complete HR (Ressources Humaines) module for managing administrative and
support staff within an institution. Introduces:
- A new `rh` role with granular HR permissions.
- Hierarchical departments (directions/services) with unlimited nesting depth.
- Positions/job functions (postes/fonctions).
- Staff records linked to existing `profiles` (no duplication of person data).
- Staff assignments linking staff to departments + positions with date ranges.

## Design Decisions
1. **Reuse profiles**: Staff records reference `profiles.id` via `profile_id`.
   No first_name/last_name duplication — those live on profiles.
2. **No existing roles/permissions modified**: The `rh` role and HR permissions
   are purely additive. super_admin bypasses permission checks via `has_permission()`.
3. **Hierarchical departments**: `hr_departments` has `parent_id` self-reference
   supporting unlimited nesting (Direction générale → Sous-direction → Service → Unité).
   `level` column (1-based) is maintained by a trigger for convenience queries.
4. **Institution-scoped**: All HR tables carry `institution_id`, matching the
   existing pattern used by students, teachers, expenses, etc.

## New Tables

### hr_departments
Hierarchical organizational units (directions, sous-directions, services).
- `id` (uuid PK)
- `institution_id` (uuid FK → institutions)
- `parent_id` (uuid FK → hr_departments, nullable — NULL = root/top level)
- `code` (text, unique per institution)
- `name` (text)
- `description` (text, nullable)
- `level` (int, default 1 — 1 = Direction générale, 2 = Sous-direction, etc.)
- `is_active` (boolean, default true)
- `created_at`, `updated_at` (timestamptz)

### hr_positions
Job functions / postes that can be assigned to staff.
- `id` (uuid PK)
- `institution_id` (uuid FK → institutions)
- `code` (text, unique per institution)
- `name` (text)
- `description` (text, nullable)
- `category` (text, nullable — e.g. "administratif", "technique", "support")
- `is_active` (boolean, default true)
- `created_at`, `updated_at` (timestamptz)

### hr_staff
Staff records for administrative and support personnel. Links to profiles.
- `id` (uuid PK)
- `institution_id` (uuid FK → institutions)
- `profile_id` (uuid FK → profiles, nullable — can exist before account creation)
- `staff_number` (text, unique per institution)
- `hire_date` (date)
- `status` (text: 'active' | 'on_leave' | 'terminated' | 'retired')
- `employment_type` (text, nullable: 'cdi' | 'cdd' | 'internship' | 'consultant')
- `personal_email` (text, nullable)
- `personal_phone` (text, nullable)
- `address` (text, nullable)
- `birth_date` (date, nullable)
- `birth_place` (text, nullable)
- `gender` (text, nullable)
- `nationality` (text, nullable)
- `marital_status` (text, nullable)
- `emergency_contact_name` (text, nullable)
- `emergency_contact_phone` (text, nullable)
- `created_at`, `updated_at` (timestamptz)

### hr_assignments
Links staff to a department + position with date ranges. Supports career history.
- `id` (uuid PK)
- `staff_id` (uuid FK → hr_staff)
- `department_id` (uuid FK → hr_departments)
- `position_id` (uuid FK → hr_positions, nullable)
- `start_date` (date)
- `end_date` (date, nullable — NULL = current/active assignment)
- `is_primary` (boolean, default true — marks the main assignment)
- `notes` (text, nullable)
- `created_at`, `updated_at` (timestamptz)

## New Role
- `rh` (Ressources Humaines) — manages staff within their institution only.

## New Permissions (module: 'hr')
- `hr.view` — View HR data (departments, positions, staff, assignments)
- `hr.create` — Create HR records
- `hr.update` — Modify HR records
- `hr.delete` — Delete HR records

## Security
- RLS enabled on all 4 new tables.
- Policies follow the existing pattern: `has_permission('hr.*')` + institution match.
- super_admin bypasses all checks via `has_permission()`.
- `rh` role gets all 4 HR permissions + limited read access to `users.view`
  (to see profiles of staff with accounts) and `documents.view`/`documents.create`.

## Notes
1. This migration only creates the architecture and RBAC. Full UI functionality
   will be built incrementally in subsequent steps.
2. The `hr` role is also granted `settings.view` so HR users can see institution info.
3. The manage-user edge function already handles arbitrary role codes, so no
   changes are needed there — `rh` is just another role code.
*/

-- ============================================================
-- 1. New permissions (additive — no existing data modified)
-- ============================================================
INSERT INTO public.permissions (code, name, module) VALUES
  ('hr.view', 'Consulter les ressources humaines', 'hr'),
  ('hr.create', 'Créer des enregistrements RH', 'hr'),
  ('hr.update', 'Modifier les enregistrements RH', 'hr'),
  ('hr.delete', 'Supprimer des enregistrements RH', 'hr')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. New role: rh
-- ============================================================
INSERT INTO public.roles (code, name, description)
VALUES ('rh', 'Ressources Humaines', 'Gestion du personnel administratif et support')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. Assign permissions to rh role
-- ============================================================
DO $$
DECLARE
  v_rh uuid := (SELECT id FROM public.roles WHERE code = 'rh');
BEGIN
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_rh, id FROM public.permissions
  WHERE code IN (
    'hr.view', 'hr.create', 'hr.update', 'hr.delete',
    'users.view',
    'documents.view', 'documents.create',
    'notifications.view', 'notifications.create',
    'settings.view',
    'reports.view'
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- ============================================================
-- 4. hr_departments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_departments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES public.hr_departments(id) ON DELETE SET NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  level           integer NOT NULL DEFAULT 1,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_departments_code_not_empty CHECK (length(btrim(code)) > 0),
  CONSTRAINT hr_departments_name_not_empty CHECK (length(btrim(name)) > 0),
  CONSTRAINT hr_departments_level_positive CHECK (level >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_departments_inst_code
  ON public.hr_departments (institution_id, code);

CREATE INDEX IF NOT EXISTS idx_hr_departments_parent ON public.hr_departments (parent_id);
CREATE INDEX IF NOT EXISTS idx_hr_departments_institution ON public.hr_departments (institution_id);

ALTER TABLE public.hr_departments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. hr_positions table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_positions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  category        text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_positions_code_not_empty CHECK (length(btrim(code)) > 0),
  CONSTRAINT hr_positions_name_not_empty CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_positions_inst_code
  ON public.hr_positions (institution_id, code);

CREATE INDEX IF NOT EXISTS idx_hr_positions_institution ON public.hr_positions (institution_id);

ALTER TABLE public.hr_positions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. hr_staff table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_staff (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id          uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  profile_id              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  staff_number            text NOT NULL,
  hire_date               date NOT NULL DEFAULT CURRENT_DATE,
  status                  text NOT NULL DEFAULT 'active',
  employment_type         text,
  personal_email          text,
  personal_phone          text,
  address                 text,
  birth_date              date,
  birth_place             text,
  gender                  text,
  nationality             text,
  marital_status          text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_staff_status_valid CHECK (
    status IN ('active', 'on_leave', 'terminated', 'retired')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_staff_inst_number
  ON public.hr_staff (institution_id, staff_number);

CREATE INDEX IF NOT EXISTS idx_hr_staff_institution ON public.hr_staff (institution_id);
CREATE INDEX IF NOT EXISTS idx_hr_staff_profile ON public.hr_staff (profile_id);
CREATE INDEX IF NOT EXISTS idx_hr_staff_status ON public.hr_staff (status);

ALTER TABLE public.hr_staff ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. hr_assignments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hr_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        uuid NOT NULL REFERENCES public.hr_staff(id) ON DELETE CASCADE,
  department_id   uuid NOT NULL REFERENCES public.hr_departments(id) ON DELETE RESTRICT,
  position_id     uuid REFERENCES public.hr_positions(id) ON DELETE SET NULL,
  start_date      date NOT NULL DEFAULT CURRENT_DATE,
  end_date        date,
  is_primary      boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_assignments_end_after_start CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_hr_assignments_staff ON public.hr_assignments (staff_id);
CREATE INDEX IF NOT EXISTS idx_hr_assignments_department ON public.hr_assignments (department_id);
CREATE INDEX IF NOT EXISTS idx_hr_assignments_position ON public.hr_assignments (position_id);
CREATE INDEX IF NOT EXISTS idx_hr_assignments_active ON public.hr_assignments (staff_id) WHERE end_date IS NULL;

ALTER TABLE public.hr_assignments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. Trigger: auto-maintain department level based on parent
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_hr_department_level()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.level := 1;
  ELSE
    SELECT d.level + 1 INTO NEW.level
    FROM public.hr_departments d
    WHERE d.id = NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_hr_department_level() TO authenticated;

DROP TRIGGER IF EXISTS trg_hr_departments_level ON public.hr_departments;
CREATE TRIGGER trg_hr_departments_level
  BEFORE INSERT OR UPDATE OF parent_id ON public.hr_departments
  FOR EACH ROW EXECUTE FUNCTION public.set_hr_department_level();

-- ============================================================
-- 9. Trigger: updated_at on HR tables
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;

DROP TRIGGER IF EXISTS trg_hr_departments_updated_at ON public.hr_departments;
CREATE TRIGGER trg_hr_departments_updated_at
  BEFORE UPDATE ON public.hr_departments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_hr_positions_updated_at ON public.hr_positions;
CREATE TRIGGER trg_hr_positions_updated_at
  BEFORE UPDATE ON public.hr_positions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_hr_staff_updated_at ON public.hr_staff;
CREATE TRIGGER trg_hr_staff_updated_at
  BEFORE UPDATE ON public.hr_staff
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_hr_assignments_updated_at ON public.hr_assignments;
CREATE TRIGGER trg_hr_assignments_updated_at
  BEFORE UPDATE ON public.hr_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 10. RLS Policies — hr_departments
-- ============================================================
DROP POLICY IF EXISTS "select_hr_departments" ON public.hr_departments;
CREATE POLICY "select_hr_departments" ON public.hr_departments FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_hr_departments" ON public.hr_departments;
CREATE POLICY "insert_hr_departments" ON public.hr_departments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_permission('hr.create') AND institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "update_hr_departments" ON public.hr_departments;
CREATE POLICY "update_hr_departments" ON public.hr_departments FOR UPDATE
  TO authenticated
  USING (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  WITH CHECK (public.has_permission('hr.update') AND institution_id = public.current_institution_id());

DROP POLICY IF EXISTS "delete_hr_departments" ON public.hr_departments;
CREATE POLICY "delete_hr_departments" ON public.hr_departments FOR DELETE
  TO authenticated
  USING (public.has_permission('hr.delete') AND institution_id = public.current_institution_id());

-- ============================================================
-- 11. RLS Policies — hr_positions
-- ============================================================
DROP POLICY IF EXISTS "select_hr_positions" ON public.hr_positions;
CREATE POLICY "select_hr_positions" ON public.hr_positions FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_hr_positions" ON public.hr_positions;
CREATE POLICY "insert_hr_positions" ON public.hr_positions FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_permission('hr.create') AND institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "update_hr_positions" ON public.hr_positions;
CREATE POLICY "update_hr_positions" ON public.hr_positions FOR UPDATE
  TO authenticated
  USING (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  WITH CHECK (public.has_permission('hr.update') AND institution_id = public.current_institution_id());

DROP POLICY IF EXISTS "delete_hr_positions" ON public.hr_positions;
CREATE POLICY "delete_hr_positions" ON public.hr_positions FOR DELETE
  TO authenticated
  USING (public.has_permission('hr.delete') AND institution_id = public.current_institution_id());

-- ============================================================
-- 12. RLS Policies — hr_staff
-- ============================================================
DROP POLICY IF EXISTS "select_hr_staff" ON public.hr_staff;
CREATE POLICY "select_hr_staff" ON public.hr_staff FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_hr_staff" ON public.hr_staff;
CREATE POLICY "insert_hr_staff" ON public.hr_staff FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_permission('hr.create') AND institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "update_hr_staff" ON public.hr_staff;
CREATE POLICY "update_hr_staff" ON public.hr_staff FOR UPDATE
  TO authenticated
  USING (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  WITH CHECK (public.has_permission('hr.update') AND institution_id = public.current_institution_id());

DROP POLICY IF EXISTS "delete_hr_staff" ON public.hr_staff;
CREATE POLICY "delete_hr_staff" ON public.hr_staff FOR DELETE
  TO authenticated
  USING (public.has_permission('hr.delete') AND institution_id = public.current_institution_id());

-- ============================================================
-- 13. RLS Policies — hr_assignments
-- ============================================================
DROP POLICY IF EXISTS "select_hr_assignments" ON public.hr_assignments;
CREATE POLICY "select_hr_assignments" ON public.hr_assignments FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.has_permission('hr.view')
      AND EXISTS (
        SELECT 1 FROM public.hr_staff s
        WHERE s.id = hr_assignments.staff_id
          AND s.institution_id = public.current_institution_id()
      )
    )
  );

DROP POLICY IF EXISTS "insert_hr_assignments" ON public.hr_assignments;
CREATE POLICY "insert_hr_assignments" ON public.hr_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_permission('hr.create')
    AND EXISTS (
      SELECT 1 FROM public.hr_staff s
      WHERE s.id = hr_assignments.staff_id
        AND s.institution_id = public.current_institution_id()
    )
  );

DROP POLICY IF EXISTS "update_hr_assignments" ON public.hr_assignments;
CREATE POLICY "update_hr_assignments" ON public.hr_assignments FOR UPDATE
  TO authenticated
  USING (
    public.has_permission('hr.update')
    AND EXISTS (
      SELECT 1 FROM public.hr_staff s
      WHERE s.id = hr_assignments.staff_id
        AND s.institution_id = public.current_institution_id()
    )
  )
  WITH CHECK (
    public.has_permission('hr.update')
    AND EXISTS (
      SELECT 1 FROM public.hr_staff s
      WHERE s.id = hr_assignments.staff_id
        AND s.institution_id = public.current_institution_id()
    )
  );

DROP POLICY IF EXISTS "delete_hr_assignments" ON public.hr_assignments;
CREATE POLICY "delete_hr_assignments" ON public.hr_assignments FOR DELETE
  TO authenticated
  USING (
    public.has_permission('hr.delete')
    AND EXISTS (
      SELECT 1 FROM public.hr_staff s
      WHERE s.id = hr_assignments.staff_id
        AND s.institution_id = public.current_institution_id()
    )
  );

-- ============================================================
-- 14. Verify
-- ============================================================
SELECT 'hr_departments' as entity, count(*) as cnt FROM public.hr_departments
UNION ALL
SELECT 'hr_positions', count(*) FROM public.hr_positions
UNION ALL
SELECT 'hr_staff', count(*) FROM public.hr_staff
UNION ALL
SELECT 'hr_assignments', count(*) FROM public.hr_assignments
UNION ALL
SELECT 'rh_role', count(*) FROM public.roles WHERE code = 'rh'
UNION ALL
SELECT 'hr_permissions', count(*) FROM public.permissions WHERE module = 'hr'
UNION ALL
SELECT 'rh_role_permissions', count(*) FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id WHERE r.code = 'rh';