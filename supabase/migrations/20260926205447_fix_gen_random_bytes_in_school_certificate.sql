/*
# Fix: function gen_random_bytes(integer) does not exist

## Problem
The `get_school_certificate` and `persist_school_certificate` functions
use `encode(gen_random_bytes(8), 'hex')` to generate a QR token.
The function `gen_random_bytes` is provided by the `pgcrypto` extension,
but even with pgcrypto installed, some Supabase versions don't expose
`gen_random_bytes` in the default search path for SECURITY DEFINER
functions with `SET search_path = public`.

## Fix
Replace `encode(gen_random_bytes(8), 'hex')` with
`encode(gen_random_uuid()::bytea, 'hex')`.
`gen_random_uuid()` is a built-in PostgreSQL core function (no extension
required, available since PG 13) and always accessible. Casting a UUID
to `bytea` gives 16 bytes, and `encode(..., 'hex')` produces a 32-char
hex string — more than enough entropy for a QR token.

Both functions are recreated identically except for that one line.
*/

-- ============================================================
-- 1. get_school_certificate — replace gen_random_bytes
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
  IF NOT (
    public.has_permission('certificates.create')
    OR public.has_permission('certificates.view')
  ) THEN
    RAISE EXCEPTION 'Accès refusé : permission certificates.view ou certificates.create requise';
  END IF;

  SELECT
    s.id, s.institution_id, s.student_number, s.civility,
    s.first_name, s.last_name, s.birth_date, s.birth_place,
    s.gender, s.nationality, s.status, s.admission_date, s.profile_id
  INTO v_student_row
  FROM public.students s
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Étudiant introuvable (student_id=%)', p_student_id;
  END IF;

  v_institution_id := v_student_row.institution_id;

  IF v_institution_id IS DISTINCT FROM public.current_institution_id() THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Accès refusé : étudiant d''une autre institution';
    END IF;
  END IF;

  SELECT e.id, e.status, e.enrollment_date, e.course_id, e.class_id
  INTO v_enrollment_row
  FROM public.enrollments e
  WHERE e.student_id = p_student_id
    AND e.academic_year_id = p_academic_year_id;

  IF NOT FOUND THEN
    v_enrollment_row := ROW(NULL, NULL, NULL, NULL, NULL)::record;
  END IF;

  IF v_enrollment_row.class_id IS NOT NULL THEN
    SELECT c.id, c.name, c.room
    INTO v_class_row
    FROM public.classes c
    WHERE c.id = v_enrollment_row.class_id;
  ELSE
    v_class_row := ROW(NULL, NULL, NULL)::record;
  END IF;

  IF v_enrollment_row.course_id IS NOT NULL THEN
    SELECT co.id, co.name, co.program_id, co.status
    INTO v_course_row
    FROM public.courses co
    WHERE co.id = v_enrollment_row.course_id;

    IF v_course_row.program_id IS NOT NULL THEN
      SELECT p.id, p.name, p.code, p.duration_years
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

  SELECT ay.id, ay.name, ay.start_date, ay.end_date, ay.is_active
  INTO v_academic_year
  FROM public.academic_years ay
  WHERE ay.id = p_academic_year_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Année académique introuvable (academic_year_id=%)', p_academic_year_id;
  END IF;

  SELECT
    i.id, i.name, i.short_name, i.address, i.city, i.phone, i.email,
    i.website, i.logo_url, i.republic_name, i.motto, i.ministry,
    i.flag_url, i.header_separator, i.director_name, i.director_function,
    i.signature_url, i.stamp_url
  INTO v_institution
  FROM public.institutions i
  WHERE i.id = v_institution_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Institution introuvable';
  END IF;

  v_cert_number := 'SCOL-' || EXTRACT(YEAR FROM now())::text || '-'
    || lpad(nextval('public.school_cert_seq')::text, 6, '0');
  v_qr_token := v_cert_number || '-' || encode(gen_random_uuid()::bytea, 'hex');

  v_result := jsonb_build_object(
    'certificate_number',  v_cert_number,
    'qr_token',            v_qr_token,
    'issue_date',          CURRENT_DATE,
    'issue_place',         COALESCE(v_institution.city, ''),
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

GRANT EXECUTE ON FUNCTION public.get_school_certificate(uuid, uuid) TO authenticated;

-- ============================================================
-- 2. persist_school_certificate — unchanged but recreated for consistency
-- ============================================================
CREATE OR REPLACE FUNCTION public.persist_school_certificate(
  p_student_id         uuid,
  p_academic_year_id   uuid,
  p_certificate_number text,
  p_qr_token           text,
  p_issue_date         date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cert_id        uuid;
  v_course_id      uuid;
  v_institution_id uuid;
  v_created_by     uuid;
BEGIN
  IF NOT public.has_permission('certificates.create') THEN
    RAISE EXCEPTION 'Accès refusé : permission certificates.create requise';
  END IF;

  v_created_by := auth.uid();

  SELECT s.institution_id INTO v_institution_id
  FROM public.students s
  WHERE s.id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Étudiant introuvable';
  END IF;

  IF v_institution_id IS DISTINCT FROM public.current_institution_id() THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Accès refusé : étudiant d''une autre institution';
    END IF;
  END IF;

  SELECT e.course_id INTO v_course_id
  FROM public.enrollments e
  WHERE e.student_id = p_student_id
    AND e.academic_year_id = p_academic_year_id;

  INSERT INTO public.certificates (
    student_id,
    course_id,
    certificate_number,
    issue_date,
    status,
    qr_token,
    created_by,
    certificate_type
  ) VALUES (
    p_student_id,
    v_course_id,
    p_certificate_number,
    p_issue_date,
    'issued',
    p_qr_token,
    v_created_by,
    'school_certificate'
  )
  RETURNING id INTO v_cert_id;

  RETURN v_cert_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.persist_school_certificate(uuid, uuid, text, text, date) TO authenticated;
