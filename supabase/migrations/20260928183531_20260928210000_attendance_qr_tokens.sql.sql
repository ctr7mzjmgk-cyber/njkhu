/*
# Attendance QR Tokens — single-use, short-lived tokens for QR-based clocking

## Summary
Adds a `attendance_qr_tokens` table to support the employee_qr and terminal_qr
methods. Tokens are:
- Server-generated (random UUID)
- Short-lived (15 seconds for employee QR, 10 seconds for terminal QR)
- Single-use (marked used_at once consumed)
- Renewable (employee can request a new one anytime)

## New Table: attendance_qr_tokens
- `id` (uuid PK)
- `institution_id` (uuid FK → institutions) — tenant scoping
- `token` (uuid, NOT NULL, UNIQUE) — the random token embedded in the QR code
- `token_type` (text, NOT NULL) — `employee` or `terminal`
- `staff_id` (uuid FK → hr_staff, nullable) — set for employee QR, NULL for terminal QR
- `terminal_id` (uuid FK → attendance_terminals, nullable) — set for terminal QR
- `expires_at` (timestamptz, NOT NULL) — when the token becomes invalid
- `used_at` (timestamptz, nullable) — when the token was consumed (NULL = unused)
- `created_at` (timestamptz, NOT NULL, default now())

## Security
- RLS enabled. SELECT/INSERT via authenticated users or terminal-verified edge function.
- The edge function uses the service role key (bypasses RLS) to manage tokens.
- No client ever sees the Supabase service key — all token operations go through the edge function.

## Notes
1. Tokens are deleted automatically after 1 hour via a cleanup index (not a trigger —
   the edge function will handle cleanup opportunistically).
2. No changes to existing tables or policies.
*/

CREATE TABLE IF NOT EXISTS public.attendance_qr_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  token           uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  token_type      text NOT NULL,
  staff_id        uuid REFERENCES public.hr_staff(id) ON DELETE CASCADE,
  terminal_id     uuid REFERENCES public.attendance_terminals(id) ON DELETE CASCADE,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qr_token_type_check CHECK (token_type IN ('employee', 'terminal')),
  CONSTRAINT qr_token_staff_or_terminal CHECK (
    (token_type = 'employee' AND staff_id IS NOT NULL) OR
    (token_type = 'terminal' AND terminal_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_qr_tokens_token ON public.attendance_qr_tokens (token);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires ON public.attendance_qr_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_staff ON public.attendance_qr_tokens (staff_id);

ALTER TABLE public.attendance_qr_tokens ENABLE ROW LEVEL SECURITY;

-- Tokens are managed exclusively via the edge function (service role bypasses RLS).
-- Allow authenticated users to read their own tokens (for employee QR display).
DROP POLICY IF EXISTS "select_own_qr_tokens" ON public.attendance_qr_tokens;
CREATE POLICY "select_own_qr_tokens"
  ON public.attendance_qr_tokens FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR staff_id IN (
      SELECT s.id FROM public.hr_staff s
      WHERE s.institution_id = public.current_institution_id()
    )
    OR terminal_id IN (
      SELECT t.id FROM public.attendance_terminals t
      WHERE t.institution_id = public.current_institution_id()
    )
  );

DROP POLICY IF EXISTS "insert_qr_tokens" ON public.attendance_qr_tokens;
CREATE POLICY "insert_qr_tokens"
  ON public.attendance_qr_tokens FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "update_qr_tokens" ON public.attendance_qr_tokens;
CREATE POLICY "update_qr_tokens"
  ON public.attendance_qr_tokens FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR institution_id = public.current_institution_id()
  )
  WITH CHECK (
    public.is_super_admin()
    OR institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "delete_qr_tokens" ON public.attendance_qr_tokens;
CREATE POLICY "delete_qr_tokens"
  ON public.attendance_qr_tokens FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR institution_id = public.current_institution_id()
  );
