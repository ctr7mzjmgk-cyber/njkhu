/*
# Link positions to departments

## Summary
Adds an optional `department_id` column to `hr_positions` so that a position
(poste/fonction) can be attached to a specific structure (Direction, Service,
etc.). This enables the organigramme to show positions within each structure
— both occupied positions (with the person's name) and vacant positions
("Poste vacant").

## Why this change is indispensable
Currently `hr_positions` is institution-level only. There is no way to know
which department a position belongs to unless someone is already assigned to
it via `hr_assignments`. Without this link, the org chart cannot display
vacant positions within a structure. Adding `department_id` is the minimal
schema change required to support the requested display.

## Changes
1. `hr_positions`: add `department_id` (uuid, nullable, FK → hr_departments
   ON DELETE SET NULL). Nullable so existing positions remain valid.

## Security
- No RLS policy changes. The existing institution-scoped policies on
  `hr_positions` already protect the data. The new column inherits the same
  row-level protection.
- No new permissions, no RBAC changes.

## Notes
1. Positions without a `department_id` remain institution-level and will not
   appear under any specific structure in the org chart.
2. ON DELETE SET NULL ensures deleting a department doesn't cascade-delete
   its positions — they simply become unlinked.
3. This does NOT modify any existing column, drop data, or change RLS.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hr_positions' AND column_name = 'department_id') THEN
    ALTER TABLE public.hr_positions ADD COLUMN department_id uuid;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'hr_positions_department_id_fkey' AND conrelid = 'public.hr_positions'::regclass) THEN
    ALTER TABLE public.hr_positions
      ADD CONSTRAINT hr_positions_department_id_fkey
      FOREIGN KEY (department_id) REFERENCES public.hr_departments(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_hr_positions_department ON public.hr_positions (department_id);
