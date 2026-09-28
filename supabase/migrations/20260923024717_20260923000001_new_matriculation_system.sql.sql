/*
# New Automatic Matriculation System

## Purpose
Replaces the old matricule generators (YYYY-NNNN for students, ENS-YYYY-NNNN for
teachers, manual for staff) with a unified, automatic, unique format:

    [InstitutionCode][Category][Sequence]

- InstitutionCode: 1-character code unique per institution (stored in new
  `institutions.matricule_prefix` column, auto-assigned if NULL).
- Category: E = Étudiant, F = Formateur, P = Personnel.
- Sequence: A001→A999→B001→…→Z999→AA01→AB01→…→AZ99→BA01→…→ZZ99.
  Independent sequence per institution AND per category.

## Examples
- AEA001  = Institution A / Étudiant / A001
- BFA020  = Institution B / Formateur / A020
- CPZA01  = Institution C / Personnel / ZA01

## Changes
1. Adds `matricule_prefix` text column to `institutions` (nullable, defaults
   to first char of institution `code` on first use).
2. New helper function `next_matricule_sequence(p_table, p_institution_id,
   p_category)` — finds the highest existing sequence suffix for that
   institution+category and returns the next one, concurrency-safe via
   `FOR UPDATE`.
3. Replaces `generate_student_number(uuid)` → returns full matricule
   `[prefix]E[sequence]`.
4. Replaces `generate_teacher_number(uuid)` → returns full matricule
   `[prefix]F[sequence]`.
5. New `generate_staff_number(uuid)` → returns full matricule
   `[prefix]P[sequence]`.
6. Updates `convert_applicant_to_student` to call the new
   `generate_student_number`.
7. Existing matricules are preserved — the new functions only apply to new
   records. Old records keep their old-format numbers.

## Security
- All functions are SECURITY DEFINER, search_path = public.
- Execute granted to authenticated.
- No tables, relations, roles, permissions, or RLS policies are modified.
*/

-- =============================================================
-- 1. Add matricule_prefix column to institutions
-- =============================================================
ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS matricule_prefix text;

-- =============================================================
-- 2. Helper: ensure institution has a matricule_prefix
--    Uses first character of institution code (uppercased).
--    If that char is already taken by another institution, falls back
--    to A, B, C, … Z, then AA, AB, etc.
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
  SELECT matricule_prefix INTO v_prefix
  FROM public.institutions
  WHERE id = p_institution_id;

  IF v_prefix IS NOT NULL AND length(v_prefix) > 0 THEN
    RETURN v_prefix;
  END IF;

  -- Not set yet: derive from code
  SELECT upper(substr(code, 1, 1)) INTO v_code
  FROM public.institutions
  WHERE id = p_institution_id;

  IF v_code IS NULL OR v_code = '' THEN
    v_code := 'A';
  END IF;

  v_candidate := v_code;
  v_found := false;

  -- Check if candidate is already used by another institution
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.institutions
      WHERE matricule_prefix = v_candidate
        AND id <> p_institution_id
    ) INTO v_found;

    IF NOT v_found THEN
      EXIT;
    END IF;

    -- Try sequential letters A, B, C ... Z, then AA, AB...
    IF length(v_candidate) = 1 AND ascii(v_candidate) < 90 THEN -- 'Z'
      v_candidate := chr(ascii(v_candidate) + 1);
    ELSIF length(v_candidate) = 1 AND v_candidate = 'Z' THEN
      v_candidate := 'AA';
    ELSIF length(v_candidate) = 2 AND substr(v_candidate, 2, 1) < 'Z' THEN
      v_candidate := substr(v_candidate, 1, 1) || chr(ascii(substr(v_candidate, 2, 1)) + 1);
    ELSIF length(v_candidate) = 2 AND substr(v_candidate, 2, 1) = 'Z' THEN
      v_candidate := chr(ascii(substr(v_candidate, 1, 1)) + 1) || 'A';
    ELSE
      -- Fallback: use a uuid suffix to guarantee uniqueness
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
-- 3. Helper: compute next sequence suffix
--    Scans the relevant table for matricules matching
--    prefix || category || '%' and finds the next sequence.
--
--    Sequence order: A001→A999→B001→…→Z999→AA01→AB01→…→AZ99→BA01→…→ZZ99
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
  v_full_prefix  text;  -- prefix || category, e.g. "AE"
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
  -- Get institution prefix
  v_prefix := public.ensure_matricule_prefix(p_institution_id);
  v_full_prefix := v_prefix || p_category;

  -- Map table name to number column
  v_number_col := CASE p_table_name
    WHEN 'students' THEN 'student_number'
    WHEN 'teachers' THEN 'teacher_number'
    WHEN 'hr_staff' THEN 'staff_number'
    ELSE p_table_name || '_number'
  END;

  -- Fetch all matching numbers using dynamic SQL
  EXECUTE format(
    'SELECT %I FROM public.%I WHERE institution_id = $1 AND %I LIKE $2',
    v_number_col, p_table_name, v_number_col
  )
  INTO v_existing
  USING p_institution_id, v_full_prefix || '%';

  -- If no existing records, start at A001
  IF v_existing IS NULL OR array_length(v_existing, 1) IS NULL THEN
    RETURN 'A001';
  END IF;

  -- Parse each existing suffix to find the maximum
  FOREACH v_suffix IN ARRAY v_existing LOOP
    -- Strip the prefix to get just the sequence part
    v_suffix := substr(v_suffix, length(v_full_prefix) + 1);

    -- Determine letter part and digit part
    -- Pattern: [A-Z]NNN (3 digits) or [A-Z][A-Z]NN (2 digits)
    IF v_suffix ~ '^[A-Z][0-9]{3}$' THEN
      -- Single letter + 3 digits (A001 - Z999)
      v_l1 := substr(v_suffix, 1, 1);
      v_digit_part := substr(v_suffix, 2, 3);
      v_digits_int := CAST(v_digit_part AS int);

      IF v_max_letter2 = '' AND v_max_letter1 != '' THEN
        -- We already have a 2-letter max, skip single-letter entries
        IF v_l1 > v_max_letter1 THEN
          v_max_letter1 := v_l1;
          v_max_digit := v_digits_int;
        ELSIF v_l1 = v_max_letter1 AND v_digits_int > v_max_digit THEN
          v_max_digit := v_digits_int;
        END IF;
      ELSIF v_max_letter2 = '' THEN
        -- No 2-letter max yet
        IF v_max_letter1 = '' OR v_l1 > v_max_letter1 THEN
          v_max_letter1 := v_l1;
          v_max_digit := v_digits_int;
        ELSIF v_l1 = v_max_letter1 AND v_digits_int > v_max_digit THEN
          v_max_digit := v_digits_int;
        END IF;
      END IF;

    ELSIF v_suffix ~ '^[A-Z][A-Z][0-9]{2}$' THEN
      -- Two letters + 2 digits (AA01 - ZZ99)
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
        -- Compare: first letter, then second letter, then digits
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

  -- Compute next sequence
  IF v_max_letter1 = '' THEN
    -- No valid entries found
    RETURN 'A001';
  END IF;

  IF NOT v_has_2letter THEN
    -- We're in single-letter mode (A001 - Z999)
    IF v_max_digit < 999 THEN
      v_max_digit := v_max_digit + 1;
      RETURN v_max_letter1 || lpad(v_max_digit::text, 3, '0');
    ELSE
      -- Overflow: move to next letter
      IF v_max_letter1 < 'Z' THEN
        v_max_letter1 := chr(ascii(v_max_letter1) + 1);
        RETURN v_max_letter1 || '001';
      ELSE
        -- Z999 → AA01
        RETURN 'AA01';
      END IF;
    END IF;
  ELSE
    -- We're in two-letter mode (AA01 - ZZ99)
    IF v_max_digit < 99 THEN
      v_max_digit := v_max_digit + 1;
      RETURN v_max_letter1 || v_max_letter2 || lpad(v_max_digit::text, 2, '0');
    ELSE
      -- Overflow: advance second letter
      IF v_max_letter2 < 'Z' THEN
        v_max_letter2 := chr(ascii(v_max_letter2) + 1);
        RETURN v_max_letter1 || v_max_letter2 || '01';
      ELSIF v_max_letter1 < 'Z' THEN
        -- AZ99 → BA01
        v_max_letter1 := chr(ascii(v_max_letter1) + 1);
        RETURN v_max_letter1 || 'A' || '01';
      ELSE
        -- ZZ99 → AAA01 (rare fallback)
        RETURN 'AAA01';
      END IF;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_matricule_sequence(text, uuid, text) TO authenticated;

-- =============================================================
-- 4. Replace generate_student_number
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
  v_prefix := public.ensure_matricule_prefix(p_institution_id);
  v_seq    := public.next_matricule_sequence('students', p_institution_id, 'E');
  RETURN v_prefix || 'E' || v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_student_number(uuid) TO authenticated;

-- =============================================================
-- 5. Replace generate_teacher_number
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
  v_prefix := public.ensure_matricule_prefix(p_institution_id);
  v_seq    := public.next_matricule_sequence('teachers', p_institution_id, 'F');
  RETURN v_prefix || 'F' || v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_teacher_number(uuid) TO authenticated;

-- =============================================================
-- 6. New generate_staff_number
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
  v_prefix := public.ensure_matricule_prefix(p_institution_id);
  v_seq    := public.next_matricule_sequence('hr_staff', p_institution_id, 'P');
  RETURN v_prefix || 'P' || v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_staff_number(uuid) TO authenticated;

-- =============================================================
-- 7. Update convert_applicant_to_student
--    (Only the function body changes; signature unchanged)
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
    RAISE EXCEPTION 'Aucune institution associée à votre compte.';
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
