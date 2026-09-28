/*
# HR Attendance Management — Schedules, Leave, Corrections

## Summary
Adds three tables for managing HR attendance beyond raw clock events:
1. attendance_schedules — expected work hours per staff (with grace period)
2. attendance_leave_requests — leave/vacation requests with approval workflow
3. attendance_corrections — traceable corrections to attendance events

## New Tables

### 1. attendance_schedules
Defines expected work hours for a staff member per weekday.
- `id` (uuid PK)
- `institution_id` (uuid FK → institutions)
- `staff_id` (uuid FK → hr_staff) — the employee
- `day_of_week` (int 0-6, NOT NULL) — 0=Sunday, 6=Saturday
- `start_time` (time, NOT NULL) — expected clock-in time
- `end_time` (time, NOT NULL) — expected clock-out time
- `grace_minutes` (int, default 15) — minutes of tolerance before "late"
- `is_active` (boolean, default true)
- `created_at` / `updated_at`
- UNIQUE (staff_id, day_of_week)

### 2. attendance_leave_requests
Leave/vacation requests with approval workflow.
- `id` (uuid PK)
- `institution_id` (uuid FK → institutions)
- `staff_id` (uuid FK → hr_staff)
- `leave_type` (text) — `vacation`, `sick`, `personal`, `unpaid`, `other`
- `start_date` (date, NOT NULL)
- `end_date` (date, NOT NULL)
- `reason` (text, nullable)
- `status` (text) — `pending`, `approved`, `rejected`, `cancelled`
- `approved_by` (uuid FK → profiles, nullable)
- `approved_at` (timestamptz, nullable)
- `created_at` / `updated_at`

### 3. attendance_corrections
Traceable corrections to attendance events. Events are NEVER deleted.
- `id` (uuid PK)
- `institution_id` (uuid FK → institutions)
- `event_id` (uuid FK → attendance_events) — the original event being corrected
- `staff_id` (uuid FK → hr_staff)
- `corrected_by` (uuid FK → profiles) — who made the correction
- `correction_type` (text) — `edit_time`, `add_missing`, `remove_invalid`, `change_type`
- `original_data` (jsonb) — snapshot of the original event
- `corrected_data` (jsonb) — the new values
- `reason` (text, NOT NULL) — why the correction was made
- `created_at` (timestamptz, default now())

## Security
- RLS on all 3 tables, same pattern: super_admin bypass OR (hr.* permission + same institution)
- attendance_corrections: only hr.update permission holders can create corrections
- No changes to existing tables or policies

## Notes
1. attendance_events remain append-only and are never deleted.
2. Corrections store a snapshot of the original data for full traceability.
3. Leave requests have a clear pending→approved/rejected workflow.
4. Schedules support per-day granularity with per-staff grace period override.
*/

-- ============================================================
-- 1. attendance_schedules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES public.hr_staff(id) ON DELETE CASCADE,
  day_of_week     integer NOT NULL,
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  grace_minutes   integer NOT NULL DEFAULT 15,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_schedules_dow_check CHECK (day_of_week >= 0 AND day_of_week <= 6),
  CONSTRAINT attendance_schedules_time_check CHECK (end_time > start_time),
  CONSTRAINT attendance_schedules_staff_dow_unique UNIQUE (staff_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_attendance_schedules_staff ON public.attendance_schedules (staff_id);
CREATE INDEX IF NOT EXISTS idx_attendance_schedules_institution ON public.attendance_schedules (institution_id);

DROP TRIGGER IF EXISTS trg_attendance_schedules_updated_at ON public.attendance_schedules;
CREATE TRIGGER trg_attendance_schedules_updated_at
  BEFORE UPDATE ON public.attendance_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.attendance_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_attendance_schedules" ON public.attendance_schedules;
CREATE POLICY "select_attendance_schedules"
  ON public.attendance_schedules FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_attendance_schedules" ON public.attendance_schedules;
CREATE POLICY "insert_attendance_schedules"
  ON public.attendance_schedules FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "update_attendance_schedules" ON public.attendance_schedules;
CREATE POLICY "update_attendance_schedules"
  ON public.attendance_schedules FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "delete_attendance_schedules" ON public.attendance_schedules;
CREATE POLICY "delete_attendance_schedules"
  ON public.attendance_schedules FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  );

-- ============================================================
-- 2. attendance_leave_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES public.hr_staff(id) ON DELETE CASCADE,
  leave_type      text NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'pending',
  approved_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_type_check CHECK (leave_type IN ('vacation', 'sick', 'personal', 'unpaid', 'other')),
  CONSTRAINT leave_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT leave_dates_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_staff ON public.attendance_leave_requests (staff_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_institution ON public.attendance_leave_requests (institution_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.attendance_leave_requests (status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON public.attendance_leave_requests (start_date, end_date);

DROP TRIGGER IF EXISTS trg_attendance_leave_requests_updated_at ON public.attendance_leave_requests;
CREATE TRIGGER trg_attendance_leave_requests_updated_at
  BEFORE UPDATE ON public.attendance_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.attendance_leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_leave_requests" ON public.attendance_leave_requests;
CREATE POLICY "select_leave_requests"
  ON public.attendance_leave_requests FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_leave_requests" ON public.attendance_leave_requests;
CREATE POLICY "insert_leave_requests"
  ON public.attendance_leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('hr.create') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "update_leave_requests" ON public.attendance_leave_requests;
CREATE POLICY "update_leave_requests"
  ON public.attendance_leave_requests FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "delete_leave_requests" ON public.attendance_leave_requests;
CREATE POLICY "delete_leave_requests"
  ON public.attendance_leave_requests FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.delete') AND institution_id = public.current_institution_id())
  );

-- ============================================================
-- 3. attendance_corrections
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_corrections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES public.attendance_events(id) ON DELETE CASCADE,
  staff_id        uuid NOT NULL REFERENCES public.hr_staff(id) ON DELETE CASCADE,
  corrected_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  correction_type text NOT NULL,
  original_data   jsonb NOT NULL,
  corrected_data  jsonb NOT NULL,
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correction_type_check CHECK (
    correction_type IN ('edit_time', 'add_missing', 'remove_invalid', 'change_type')
  )
);

CREATE INDEX IF NOT EXISTS idx_attendance_corrections_event ON public.attendance_corrections (event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_staff ON public.attendance_corrections (staff_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_institution ON public.attendance_corrections (institution_id);

ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_attendance_corrections" ON public.attendance_corrections;
CREATE POLICY "select_attendance_corrections"
  ON public.attendance_corrections FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_attendance_corrections" ON public.attendance_corrections;
CREATE POLICY "insert_attendance_corrections"
  ON public.attendance_corrections FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "update_attendance_corrections" ON public.attendance_corrections;
CREATE POLICY "update_attendance_corrections"
  ON public.attendance_corrections FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "delete_attendance_corrections" ON public.attendance_corrections;
CREATE POLICY "delete_attendance_corrections"
  ON public.attendance_corrections FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.delete') AND institution_id = public.current_institution_id())
  );
