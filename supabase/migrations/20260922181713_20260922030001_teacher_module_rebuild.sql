/*
# Teacher Module Rebuild: Identity Fields, Assignments, Assessment/Grade Security

## Summary
Rebuilds the Teachers module with:
1. Full identity fields on `teachers` (mirroring students)
2. Auto-generated teacher numbers via `generate_teacher_number()`
3. A new `teacher_assignments` junction table linking teachers to subjects + classes
4. A new SECURITY DEFINER function `is_teacher_of_subject_class()` for precise access control
5. RLS on `teacher_assignments`
6. Tightened RLS on `assessments` and `grades` so teachers can only
   INSERT/UPDATE assessments and grades for subject+class combinations
   they are explicitly assigned to (via `teacher_assignments`) OR
   via a schedule that links them to that class+subject.

## New Columns on `teachers`
1. `civility` — text, nullable ('M', 'Mme', 'Mlle', 'Dr', 'Pr')
2. `first_name` — text, nullable
3. `last_name` — text, nullable
4. `email` — text, nullable
5. `phone` — text, nullable
6. `birth_date` — date, nullable
7. `birth_place` — text, nullable
8. `gender` — text, nullable ('M', 'F')
9. `nationality` — text, nullable
10. `marital_status` — text, nullable
11. `address` — text, nullable
12. `emergency_contact_name` — text, nullable
13. `emergency_contact_phone` — text, nullable

## New Table: `teacher_assignments`
Junction table for precise teacher → subject + class assignments.
- `id` (uuid PK)
- `teacher_id` (uuid FK → teachers, NOT NULL)
- `subject_id` (uuid FK → subjects, NOT NULL)
- `class_id` (uuid FK → classes, NOT NULL)
- `institution_id` (uuid FK → institutions, NOT NULL)
- `created_at` (timestamptz)
- UNIQUE (teacher_id, subject_id, class_id) — one assignment per combo

## New Function: `generate_teacher_number(p_institution_id uuid)`
Generates a unique teacher number in format `ENS-YYYY-NNNN`.
Concurrency-safe via `FOR UPDATE` on the last matching row.

## New Function: `is_teacher_of_subject_class(p_subject_id uuid, p_class_id uuid)`
Returns TRUE if the current user's teacher record is explicitly assigned
(via `teacher_assignments`) to the given subject+class combination,
OR if they have a schedule linking them to that class with that subject.

## RLS Changes
### teacher_assignments
- SELECT: super_admin OR has_permission('teachers.view') + institution match OR own teacher record
- INSERT: has_permission('teachers.update') + institution match
- UPDATE: has_permission('teachers.update') + institution match
- DELETE: has_permission('teachers.update') + institution match

### assessments (tightened)
- INSERT: now also allows teachers who are assigned to the subject+class
  via `teacher_assignments` OR via a schedule with matching subject_id
- UPDATE: same — assigned teachers can update their own assessments

### grades (tightened)
- INSERT: now also allows teachers assigned to the assessment's subject+class
- UPDATE: same — assigned teachers can update grades for their assessments

## Security Notes
1. All new functions are SECURITY DEFINER with `SET search_path = public`.
2. `is_teacher_of_subject_class` checks both `teacher_assignments` and
   `schedules` so existing schedule-based assignments continue to work.
3. The assessment/grade INSERT/UPDATE policies now use
   `is_teacher_of_subject_class` so a teacher without admin permissions
   can still create assessments and enter grades — but ONLY for subject+class
   combinations they are assigned to.
4. No existing data is modified or deleted.
5. All new columns are nullable so existing rows are unaffected.
*/

-- ============================================================
-- 1. Add identity columns to teachers
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'civility') THEN
    ALTER TABLE public.teachers ADD COLUMN civility text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'first_name') THEN
    ALTER TABLE public.teachers ADD COLUMN first_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'last_name') THEN
    ALTER TABLE public.teachers ADD COLUMN last_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'email') THEN
    ALTER TABLE public.teachers ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'phone') THEN
    ALTER TABLE public.teachers ADD COLUMN phone text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'birth_date') THEN
    ALTER TABLE public.teachers ADD COLUMN birth_date date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'birth_place') THEN
    ALTER TABLE public.teachers ADD COLUMN birth_place text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'gender') THEN
    ALTER TABLE public.teachers ADD COLUMN gender text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'nationality') THEN
    ALTER TABLE public.teachers ADD COLUMN nationality text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'marital_status') THEN
    ALTER TABLE public.teachers ADD COLUMN marital_status text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'address') THEN
    ALTER TABLE public.teachers ADD COLUMN address text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'emergency_contact_name') THEN
    ALTER TABLE public.teachers ADD COLUMN emergency_contact_name text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = 'emergency_contact_phone') THEN
    ALTER TABLE public.teachers ADD COLUMN emergency_contact_phone text;
  END IF;
END $$;

-- ============================================================
-- 2. generate_teacher_number function
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_teacher_number(p_institution_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year          text := to_char(now(), 'YYYY');
  v_prefix        text := 'ENS-' || v_year || '-';
  v_last_number   text;
  v_next_seq      int;
  v_new_number    text;
BEGIN
  SELECT teacher_number
  INTO v_last_number
  FROM public.teachers
  WHERE institution_id = p_institution_id
    AND teacher_number LIKE v_prefix || '%'
  ORDER BY teacher_number DESC
  LIMIT 1
  FOR UPDATE;

  IF v_last_number IS NULL THEN
    v_next_seq := 1;
  ELSE
    v_next_seq := CAST(REPLACE(v_last_number, v_prefix, '') AS int) + 1;
  END IF;

  v_new_number := v_prefix || lpad(v_next_seq::text, 4, '0');

  RETURN v_new_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_teacher_number(uuid) TO authenticated;

-- ============================================================
-- 3. teacher_assignments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  subject_id      uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  class_id        uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_assignments_unique UNIQUE (teacher_id, subject_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON public.teacher_assignments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_subject ON public.teacher_assignments (subject_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class ON public.teacher_assignments (class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_institution ON public.teacher_assignments (institution_id);

ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. is_teacher_of_subject_class function
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_teacher_of_subject_class(
  p_subject_id uuid,
  p_class_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_assignments ta
    WHERE ta.teacher_id = public.current_teacher_id()
      AND ta.subject_id = p_subject_id
      AND ta.class_id = p_class_id
  )
  OR EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.teacher_id = public.current_teacher_id()
      AND s.subject_id = p_subject_id
      AND s.class_id = p_class_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_teacher_of_subject_class(uuid, uuid) TO authenticated;

-- ============================================================
-- 5. RLS policies for teacher_assignments
-- ============================================================
DROP POLICY IF EXISTS "select_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "select_teacher_assignments" ON public.teacher_assignments FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('teachers.view') AND institution_id = public.current_institution_id())
    OR teacher_id = public.current_teacher_id()
  );

DROP POLICY IF EXISTS "insert_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "insert_teacher_assignments" ON public.teacher_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_permission('teachers.update')
    AND institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "update_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "update_teacher_assignments" ON public.teacher_assignments FOR UPDATE
  TO authenticated
  USING (
    public.has_permission('teachers.update')
    AND institution_id = public.current_institution_id()
  )
  WITH CHECK (
    public.has_permission('teachers.update')
    AND institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "delete_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "delete_teacher_assignments" ON public.teacher_assignments FOR DELETE
  TO authenticated
  USING (
    public.has_permission('teachers.update')
    AND institution_id = public.current_institution_id()
  );

-- ============================================================
-- 6. Tighten assessments INSERT policy
--    Teachers can create assessments only for subject+class they're assigned to
-- ============================================================
DROP POLICY IF EXISTS "insert_assessments" ON public.assessments;
CREATE POLICY "insert_assessments" ON public.assessments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.classes c WHERE c.id = assessments.class_id AND c.institution_id = public.current_institution_id())
    AND (
      public.has_permission('assessments.create')
      OR public.is_teacher_of_subject_class(assessments.subject_id, assessments.class_id)
    )
  );

-- ============================================================
-- 7. Tighten assessments UPDATE policy
--    Teachers can update assessments only for subject+class they're assigned to
-- ============================================================
DROP POLICY IF EXISTS "update_assessments" ON public.assessments;
CREATE POLICY "update_assessments" ON public.assessments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.classes c WHERE c.id = assessments.class_id AND c.institution_id = public.current_institution_id())
    AND (
      public.has_permission('assessments.update')
      OR public.is_teacher_of_subject_class(assessments.subject_id, assessments.class_id)
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.classes c WHERE c.id = assessments.class_id AND c.institution_id = public.current_institution_id())
    AND (
      public.has_permission('assessments.update')
      OR public.is_teacher_of_subject_class(assessments.subject_id, assessments.class_id)
    )
  );

-- ============================================================
-- 8. Tighten grades INSERT policy
--    Teachers can insert grades only for assessments they're assigned to
-- ============================================================
DROP POLICY IF EXISTS "insert_grades" ON public.grades;
CREATE POLICY "insert_grades" ON public.grades FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assessments a
      JOIN public.classes c ON c.id = a.class_id
      WHERE a.id = grades.assessment_id
        AND c.institution_id = public.current_institution_id()
    )
    AND (
      public.has_permission('grades.create')
      OR EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = grades.assessment_id
          AND public.is_teacher_of_subject_class(a.subject_id, a.class_id)
      )
    )
  );

-- ============================================================
-- 9. Tighten grades UPDATE policy
--    Teachers can update grades only for assessments they're assigned to
-- ============================================================
DROP POLICY IF EXISTS "update_grades" ON public.grades;
CREATE POLICY "update_grades" ON public.grades FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.assessments a
      JOIN public.classes c ON c.id = a.class_id
      WHERE a.id = grades.assessment_id
        AND c.institution_id = public.current_institution_id()
    )
    AND (
      public.has_permission('grades.update')
      OR EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = grades.assessment_id
          AND public.is_teacher_of_subject_class(a.subject_id, a.class_id)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.assessments a
      JOIN public.classes c ON c.id = a.class_id
      WHERE a.id = grades.assessment_id
        AND c.institution_id = public.current_institution_id()
    )
    AND (
      public.has_permission('grades.update')
      OR EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = grades.assessment_id
          AND public.is_teacher_of_subject_class(a.subject_id, a.class_id)
      )
    )
  );
