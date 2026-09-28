-- Fix create_audit_log() to handle tables without an 'id' column
-- (e.g. user_roles has a composite PK: user_id + role_id + institution_id)
-- The original function used NEW.id / OLD.id which crashes on such tables
-- because the exception handler for undefined_column tries OLD.id which
-- also fails when OLD is NULL (INSERT case), and the error propagates uncaught.

CREATE OR REPLACE FUNCTION public.create_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_institution_id uuid;
  v_record_id uuid;
  v_row jsonb;
BEGIN
  -- Safely extract institution_id using JSON (no crash if column absent)
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_row := to_jsonb(NEW);
  ELSE
    v_row := to_jsonb(OLD);
  END IF;

  v_institution_id := NULLIF(v_row ->> 'institution_id', '')::uuid;

  -- Safely extract 'id' if the table has one; NULL otherwise
  v_record_id := NULLIF(v_row ->> 'id', '')::uuid;

  INSERT INTO public.audit_logs (
    institution_id, user_id, action, table_name, record_id, old_data, new_data
  ) VALUES (
    v_institution_id,
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.create_audit_log() TO authenticated;