/*
# Add term_id to assessments table

1. Modified Tables
- `assessments`
  - New column: `term_id` (uuid, nullable, FK to `terms(id)`)
  - Allows linking an evaluation to a specific period (Semester 1, Semester 2, etc.)
  - Nullable so existing evaluations without a period remain valid (treated as "Annuel")

2. Indexes
- Added index on `assessments(term_id)` for faster filtering by period

3. Security
- No RLS policy changes — existing policies on assessments remain unchanged.
- The new column inherits the table's existing RLS protection.

4. Important Notes
- This column is OPTIONAL. Existing assessments will have NULL term_id.
- In bulletin calculations, assessments with NULL term_id are treated as "Annuel" (annual).
- The assessment form now includes a period selector so new evaluations can be linked to a term.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'assessments'
      AND column_name = 'term_id'
  ) THEN
    ALTER TABLE public.assessments
      ADD COLUMN term_id uuid REFERENCES public.terms(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assessments_term_id ON public.assessments(term_id);
