/*
# Fix Multi-Institution Isolation

## Root Causes Found
1. `profiles` SELECT policy: `has_permission('users.view')` has NO institution check,
   so any user with that permission sees ALL profiles across ALL institutions.
2. `profiles` INSERT/UPDATE/DELETE policies: no institution check at all.
3. `handle_new_user` trigger: creates a profile with NULL `institution_id` —
   new users have no institution until manually fixed.

## Fixes
1. `profiles` SELECT: scope by `institution_id = current_institution_id()` OR `id = auth.uid()`.
   super_admin bypass stays.
2. `profiles` INSERT: must match caller's institution (super_admin bypass).
3. `profiles` UPDATE: user can update own profile OR admin can update same-institution profiles.
4. `profiles` DELETE: admin can delete same-institution profiles only.
5. `handle_new_user` trigger: keep creating the profile row (needed for auth flow) but
   the institution_id will be set by the manage-user edge function when an admin creates the account.
   For self-signup, institution_id stays NULL and the profile page "associate institution" UI handles it.

## No changes to:
- students, teachers, hr_staff policies (they already use `institution_id = current_institution_id()`)
- matricule generation functions (already institution-scoped)
- RBAC/permission system
- Any existing data
*/

-- ============================================================
-- 1. Fix profiles RLS policies
-- ============================================================

-- SELECT: user sees own profile OR same-institution profiles (with users.view perm) OR super_admin
DROP POLICY IF EXISTS "select_own_profile" ON public.profiles;
CREATE POLICY "select_profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.is_super_admin()
    OR (public.has_permission('users.view') AND institution_id = public.current_institution_id())
  );

-- INSERT: only super_admin or users.create with same institution
DROP POLICY IF EXISTS "insert_profiles" ON public.profiles;
CREATE POLICY "insert_profiles"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (public.has_permission('users.create') AND institution_id = public.current_institution_id())
  );

-- UPDATE: user can update own profile OR admin can update same-institution profiles
DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
CREATE POLICY "update_profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR public.is_super_admin()
    OR (public.has_permission('users.update') AND institution_id = public.current_institution_id())
  )
  WITH CHECK (
    id = auth.uid()
    OR public.is_super_admin()
    OR (public.has_permission('users.update') AND institution_id = public.current_institution_id())
  );

-- DELETE: admin can delete same-institution profiles only
DROP POLICY IF EXISTS "delete_profiles" ON public.profiles;
CREATE POLICY "delete_profiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('users.delete') AND institution_id = public.current_institution_id())
  );

-- ============================================================
-- 2. Fix handle_new_user trigger — set institution_id to NULL
--    (will be set by manage-user edge function for admin-created accounts)
--    The trigger is needed so the profile row exists for RLS to work.
--    We keep it but ensure it doesn't override an existing institution_id.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'first_name', NEW.raw_user_meta_data->>'last_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- ============================================================
-- 3. Add a SECURITY DEFINER function to safely set a user's institution
--    This allows the manage-user edge function (which uses service role)
--    to set institution_id, AND allows an admin to fix a user's institution
--    without needing service_role.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_user_institution(p_user_id uuid, p_institution_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only allow if caller is super_admin or has users.update on same institution
  IF NOT public.is_super_admin()
     AND NOT (public.has_permission('users.update') AND p_institution_id = public.current_institution_id())
  THEN
    RAISE EXCEPTION 'Permission insuffisante pour définir l''institution d''un utilisateur';
  END IF;

  UPDATE public.profiles
  SET institution_id = p_institution_id
  WHERE id = p_user_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_user_institution(uuid, uuid) TO authenticated;
