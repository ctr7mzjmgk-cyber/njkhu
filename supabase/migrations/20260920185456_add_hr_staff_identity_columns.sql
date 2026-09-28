/*
# Add identity columns to hr_staff

## Summary
The hr_staff table was created with the design intent of reusing `profiles` for
person identity data. However, the HR UI and TypeScript types expect
`civility`, `first_name`, `last_name`, `photo_url`, and `manager_id` directly
on `hr_staff` — because staff records can exist BEFORE an auth account/profile
is created (the account is created/associated only by the Admin later).

Without these columns:
- The "Nouveau membre" form fails on insert (sends unknown columns → Postgres error).
- The Assignments page fails to load (selects first_name/last_name/photo_url).
- The Org-chart page fails to load (selects first_name/last_name + manager_id).

## Changes
Adds 5 nullable columns to `public.hr_staff`:
1. `civility` (text, nullable) — e.g. "M.", "Mme"
2. `first_name` (text, nullable) — staff member's first name
3. `last_name` (text, nullable) — staff member's last name
4. `photo_url` (text, nullable) — URL to staff photo in storage
5. `manager_id` (uuid, nullable, self-referencing FK → hr_staff) — hierarchical
   supervisor reference

## Security
- No RLS policy changes. Existing policies already scope by institution_id +
  has_permission('hr.*'), and these new columns inherit the same row-level
  protection.
- `manager_id` self-FK uses ON DELETE SET NULL so deleting a manager doesn't
  cascade-delete their subordinates.

## Notes
1. All columns are nullable so existing rows (if any) remain valid.
2. `manager_id` is a self-reference to `hr_staff(id)`.
3. This does NOT modify any existing column, drop data, or change RBAC.
4. The `profile_id` link remains — these columns simply allow staff to exist
   without a profile, per the explicit requirement that account creation is
   handled separately by the Admin.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hr_staff' AND column_name = 'civility') THEN
    ALTER TABLE public.hr_staff ADD COLUMN civility text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hr_staff' AND column_name = 'first_name') THEN
    ALTER TABLE public.hr_staff ADD COLUMN first_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hr_staff' AND column_name = 'last_name') THEN
    ALTER TABLE public.hr_staff ADD COLUMN last_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hr_staff' AND column_name = 'photo_url') THEN
    ALTER TABLE public.hr_staff ADD COLUMN photo_url text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hr_staff' AND column_name = 'manager_id') THEN
    ALTER TABLE public.hr_staff ADD COLUMN manager_id uuid;
  END IF;
END;
$$;

-- Add self-referencing FK for manager_id (idempotent check via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'hr_staff_manager_id_fkey' AND conrelid = 'public.hr_staff'::regclass) THEN
    ALTER TABLE public.hr_staff
      ADD CONSTRAINT hr_staff_manager_id_fkey
      FOREIGN KEY (manager_id) REFERENCES public.hr_staff(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- Index for manager lookups
CREATE INDEX IF NOT EXISTS idx_hr_staff_manager ON public.hr_staff (manager_id);
