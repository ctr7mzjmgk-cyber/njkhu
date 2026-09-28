/*
# Bootstrap Super Admin Account

Creates the first super_admin account linked to the existing institution.
This solves the chicken-and-egg problem: no admin = no way to create users.

Account credentials:
- Email: admin@centre-test.edu
- Password: Admin123456!

Idempotent — re-running is safe.
*/

DO $$
DECLARE
  v_institution_id uuid;
  v_super_admin_role_id uuid;
  v_user_id uuid;
  v_email text := 'admin@centre-test.edu';
BEGIN
  SELECT id INTO v_institution_id FROM public.institutions WHERE code = 'TEST' LIMIT 1;
  IF v_institution_id IS NULL THEN
    RAISE EXCEPTION 'Institution TEST introuvable.';
  END IF;

  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE code = 'super_admin' LIMIT 1;
  IF v_super_admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Rôle super_admin introuvable.';
  END IF;

  -- Check if user already exists
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email LIMIT 1;

  IF v_user_id IS NULL THEN
    -- Create auth user
    INSERT INTO auth.users (
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_user_meta_data,
      raw_app_meta_data
    ) VALUES (
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      v_email,
      crypt('Admin123456!', gen_salt('bf')),
      now(),
      now(),
      now(),
      jsonb_build_object('first_name', 'Super', 'last_name', 'Admin'),
      jsonb_build_object()
    )
    RETURNING id INTO v_user_id;

    -- Insert into auth.identities with required provider_id column
    INSERT INTO auth.identities (
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      v_user_id::text,
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email),
      'email',
      now(),
      now(),
      now()
    );
  END IF;

  -- Upsert profile with institution_id
  INSERT INTO public.profiles (id, institution_id, first_name, last_name, is_active)
  VALUES (v_user_id, v_institution_id, 'Super', 'Admin', true)
  ON CONFLICT (id) DO UPDATE
    SET institution_id = v_institution_id,
        first_name = COALESCE(NULLIF(profiles.first_name, ''), 'Super'),
        last_name = COALESCE(NULLIF(profiles.last_name, ''), 'Admin'),
        is_active = true;

  -- Assign super_admin role
  INSERT INTO public.user_roles (user_id, role_id, institution_id)
  VALUES (v_user_id, v_super_admin_role_id, v_institution_id)
  ON CONFLICT (user_id, role_id, institution_id) DO NOTHING;

  RAISE NOTICE 'Super admin ready: % (ID: %)', v_email, v_user_id;
END $$;
