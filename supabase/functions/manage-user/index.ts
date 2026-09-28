import { createClient } from "npm:@supabase/supabase-js@2.58.0";
// Edge function for user management (create, roles, toggle, link student/staff)
// Updated: 2026-09-23 - fix deployment

type Database = {
  public: {
    Tables: Record<string, {
      Row: Record<string, unknown>;
      Insert: Record<string, unknown>;
      Update: Record<string, unknown>;
    }>;
    Views: Record<string, never>;
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums: Record<string, never>;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const segments: string[] = [];
  for (let s = 0; s < 3; s++) {
    let seg = "";
    for (let i = 0; i < 4; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(seg);
  }
  return segments.join("-");
}

interface CreateUserData {
  email: string;
  password?: string;
  first_name: string;
  last_name: string;
  phone?: string;
  institution_id: string;
  role_code: string;
}

interface AssignRoleData {
  user_id: string;
  role_code: string;
  institution_id: string;
}

interface ToggleActiveData {
  user_id: string;
  is_active: boolean;
}

interface LinkStudentData {
  student_id: string;
  email: string;
  password?: string;
}

interface LinkStaffAccountData {
  staff_id: string;
  email: string;
  password?: string;
  role_code: string;
}

interface LinkExistingUserToStaffData {
  staff_id: string;
  user_id: string;
  role_code: string;
}

interface SetRolesData {
  user_id: string;
  role_codes: string[];
  institution_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient<Database>(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: hasPerm } = await userClient.rpc("has_permission", { p_code: "users.create" });
    if (!hasPerm) {
      return new Response(JSON.stringify({ error: "Forbidden: users.create required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const action = body.action;

    if (action === "create_user") {
      const data = body as CreateUserData;

      if (!data.email || !data.first_name || !data.last_name || !data.institution_id || !data.role_code) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const password = data.password && data.password.length >= 6 ? data.password : generateTempPassword();

      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email: data.email,
        password,
        email_confirm: true,
        user_metadata: {
          first_name: data.first_name,
          last_name: data.last_name,
        },
      });

      if (authError) throw authError;
      const newUserId = authData.user.id;

      const { error: profileError } = await adminClient
        .from("profiles")
        .upsert({
          id: newUserId,
          institution_id: data.institution_id,
          first_name: data.first_name,
          last_name: data.last_name,
          phone: data.phone || null,
          is_active: true,
        }, { onConflict: "id" });

      if (profileError) throw profileError;

      const { data: role } = await adminClient
        .from("roles")
        .select("id")
        .eq("code", data.role_code)
        .maybeSingle();

      if (!role) {
        return new Response(JSON.stringify({ error: "Role not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: roleError } = await adminClient
        .from("user_roles")
        .insert({
          user_id: newUserId,
          role_id: role.id,
          institution_id: data.institution_id,
        });

      if (roleError) throw roleError;

      return new Response(JSON.stringify({ user_id: newUserId, success: true, temporary_password: password }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "assign_role") {
      const data = body as AssignRoleData;
      const { data: canUpdate } = await userClient.rpc("has_permission", { p_code: "users.update" });
      if (!canUpdate) {
        return new Response(JSON.stringify({ error: "Forbidden: users.update required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: role } = await adminClient
        .from("roles")
        .select("id")
        .eq("code", data.role_code)
        .maybeSingle();

      if (!role) {
        return new Response(JSON.stringify({ error: "Role not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: deleteErr } = await adminClient
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("institution_id", data.institution_id);

      if (deleteErr) throw deleteErr;

      const { error: insertErr } = await adminClient
        .from("user_roles")
        .insert({
          user_id: data.user_id,
          role_id: role.id,
          institution_id: data.institution_id,
        });

      if (insertErr) throw insertErr;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "toggle_active") {
      const data = body as ToggleActiveData;
      const { data: canUpdate } = await userClient.rpc("has_permission", { p_code: "users.update" });
      if (!canUpdate) {
        return new Response(JSON.stringify({ error: "Forbidden: users.update required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await adminClient
        .from("profiles")
        .update({ is_active: data.is_active })
        .eq("id", data.user_id);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_roles") {
      const data = body as SetRolesData;

      const { data: canUpdate } = await userClient.rpc("has_permission", { p_code: "users.update" });
      if (!canUpdate) {
        return new Response(JSON.stringify({ error: "Forbidden: users.update required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: callerIsSuperAdmin } = await userClient.rpc("is_super_admin");
      const SENSITIVE = ["super_admin", "direction"];
      if (data.role_codes.some((c) => SENSITIVE.includes(c)) && !callerIsSuperAdmin) {
        return new Response(JSON.stringify({ error: "Seul un super admin peut attribuer un rôle sensible" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingRoles } = await adminClient
        .from("user_roles")
        .select("role_id, roles(code)")
        .eq("user_id", data.user_id)
        .eq("institution_id", data.institution_id);

      const currentSensitive = (existingRoles ?? []).filter((ur) =>
        ur.roles && SENSITIVE.includes((ur.roles as { code: string }).code)
      );

      const requestedSensitive = data.role_codes.filter((c) => SENSITIVE.includes(c));
      if (currentSensitive.length > 0 && requestedSensitive.length === 0 && data.role_codes.length === 0) {
        return new Response(JSON.stringify({ error: "Impossible de retirer tous les rôles d'un utilisateur sensible" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: roles } = await adminClient
        .from("roles")
        .select("id, code")
        .in("code", data.role_codes);

      const roleMap = new Map((roles ?? []).map((r) => [r.code, r.id]));

      const { error: deleteErr } = await adminClient
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("institution_id", data.institution_id);

      if (deleteErr) throw deleteErr;

      if (data.role_codes.length > 0) {
        const inserts = data.role_codes
          .map((code) => roleMap.get(code))
          .filter(Boolean)
          .map((role_id) => ({
            user_id: data.user_id,
            role_id: role_id as string,
            institution_id: data.institution_id,
          }));

        if (inserts.length > 0) {
          const { error: insertErr } = await adminClient
            .from("user_roles")
            .insert(inserts);
          if (insertErr) throw insertErr;
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "link_student_account") {
      const data = body as LinkStudentData;

      if (!data.student_id || !data.email) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: student, error: studentError } = await adminClient
        .from("students")
        .select("id, profile_id, institution_id, email, first_name, last_name")
        .eq("id", data.student_id)
        .maybeSingle();

      if (studentError) throw studentError;
      if (!student) {
        return new Response(JSON.stringify({ error: "Étudiant introuvable" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (student.profile_id) {
        return new Response(JSON.stringify({ error: "Cet étudiant a déjà un compte portail" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingAuth } = await adminClient.auth.admin.listUsers();
      const emailExists = (existingAuth.users ?? []).some((u) => u.email === data.email);
      if (emailExists) {
        return new Response(JSON.stringify({ error: "Un compte existe déjà avec cet email" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: role } = await adminClient
        .from("roles")
        .select("id")
        .eq("code", "etudiant")
        .maybeSingle();

      if (!role) {
        return new Response(JSON.stringify({ error: "Rôle etudiant introuvable" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const password = data.password && data.password.length >= 6 ? data.password : generateTempPassword();

      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email: data.email,
        password,
        email_confirm: true,
        user_metadata: {
          first_name: student.first_name ?? "",
          last_name: student.last_name ?? "",
        },
      });

      if (authError) throw authError;
      const newUserId = authData.user.id;

      const { error: profileError } = await adminClient
        .from("profiles")
        .upsert({
          id: newUserId,
          institution_id: student.institution_id,
          first_name: student.first_name ?? "",
          last_name: student.last_name ?? "",
          is_active: true,
        }, { onConflict: "id" });

      if (profileError) {
        await adminClient.auth.admin.deleteUser(newUserId);
        throw profileError;
      }

      const { error: roleError } = await adminClient
        .from("user_roles")
        .insert({
          user_id: newUserId,
          role_id: role.id,
          institution_id: student.institution_id,
        });

      if (roleError) {
        await adminClient.auth.admin.deleteUser(newUserId);
        throw roleError;
      }

      const { error: linkError } = await adminClient
        .from("students")
        .update({ profile_id: newUserId })
        .eq("id", data.student_id)
        .is("profile_id", null);

      if (linkError) {
        await adminClient.from("user_roles").delete().eq("user_id", newUserId);
        await adminClient.auth.admin.deleteUser(newUserId);
        throw linkError;
      }

      return new Response(JSON.stringify({ user_id: newUserId, success: true, temporary_password: password }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "link_staff_account") {
      const data = body as LinkStaffAccountData;

      if (!data.staff_id || !data.email || !data.role_code) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: canCreate } = await userClient.rpc("has_permission", { p_code: "hr.create" });
      if (!canCreate) {
        return new Response(JSON.stringify({ error: "Forbidden: hr.create required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: staffRow, error: staffErr } = await adminClient
        .from("hr_staff")
        .select("id, profile_id, institution_id, first_name, last_name, personal_email")
        .eq("id", data.staff_id)
        .maybeSingle();

      if (staffErr) throw staffErr;
      if (!staffRow) {
        return new Response(JSON.stringify({ error: "Personnel introuvable" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (staffRow.profile_id) {
        return new Response(JSON.stringify({ error: "Ce personnel a déjà un compte portail" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingAuth } = await adminClient.auth.admin.listUsers();
      const emailExists = (existingAuth.users ?? []).some((u) => u.email === data.email);
      if (emailExists) {
        return new Response(JSON.stringify({ error: "Un compte existe déjà avec cet email" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: role } = await adminClient
        .from("roles")
        .select("id")
        .eq("code", data.role_code)
        .maybeSingle();

      if (!role) {
        return new Response(JSON.stringify({ error: `Rôle ${data.role_code} introuvable` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const password = data.password && data.password.length >= 6 ? data.password : generateTempPassword();

      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email: data.email,
        password,
        email_confirm: true,
        user_metadata: {
          first_name: staffRow.first_name ?? "",
          last_name: staffRow.last_name ?? "",
        },
      });

      if (authError) throw authError;
      const newUserId = authData.user.id;

      const { error: profileError } = await adminClient
        .from("profiles")
        .upsert({
          id: newUserId,
          institution_id: staffRow.institution_id,
          first_name: staffRow.first_name ?? "",
          last_name: staffRow.last_name ?? "",
          is_active: true,
        }, { onConflict: "id" });

      if (profileError) {
        await adminClient.auth.admin.deleteUser(newUserId);
        throw profileError;
      }

      const { error: roleError } = await adminClient
        .from("user_roles")
        .insert({
          user_id: newUserId,
          role_id: role.id,
          institution_id: staffRow.institution_id,
        });

      if (roleError) {
        await adminClient.auth.admin.deleteUser(newUserId);
        throw roleError;
      }

      const { error: linkError } = await adminClient
        .from("hr_staff")
        .update({ profile_id: newUserId })
        .eq("id", data.staff_id)
        .is("profile_id", null);

      if (linkError) {
        await adminClient.from("user_roles").delete().eq("user_id", newUserId);
        await adminClient.auth.admin.deleteUser(newUserId);
        throw linkError;
      }

      return new Response(JSON.stringify({ user_id: newUserId, success: true, temporary_password: password }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "link_existing_user_to_staff") {
      const data = body as LinkExistingUserToStaffData;

      if (!data.staff_id || !data.user_id || !data.role_code) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: canUpdate } = await userClient.rpc("has_permission", { p_code: "hr.update" });
      if (!canUpdate) {
        return new Response(JSON.stringify({ error: "Forbidden: hr.update required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: staffRow, error: staffErr } = await adminClient
        .from("hr_staff")
        .select("id, profile_id, institution_id")
        .eq("id", data.staff_id)
        .maybeSingle();

      if (staffErr) throw staffErr;
      if (!staffRow) {
        return new Response(JSON.stringify({ error: "Personnel introuvable" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (staffRow.profile_id) {
        return new Response(JSON.stringify({ error: "Ce personnel a déjà un compte associé" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id, institution_id")
        .eq("id", data.user_id)
        .maybeSingle();

      if (!existingProfile) {
        return new Response(JSON.stringify({ error: "Utilisateur introuvable" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (existingProfile.institution_id !== staffRow.institution_id) {
        return new Response(JSON.stringify({ error: "L'utilisateur n'appartient pas à la même institution" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: role } = await adminClient
        .from("roles")
        .select("id")
        .eq("code", data.role_code)
        .maybeSingle();

      if (!role) {
        return new Response(JSON.stringify({ error: `Rôle ${data.role_code} introuvable` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingRole } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", data.user_id)
        .eq("role_id", role.id)
        .eq("institution_id", staffRow.institution_id)
        .maybeSingle();

      if (!existingRole) {
        const { error: roleError } = await adminClient
          .from("user_roles")
          .insert({
            user_id: data.user_id,
            role_id: role.id,
            institution_id: staffRow.institution_id,
          });
        if (roleError) throw roleError;
      }

      const { error: linkError } = await adminClient
        .from("hr_staff")
        .update({ profile_id: data.user_id })
        .eq("id", data.staff_id)
        .is("profile_id", null);

      if (linkError) throw linkError;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "An error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
