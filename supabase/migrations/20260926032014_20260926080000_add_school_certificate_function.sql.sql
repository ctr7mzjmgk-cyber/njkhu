/*
# School Certificate Generation Function

## Summary
Adds a SECURITY DEFINER PostgreSQL function `get_school_certificate(student_id, academic_year_id)`
that assembles all data needed to render a "certificat de scolarité" — an official
enrollment certificate for a student in a given academic year.

## How it works
1. Validates that the caller belongs to the same institution as the student
   (via `current_institution_id()` and `has_permission('certificates.create')`).
2. Fetches the student row with all identity fields.
3. Finds the enrollment for the given academic year (uses UNIQUE(student_id, academic_year_id)
   so only one enrollment per student per year — no risk of fetching an old formation).
4. Joins through enrollment → course → program, enrollment → class, enrollment → academic_year
   to assemble the scolarity block.
5. Fetches the institution's official document fields (republic, motto, ministry,
   director name/function, logo, stamp, signature, flag, etc.).
6. Generates a unique certificate number (format: SCOL-YYYY-NNNNNN) and a QR token.
   The number is unique because it uses a sequence + year.
7. Returns a single JSON record with the full certificate payload.

## Security
- SECURITY DEFINER, search_path = public.
- Checks `has_permission('certificates.create')` — only staff who can create certificates
  may call this function. This covers administration, scolarité, direction.
- Checks `current_institution_id()` matches the student's institution — no cross-institution
  leakage.
- Does NOT use service_role in the frontend; the frontend calls this via the normal
  Supabase client RPC which runs under RLS + auth context.

## No schema changes
- No new tables, no new columns. Reuses exclusively existing tables:
  students, profiles, enrollments, classes, courses, programs, academic_years, institutions.

## Notes
1. The function returns JSON (jsonb) so it can be consumed directly by the frontend
   as a stable, typed structure for the A4 template.
2. The certificate number is generated from a dedicated sequence `school_cert_seq`
   to guarantee uniqueness.
3. The function is read-only — it does NOT insert into `certificates`. That is a
   separate step (if the user chooses to persist the certificate, a separate RPC
   or insert will handle it). This function only assembles data for rendering.
*/

-- ============================================================
-- 1. Sequence for unique certificate numbers
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.school_cert_seq
  START 1
  INCREMENT 1
  NO CYCLE;

-- ============================================================
-- 2. Function: get_school_certificate
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_school_certificate(
  p_student_id       uuid,
  p_academic_year_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_institution_id   uuid;
  v_student_row      record;
  v_enrollment_row   record;
  v_class_row        record;
  v_course_row       record;
  v_program_row      record;
  v_academic_year    record;
  v_institution      record;
  v_cert_number      text;
  v_qr_token         text;
  v_result           jsonb;
BEGIN
  -- ----------------------------------------------------------
  -- Permission check: caller must have certificates.create
  -- ----------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.has_permission('certificates.create') AS hp
    WHERE hp = true
  ) THEN
    RAISE EXCEPTION 'Accès refusé : permission certificates.create requise';
  END IF;

  -- ----------------------------------------------------------
  -- Fetch student and verify institution match
  -- ----------------------------------------------------------
  SELECT
    s.id,
    s.institution_id,
    s.student_number,
    s.civility,
    s.first_name,
    s.last_name,
    s.birth_date,
    s.birth_place,
    s.gender,
    s.nationality,
    s.status,
    s.admission_date,
    s.profile_id
  INTO v_student_row
  FROM public.students s
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Étudiant introuvable';
  END IF;

  v_institution_id := v_student_row.institution_id;

  -- Verify caller belongs to the same institution
  IF v_institution_id::text IS DISTINCT FROM public.current_institution_id() THEN
    -- super_admin bypasses institution check
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Accès refusé : étudiant d''une autre institution';
    END IF;
  END IF;

  -- ----------------------------------------------------------
  -- Fetch enrollment for the specified academic year
  -- (UNIQUE(student_id, academic_year_id) ensures exactly one)
  -- ----------------------------------------------------------
  SELECT
    e.id,
    e.status,
    e.enrollment_date,
    e.course_id,
    e.class_id
  INTO v_enrollment_row
  FROM public.enrollments e
  WHERE e.student_id = p_student_id
    AND e.academic_year_id = p_academic_year_id;

  IF NOT FOUND THEN
    -- Return null enrollment block — caller can still get student/institution data
    v_enrollment_row := ROW(NULL, NULL, NULL, NULL, NULL)::record;
  END IF;

  -- ----------------------------------------------------------
  -- Fetch class info if enrollment exists
  -- ----------------------------------------------------------
  IF v_enrollment_row.class_id IS NOT NULL THEN
    SELECT
      c.id,
      c.name,
      c.room
    INTO v_class_row
    FROM public.classes c
    WHERE c.id = v_enrollment_row.class_id;
  ELSE
    v_class_row := ROW(NULL, NULL, NULL)::record;
  END IF;

  -- ----------------------------------------------------------
  -- Fetch course + program info
  -- ----------------------------------------------------------
  IF v_enrollment_row.course_id IS NOT NULL THEN
    SELECT
      co.id,
      co.name,
      co.program_id,
      co.status
    INTO v_course_row
    FROM public.courses co
    WHERE co.id = v_enrollment_row.course_id;

    IF v_course_row.program_id IS NOT NULL THEN
      SELECT
        p.id,
        p.name,
        p.code,
        p.duration_years
      INTO v_program_row
      FROM public.programs p
      WHERE p.id = v_course_row.program_id;
    ELSE
      v_program_row := ROW(NULL, NULL, NULL, NULL)::record;
    END IF;
  ELSE
    v_course_row := ROW(NULL, NULL, NULL, NULL)::record;
    v_program_row := ROW(NULL, NULL, NULL, NULL)::record;
  END IF;

  -- ----------------------------------------------------------
  -- Fetch academic year
  -- ----------------------------------------------------------
  SELECT
    ay.id,
    ay.name,
    ay.start_date,
    ay.end_date,
    ay.is_active
  INTO v_academic_year
  FROM public.academic_years ay
  WHERE ay.id = p_academic_year_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Année académique introuvable';
  END IF;

  -- ----------------------------------------------------------
  -- Fetch institution official document fields
  -- ----------------------------------------------------------
  SELECT
    i.id,
    i.name,
    i.short_name,
    i.address,
    i.city,
    i.phone,
    i.email,
    i.website,
    i.logo_url,
    i.republic_name,
    i.motto,
    i.ministry,
    i.flag_url,
    i.header_separator,
    i.director_name,
    i.director_function,
    i.signature_url,
    i.stamp_url
  INTO v_institution
  FROM public.institutions i
  WHERE i.id = v_institution_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Institution introuvable';
  END IF;

  -- ----------------------------------------------------------
  -- Generate unique certificate number and QR token
  -- Format: SCOL-{YEAR}-{6-digit sequence padded}
  -- ----------------------------------------------------------
  v_cert_number := 'SCOL-' || EXTRACT(YEAR FROM now())::text || '-'
    || lpad(nextval('public.school_cert_seq')::text, 6, '0');

  v_qr_token := v_cert_number || '-' || encode(gen_random_bytes(8), 'hex');

  -- ----------------------------------------------------------
  -- Build the result JSON
  -- ----------------------------------------------------------
  v_result := jsonb_build_object(
    'certificate_number',  v_cert_number,
    'qr_token',            v_qr_token,
    'issue_date',          CURRENT_DATE,
    'issue_place',         COALESCE(v_institution.city, ''),
    -- Student block
    'student', jsonb_build_object(
      'id',              v_student_row.id,
      'student_number',  v_student_row.student_number,
      'civility',        v_student_row.civility,
      'first_name',      v_student_row.first_name,
      'last_name',       v_student_row.last_name,
      'full_name',       btrim(COALESCE(v_student_row.last_name, '') || ' ' || COALESCE(v_student_row.first_name, '')),
      'birth_date',      v_student_row.birth_date,
      'birth_place',     v_student_row.birth_place,
      'gender',          v_student_row.gender,
      'nationality',     v_student_row.nationality,
      'status',          v_student_row.status,
      'admission_date',  v_student_row.admission_date
    ),
    -- Scolarity block
    'enrollment', jsonb_build_object(
      'id',               v_enrollment_row.id,
      'status',           v_enrollment_row.status,
      'enrollment_date',  v_enrollment_row.enrollment_date
    ),
    'academic_year', jsonb_build_object(
      'id',          v_academic_year.id,
      'name',        v_academic_year.name,
      'start_date',  v_academic_year.start_date,
      'end_date',    v_academic_year.end_date,
      'is_active',   v_academic_year.is_active
    ),
    'course', jsonb_build_object(
      'id',      v_course_row.id,
      'name',    v_course_row.name,
      'status',  v_course_row.status
    ),
    'program', jsonb_build_object(
      'id',             v_program_row.id,
      'name',           v_program_row.name,
      'code',           v_program_row.code,
      'duration_years', v_program_row.duration_years
    ),
    'class', jsonb_build_object(
      'id',    v_class_row.id,
      'name',  v_class_row.name,
      'room',  v_class_row.room
    ),
    -- Institution block (official document fields)
    'institution', jsonb_build_object(
      'id',                 v_institution.id,
      'name',               v_institution.name,
      'short_name',         v_institution.short_name,
      'address',            v_institution.address,
      'city',               v_institution.city,
      'phone',              v_institution.phone,
      'email',              v_institution.email,
      'website',            v_institution.website,
      'logo_url',           v_institution.logo_url,
      'republic_name',      v_institution.republic_name,
      'motto',              v_institution.motto,
      'ministry',           v_institution.ministry,
      'flag_url',           v_institution.flag_url,
      'header_separator',   v_institution.header_separator,
      'director_name',      v_institution.director_name,
      'director_function',  v_institution.director_function,
      'signature_url',      v_institution.signature_url,
      'stamp_url',          v_institution.stamp_url
    )
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 3. Grant EXECUTE to authenticated role
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_school_certificate(uuid, uuid) TO authenticated;
