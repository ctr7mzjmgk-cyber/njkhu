/*
# HR Attendance Tracking System — Core Schema

## Summary
Creates the foundational tables for a unified, extensible staff attendance
(time-and-attendance / pointage) system. The server is the single authority
for timestamps and validation. All clock-in/out events flow through one
common engine regardless of the capture method (employee QR, terminal QR,
fingerprint, or manual entry).

## New Tables
### 1. attendance_terminals — devices used for clock-in/out
### 2. institution_attendance_config — per-institution enabled methods
### 3. attendance_events — the core event log (append-only)

## Security
- RLS enabled on all three new tables.
- Policies follow existing HR pattern: super_admin bypass OR (hr.* permission + same institution).
- New permission `attendance.manage` for terminal/config management.
- No changes to existing tables, RBAC, or RLS.
*/

-- ============================================================
-- 1. New permission (additive, idempotent)
-- ============================================================
INSERT INTO public.permissions (code, name, module) VALUES
  ('attendance.manage', 'Gérer les terminaux et configuration de pointage', 'hr')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'rh' AND p.code = 'attendance.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- 2. attendance_terminals table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_terminals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  terminal_type   text NOT NULL DEFAULT 'virtual',
  location        text,
  api_key_hash    text,
  is_active       boolean NOT NULL DEFAULT true,
  last_seen_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_terminals_code_not_empty CHECK (length(btrim(code)) > 0),
  CONSTRAINT attendance_terminals_name_not_empty CHECK (length(btrim(name)) > 0),
  CONSTRAINT attendance_terminals_type_check CHECK (
    terminal_type IN ('physical_qr', 'fingerprint', 'virtual', 'mobile')
  ),
  CONSTRAINT attendance_terminals_code_unique UNIQUE (institution_id, code)
);

CREATE INDEX IF NOT EXISTS idx_attendance_terminals_institution
  ON public.attendance_terminals (institution_id);
CREATE INDEX IF NOT EXISTS idx_attendance_terminals_active
  ON public.attendance_terminals (is_active);

DROP TRIGGER IF EXISTS trg_attendance_terminals_updated_at ON public.attendance_terminals;
CREATE TRIGGER trg_attendance_terminals_updated_at
  BEFORE UPDATE ON public.attendance_terminals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.attendance_terminals ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. institution_attendance_config table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.institution_attendance_config (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id          uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  enabled_methods         text[] NOT NULL DEFAULT '{}',
  require_geolocation     boolean NOT NULL DEFAULT false,
  grace_period_minutes    integer NOT NULL DEFAULT 15,
  auto_clock_out_hours    integer,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_attendance_config_inst_unique UNIQUE (institution_id),
  CONSTRAINT attendance_config_methods_check CHECK (
    enabled_methods <@ ARRAY['employee_qr','terminal_qr','fingerprint','manual']::text[]
  )
);

DROP TRIGGER IF EXISTS trg_institution_attendance_config_updated_at ON public.institution_attendance_config;
CREATE TRIGGER trg_institution_attendance_config_updated_at
  BEFORE UPDATE ON public.institution_attendance_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.institution_attendance_config ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. attendance_events table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  staff_id          uuid NOT NULL REFERENCES public.hr_staff(id) ON DELETE CASCADE,
  terminal_id       uuid REFERENCES public.attendance_terminals(id) ON DELETE SET NULL,
  event_type        text NOT NULL,
  method            text NOT NULL,
  server_timestamp  timestamptz NOT NULL DEFAULT now(),
  client_timestamp  timestamptz,
  latitude          numeric(10,7),
  longitude         numeric(10,7),
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_events_type_check CHECK (event_type IN ('clock_in', 'clock_out')),
  CONSTRAINT attendance_events_method_check CHECK (
    method IN ('employee_qr', 'terminal_qr', 'fingerprint', 'manual')
  )
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_staff
  ON public.attendance_events (staff_id, server_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_events_institution_date
  ON public.attendance_events (institution_id, server_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_events_terminal
  ON public.attendance_events (terminal_id);

ALTER TABLE public.attendance_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. RLS Policies — attendance_terminals
-- ============================================================
DROP POLICY IF EXISTS "select_attendance_terminals" ON public.attendance_terminals;
CREATE POLICY "select_attendance_terminals"
  ON public.attendance_terminals FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_attendance_terminals" ON public.attendance_terminals;
CREATE POLICY "insert_attendance_terminals"
  ON public.attendance_terminals FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "update_attendance_terminals" ON public.attendance_terminals;
CREATE POLICY "update_attendance_terminals"
  ON public.attendance_terminals FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "delete_attendance_terminals" ON public.attendance_terminals;
CREATE POLICY "delete_attendance_terminals"
  ON public.attendance_terminals FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.delete') AND institution_id = public.current_institution_id())
  );

-- ============================================================
-- 6. RLS Policies — institution_attendance_config
-- ============================================================
DROP POLICY IF EXISTS "select_attendance_config" ON public.institution_attendance_config;
CREATE POLICY "select_attendance_config"
  ON public.institution_attendance_config FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_attendance_config" ON public.institution_attendance_config;
CREATE POLICY "insert_attendance_config"
  ON public.institution_attendance_config FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "update_attendance_config" ON public.institution_attendance_config;
CREATE POLICY "update_attendance_config"
  ON public.institution_attendance_config FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('attendance.manage') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "delete_attendance_config" ON public.institution_attendance_config;
CREATE POLICY "delete_attendance_config"
  ON public.institution_attendance_config FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR institution_id = public.current_institution_id()
  );

-- ============================================================
-- 7. RLS Policies — attendance_events
-- ============================================================
DROP POLICY IF EXISTS "select_attendance_events" ON public.attendance_events;
CREATE POLICY "select_attendance_events"
  ON public.attendance_events FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.view') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "insert_attendance_events" ON public.attendance_events;
CREATE POLICY "insert_attendance_events"
  ON public.attendance_events FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('hr.create') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "update_attendance_events" ON public.attendance_events;
CREATE POLICY "update_attendance_events"
  ON public.attendance_events FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('hr.update') AND institution_id = public.current_institution_id())
  );

DROP POLICY IF EXISTS "delete_attendance_events" ON public.attendance_events;
CREATE POLICY "delete_attendance_events"
  ON public.attendance_events FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('hr.delete') AND institution_id = public.current_institution_id())
  );
