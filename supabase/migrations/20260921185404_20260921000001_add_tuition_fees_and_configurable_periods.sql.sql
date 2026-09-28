-- Add monthly_fee to courses for mensualité
ALTER TABLE courses ADD COLUMN IF NOT EXISTS monthly_fee numeric NOT NULL DEFAULT 0;

-- Add term_type to terms for configurable periods (semester, trimester, custom)
ALTER TABLE terms ADD COLUMN IF NOT EXISTS term_type text NOT NULL DEFAULT 'semester';

-- Relax modules.semester CHECK to allow 1-10 (supports trimesters, custom periods)
ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_semester_check;
ALTER TABLE modules ADD CONSTRAINT modules_semester_check CHECK (semester >= 1 AND semester <= 10);

-- Add term_id FK to modules so modules can be linked to a specific term/period
ALTER TABLE modules ADD COLUMN IF NOT EXISTS term_id uuid;
ALTER TABLE modules
  ADD CONSTRAINT modules_term_id_fkey
  FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE SET NULL;

-- Backfill term_id for existing modules where possible (match by program's courses' academic_year)
-- This is best-effort: existing modules keep their semester value, term_id is optional
