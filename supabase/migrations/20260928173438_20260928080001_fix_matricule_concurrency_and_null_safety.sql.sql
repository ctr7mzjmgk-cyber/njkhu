/*
# Fix Matricule Generation: Concurrency Safety, NULL Institution Guard, Prefix Assignment

## Summary
Fixes the matricule (student/teacher/staff number) generation system to be:
1. **Concurrent-safe**: Uses `FOR UPDATE` lock on the institution row so two simultaneous creations cannot get the same sequence number.
2. **NULL-safe**: All functions raise a clear error if institution_id is NULL instead of silently failing.
3. **Correctly prefixed**: The existing institution's `matricule_prefix` is set if missing.

## Changes
### Functions rewritten (all SECURITY DEFINER, search_path = public):
- `ensure_matricule_prefix(p_institution_id uuid)` — locks the institution row with FOR UPDATE, raises exception if institution_id is NULL or institution not found, assigns a prefix derived from the institution code if not already set.
- `next_matricule_sequence(p_table_name text, p_institution_id uuid, p_category text)` — calls ensure_matricule_prefix (which locks the row), then scans existing numbers for the max sequence. Sequences for E/F/P are independent.
- `generate_student_number(p_institution_id uuid)` — raises exception if institution_id is NULL, returns prefix || 'E' || sequence.
- `generate_teacher_number(p_institution_id uuid)` — raises exception if institution_id is NULL, returns prefix || 'F' || sequence.
- `generate_staff_number(p_institution_id uuid)` — raises exception if institution_id is NULL, returns prefix || 'P' || sequence.
- `convert_applicant_to_student(p_applicant_id uuid)` — uses the same generate_student_number logic, already checks for NULL institution.

### Data fix:
- Sets `matricule_prefix` on the existing institution (code 'TEST' → prefix 'T') if still NULL.

### Constraint:
- Adds unique constraint on `hr_staff(institution_id, staff_number)` to match students and teachers.

## Security
- No RLS policy changes.
- All functions remain SECURITY DEFINER with search_path = public.
- GRANT EXECUTE maintained on all functions for authenticated role.

## Important Notes
1. The `FOR UPDATE` lock on the institution row serializes matricule generation per institution, preventing race conditions.
2. E/F/P sequences are independent — they track separate max values in their respective tables.
3. Existing matricules and data are fully preserved.
4. The migration is idempotent — re-running it is safe.
*/

-- =============================================================
-- 1. Set matricule_prefix on existing institution if NULL
-- =============================================================
UPDATE public.institutions
SET matricule_prefix = upper(substr(code, 1, 1))
WHERE matricule_prefix IS NULL
  AND code IS NOT NULL
  AND length(btrim(code)) > 0;

-- For any institution that still has NULL prefix (edge case: code is empty), set 'A'
UPDATE public.institutions
SET matricule_prefix = 'A'
WHERE matricule_prefix IS NULL;

-- =============================================================
-- 2. Rewrite ensure_matricule_prefix — concurrent-safe with FOR UPDATE
-- =============================================================
CREATE OR REPLACE FUNCTION public.ensure_matricule_prefix(p_institution_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix     text;
  v_code       text;
  v_candidate  text;
  v_found      boolean;
BEGIN
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'Aucune institution associée à votre compte. Impossible de générer un matricule.';
  END IF;

  -- Lock the institution row FOR UPDATE so concurrent calls serialize
  SELECT matricule_prefix INTO v_prefix
  FROM public.institutions
  WHERE id = p_institution_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Institution introuvable (ID: %). Impossible de générer un matricule.', p_institution_id;
  END IF;

  IF v_prefix IS NOT NULL AND length(v_prefix) > 0 THEN
    RETURN v_prefix;
  END IF;

  -- Derive prefix from institution code
  SELECT upper(substr(code, 1, 1)) INTO v_code
  FROM public.institutions
  WHERE id = p_institution_id;

  IF v_code IS NULL OR v_code = '' THEN
    v_code := 'A';
  END IF;

  v_candidate := v_code;
  v_found := false;

  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.institutions
      WHERE matricule_prefix = v_candidate
        AND id <> p_institution_id
    ) INTO v_found;

    IF NOT v_found THEN
      EXIT;
    END IF;

    IF length(v_candidate) = 1 AND ascii(v_candidate) < 90 THEN
      v_candidate := chr(ascii(v_candidate) + 1);
    ELSIF length(v_candidate) = 1 AND v_candidate = 'Z' THEN
      v_candidate := 'AA';
    ELSIF length(v_candidate) = 2 AND substr(v_candidate, 2, 1) < 'Z' THEN
      v_candidate := substr(v_candidate, 1, 1) || chr(ascii(substr(v_candidate, 2, 1)) + 1);
    ELSIF length(v_candidate) = 2 AND substr(v_candidate, 2, 1) = 'Z' THEN
      v_candidate := chr(ascii(substr(v_candidate, 1, 1)) + 1) || 'A';
    ELSE
      v_candidate := substr(md5(random()::text || clock_timestamp()::text), 1, 2);
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.institutions
  SET matricule_prefix = v_candidate
  WHERE id = p_institution_id;

  RETURN v_candidate;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_matricule_prefix(uuid) TO authenticated;

-- =============================================================
-- 3. Rewrite next_matricule_sequence — relies on ensure_matricule_prefix for the lock
-- =============================================================
CREATE OR REPLACE FUNCTION public.next_matricule_sequence(
  p_table_name     text,
  p_institution_id uuid,
  p_category       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix       text;
  v_full_prefix  text;
  v_number_col   text;
  v_existing     text[];
  v_max_letter1  text := '';
  v_max_letter2  text := '';
  v_max_digit    int  := 0;
  v_has_2letter  boolean := false;
  v_rec          record;
  v_suffix       text;
  v_letter_part  text;
  v_digit_part   text;
  v_digits_int   int;
  v_l1           text;
  v_l2           text;
BEGIN
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'Aucune institution associée à votre compte. Impossible de générer un matricule.';
  END IF;

  -- This call acquires FOR UPDATE lock on the institution row
  v_prefix := public.ensure_matricule_prefix(p_institution_id);
  v_full_prefix := v_prefix || p_category;

  v_number_col := CASE p_table_name
    WHEN 'students' THEN 'student_number'
    WHEN 'teachers' THEN 'teacher_number'
    WHEN 'hr_staff' THEN 'staff_number'
    ELSE p_table_name || '_number'
  END;

  EXECUTE format(
    'SELECT %I FROM public.%I WHERE institution_id = $1 AND %I LIKE $2',
    v_number_col, p_table_name, v_number_col
  )
  INTO v_existing
  USING p_institution_id, v_full_prefix || '%';

  IF v_existing IS NULL OR array_length(v_existing, 1) IS NULL THEN
    RETURN 'A001';
  END IF;

  FOREACH v_suffix IN ARRAY v_existing LOOP
    v_suffix := substr(v_suffix, length(v_full_prefix) + 1);

    IF v_suffix ~ '^[A-Z][0-9]{3}$' THEN
      v_l1 := substr(v_suffix, 1, 1);
      v_digit_part := substr(v_suffix, 2, 3);
      v_digits_int := CAST(v_digit_part AS int);

      IF v_max_letter2 = '' AND v_max_letter1 != '' THEN
        IF v_l1 > v_max_letter1 THEN
          v_max_letter1 := v_l1;
          v_max_digit := v_digits_int;
        ELSIF v_l1 = v_max_letter1 AND v_digits_int > v_max_digit THEN
          v_max_digit := v_digits_int;
        END IF;
      ELSIF v_max_letter2 = '' THEN
        IF v_max_letter1 = '' OR v_l1 > v_max_letter1 THEN
          v_max_letter1 := v_l1;
          v_max_digit := v_digits_int;
        ELSIF v_l1 = v_max_letter1 AND v_digits_int > v_max_digit THEN
          v_max_digit := v_digits_int;
        END IF;
      END IF;

    ELSIF v_suffix ~ '^[A-Z][A-Z][0-9]{2}$' THEN
      v_l1 := substr(v_suffix, 1, 1);
      v_l2 := substr(v_suffix, 2, 1);
      v_digit_part := substr(v_suffix, 3, 2);
      v_digits_int := CAST(v_digit_part AS int);

      IF NOT v_has_2letter THEN
        v_has_2letter := true;
        v_max_letter1 := v_l1;
        v_max_letter2 := v_l2;
        v_max_digit := v_digits_int;
      ELSE
        IF v_l1 > v_max_letter1
           OR (v_l1 = v_max_letter1 AND v_l2 > v_max_letter2)
           OR (v_l1 = v_max_letter1 AND v_l2 = v_max_letter2 AND v_digits_int > v_max_digit)
        THEN
          v_max_letter1 := v_l1;
          v_max_letter2 := v_l2;
          v_max_digit := v_digits_int;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF v_max_letter1 = '' THEN
    RETURN 'A001';
  END IF;

  IF NOT v_has_2letter THEN
    IF v_max_digit < 999 THEN
      v_max_digit := v_max_digit + 1;
      RETURN v_max_letter1 || lpad(v_max_digit::text, 3, '0');
    ELSE
      IF v_max_letter1 < 'Z' THEN
        v_max_letter1 := chr(ascii(v_max_letter1) + 1);
        RETURN v_max_letter1 || '001';
      ELSE
        RETURN 'AA01';
      END IF;
    END IF;
  ELSE
    IF v_max_digit < 99 THEN
      v_max_digit := v_max_digit + 1;
      RETURN v_max_letter1 || v_max_letter2 || lpad(v_max_digit::text, 2, '0');
    ELSE
      IF v_max_letter2 < 'Z' THEN
        v_max_letter2 := chr(ascii(v_max_letter2) + 1);
        RETURN v_max_letter1 || v_max_letter2 || '01';
      ELSIF v_max_letter1 < 'Z' THEN
        v_max_letter1 := chr(ascii(v_max_letter1) + 1);
        RETURN v_max_letter1 || 'A' || '01';
      ELSE
        RETURN 'AAA01';
      END IF;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_matricule_sequence(text, uuid, text) TO authenticated;

-- =============================================================
-- 4. Rewrite generate_student_number — NULL guard
-- =============================================================
CREATE OR REPLACE FUNCTION public.generate_student_number(p_institution_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix  text;
  v_seq     text;
BEGIN
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'Aucune institution associée à votre compte. Impossible de générer un matricule.';
  END IF;

  v_prefix := public.ensure_matricule_prefix(p_institution_id);
  v_seq    := public.next_matricule_sequence('students', p_institution_id, 'E');
  RETURN v_prefix || 'E' || v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_student_number(uuid) TO authenticated;

-- =============================================================
-- 5. Rewrite generate_teacher_number — NULL guard
-- =============================================================
CREATE OR REPLACE FUNCTION public.generate_teacher_number(p_institution_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix  text;
  v_seq     text;
BEGIN
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'Aucune institution associée à votre compte. Impossible de générer un matricule.';
  END IF;

  v_prefix := public.ensure_matricule_prefix(p_institution_id);
  v_seq    := public.next_matricule_sequence('teachers', p_institution_id, 'F');
  RETURN v_prefix || 'F' || v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_teacher_number(uuid) TO authenticated;

-- =============================================================
-- 6. Rewrite generate_staff_number — NULL guard
-- =============================================================
CREATE OR REPLACE FUNCTION public.generate_staff_number(p_institution_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix  text;
  v_seq     text;
BEGIN
  IF p_institution_id IS NULL THEN
    RAISE EXCEPTION 'Aucune institution associée à votre compte. Impossible de générer un matricule.';
  END IF;

  v_prefix := public.ensure_matricule_prefix(p_institution_id);
  v_seq    := public.next_matricule_sequence('hr_staff', p_institution_id, 'P');
  RETURN v_prefix || 'P' || v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_staff_number(uuid) TO authenticated;

-- =============================================================
-- 7. Add unique constraint on hr_staff(institution_id, staff_number)
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hr_staff_unique_number'
      AND conrelid = 'public.hr_staff'::regclass
  ) THEN
    ALTER TABLE public.hr_staff
      ADD CONSTRAINT hr_staff_unique_number UNIQUE (institution_id, staff_number);
  END IF;
END $$;

-- =============================================================
-- 8. Rewrite convert_applicant_to_student — same logic, already checks NULL
-- =============================================================
CREATE OR REPLACE FUNCTION public.convert_applicant_to_student(p_applicant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_applicant     public.applicants%ROWTYPE;
  v_institution   uuid;
  v_student_id    uuid;
  v_student_num   text;
  v_existing_id   uuid;
BEGIN
  v_institution := public.current_institution_id();
  IF v_institution IS NULL THEN
    RAISE EXCEPTION 'Aucune institution associée à votre compte. Veuillez contacter l''administrateur pour associer votre compte à une institution.';
  END IF;

  IF NOT public.has_permission('students.create') THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission de créer un étudiant.';
  END IF;

  SELECT * INTO v_applicant
  FROM public.applicants
  WHERE id = p_applicant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidat introuvable.';
  END IF;

  IF v_applicant.institution_id != v_institution AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Ce candidat n''appartient pas à votre institution.';
  END IF;

  SELECT id INTO v_existing_id
  FROM public.students
  WHERE applicant_id = p_applicant_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ce candidat a déjà été converti en étudiant.';
  END IF;

  v_student_num := public.generate_student_number(v_institution);

  INSERT INTO public.students (
    institution_id,
    applicant_id,
    student_number,
    admission_date,
    status
  ) VALUES (
    v_applicant.institution_id,
    p_applicant_id,
    v_student_num,
    CURRENT_DATE,
    'active'
  )
  RETURNING id INTO v_student_id;

  UPDATE public.applicants
  SET status = 'admitted'
  WHERE id = p_applicant_id;

  RETURN v_student_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_applicant_to_student(uuid) TO authenticated;
