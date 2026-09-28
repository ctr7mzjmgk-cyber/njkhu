import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Terminal-Key",
};

interface ClockRequest {
  action?: "clock" | "generate_qr" | "verify_qr" | "heartbeat" | "terminal_qr";
  staff_id?: string;
  staff_number?: string;
  institution_id?: string;
  terminal_id?: string;
  terminal_key?: string;
  method: "employee_qr" | "terminal_qr" | "fingerprint" | "manual";
  event_type?: "clock_in" | "clock_out";
  qr_token?: string;
  latitude?: number;
  longitude?: number;
  client_timestamp?: string;
  metadata?: Record<string, unknown>;
}

const EMPLOYEE_QR_TTL_SEC = 15;
const TERMINAL_QR_TTL_SEC = 10;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonError("Méthode non autorisée", 405);
  }

  try {
    const body: ClockRequest = await req.json();
    const action = body.action ?? "clock";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // ==========================================================
    // ACTION: generate_qr — employee generates a QR token
    // ==========================================================
    if (action === "generate_qr") {
      return handleGenerateEmployeeQR(req, body, serviceClient, supabaseUrl, anonKey);
    }

    // ==========================================================
    // ACTION: terminal_qr — terminal requests a QR to display
    // ==========================================================
    if (action === "terminal_qr") {
      return handleGenerateTerminalQR(body, serviceClient);
    }

    // ==========================================================
    // ACTION: heartbeat — terminal pings to stay alive
    // ==========================================================
    if (action === "heartbeat") {
      return handleHeartbeat(body, serviceClient);
    }

    // ==========================================================
    // ACTION: clock — the main clock-in/out handler
    // ==========================================================
    return handleClock(req, body, serviceClient, supabaseUrl, anonKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return jsonError(message, 500);
  }
});

// ================================================================
// Generate employee QR token (authenticated user → staff QR)
// ================================================================
async function handleGenerateEmployeeQR(
  req: Request,
  body: ClockRequest,
  serviceClient: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError("Authentification requise", 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return jsonError("Non authentifié", 401);
  }

  // Find the staff record linked to this user's profile
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.institution_id) {
    return jsonError("Aucune institution associée", 403);
  }

  // Find hr_staff by profile_id
  const { data: staff } = await serviceClient
    .from("hr_staff")
    .select("id, status")
    .eq("profile_id", user.id)
    .eq("institution_id", profile.institution_id)
    .maybeSingle();

  if (!staff) {
    return jsonError("Aucun enregistrement de personnel lié à votre compte", 404);
  }

  if (staff.status !== "active" && staff.status !== "on_leave") {
    return jsonError("Employé non actif", 400);
  }

  // Delete previous unused tokens for this staff (renewable)
  await serviceClient
    .from("attendance_qr_tokens")
    .delete()
    .eq("staff_id", staff.id)
    .is("used_at", null);

  // Generate new token
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + EMPLOYEE_QR_TTL_SEC * 1000).toISOString();

  const { error: insertError } = await serviceClient
    .from("attendance_qr_tokens")
    .insert({
      institution_id: profile.institution_id,
      token,
      token_type: "employee",
      staff_id: staff.id,
      expires_at: expiresAt,
    });

  if (insertError) {
    return jsonError("Erreur lors de la génération du QR", 500);
  }

  return jsonResponse({
    success: true,
    token,
    expires_at: expiresAt,
    ttl_seconds: EMPLOYEE_QR_TTL_SEC,
  });
}

// ================================================================
// Generate terminal QR token (terminal-authenticated)
// ================================================================
async function handleGenerateTerminalQR(
  body: ClockRequest,
  serviceClient: ReturnType<typeof createClient>,
): Promise<Response> {
  const terminalKey = body.terminal_key;
  const terminalId = body.terminal_id;

  if (!terminalKey || !terminalId) {
    return jsonError("terminal_id et terminal_key requis", 400);
  }

  // Authenticate terminal
  const { data: terminal } = await serviceClient
    .from("attendance_terminals")
    .select("id, institution_id, is_active, api_key_hash")
    .eq("id", terminalId)
    .eq("is_active", true)
    .maybeSingle();

  if (!terminal) {
    return jsonError("Terminal introuvable ou inactif", 404);
  }

  const keyHash = await hashKey(terminalKey);
  if (terminal.api_key_hash !== keyHash) {
    return jsonError("Clé terminal invalide", 401);
  }

  // Update last_seen_at
  await serviceClient
    .from("attendance_terminals")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", terminal.id);

  // Delete previous unused tokens for this terminal
  await serviceClient
    .from("attendance_qr_tokens")
    .delete()
    .eq("terminal_id", terminal.id)
    .is("used_at", null);

  // Generate new token
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TERMINAL_QR_TTL_SEC * 1000).toISOString();

  const { error: insertError } = await serviceClient
    .from("attendance_qr_tokens")
    .insert({
      institution_id: terminal.institution_id,
      token,
      token_type: "terminal",
      terminal_id: terminal.id,
      expires_at: expiresAt,
    });

  if (insertError) {
    return jsonError("Erreur lors de la génération du QR terminal", 500);
  }

  return jsonResponse({
    success: true,
    token,
    expires_at: expiresAt,
    ttl_seconds: TERMINAL_QR_TTL_SEC,
    institution_id: terminal.institution_id,
  });
}

// ================================================================
// Heartbeat — terminal pings to update last_seen_at
// ================================================================
async function handleHeartbeat(
  body: ClockRequest,
  serviceClient: ReturnType<typeof createClient>,
): Promise<Response> {
  const terminalKey = body.terminal_key;
  const terminalId = body.terminal_id;

  if (!terminalKey || !terminalId) {
    return jsonError("terminal_id et terminal_key requis", 400);
  }

  const { data: terminal } = await serviceClient
    .from("attendance_terminals")
    .select("id, is_active, api_key_hash")
    .eq("id", terminalId)
    .maybeSingle();

  if (!terminal) {
    return jsonError("Terminal introuvable", 404);
  }

  const keyHash = await hashKey(terminalKey);
  if (terminal.api_key_hash !== keyHash) {
    return jsonError("Clé terminal invalide", 401);
  }

  await serviceClient
    .from("attendance_terminals")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", terminal.id);

  return jsonResponse({ success: true, is_active: terminal.is_active });
}

// ================================================================
// Main clock handler — processes all clock-in/out events
// ================================================================
async function handleClock(
  req: Request,
  body: ClockRequest,
  serviceClient: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const terminalKey = req.headers.get("X-Terminal-Key") ?? body.terminal_key;
  const hasUserAuth = authHeader.startsWith("Bearer ");

  let institutionId = body.institution_id;
  let terminalId: string | null = body.terminal_id ?? null;
  let isTerminalRequest = false;
  let staffId = body.staff_id;

  // --- Terminal authentication path ---
  if (terminalKey && terminalId) {
    isTerminalRequest = true;
    const { data: terminal } = await serviceClient
      .from("attendance_terminals")
      .select("id, institution_id, is_active, api_key_hash")
      .eq("id", terminalId)
      .eq("is_active", true)
      .maybeSingle();

    if (!terminal) {
      return jsonError("Terminal introuvable ou inactif", 404);
    }

    const keyHash = await hashKey(terminalKey);
    if (terminal.api_key_hash !== keyHash) {
      return jsonError("Clé terminal invalide", 401);
    }

    institutionId = terminal.institution_id;

    await serviceClient
      .from("attendance_terminals")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", terminal.id);
  }

  // --- QR token verification (employee_qr or terminal_qr) ---
  if (body.method === "employee_qr" || body.method === "terminal_qr") {
    if (!body.qr_token) {
      return jsonError("qr_token requis pour cette méthode", 400);
    }

    const now = new Date().toISOString();

    // Look up the token
    const { data: qrToken, error: tokenError } = await serviceClient
      .from("attendance_qr_tokens")
      .select("id, staff_id, terminal_id, institution_id, expires_at, used_at, token_type")
      .eq("token", body.qr_token)
      .maybeSingle();

    if (tokenError || !qrToken) {
      return jsonError("Token QR invalide", 401);
    }

    // Check if already used (single-use)
    if (qrToken.used_at) {
      return jsonError("Token QR déjà utilisé", 409);
    }

    // Check if expired
    if (new Date(qrToken.expires_at) < new Date(now)) {
      return jsonError("Token QR expiré", 410);
    }

    // Mark as used (atomic single-use: only update if still unused)
    const { error: useError } = await serviceClient
      .from("attendance_qr_tokens")
      .update({ used_at: now })
      .eq("id", qrToken.id)
      .is("used_at", null);

    if (useError) {
      // Race condition — another request used it first
      return jsonError("Token QR déjà consommé", 409);
    }

    // For employee QR: staff_id comes from the token
    if (body.method === "employee_qr" && qrToken.staff_id) {
      staffId = qrToken.staff_id;
      institutionId = qrToken.institution_id;
    }

    // For terminal QR: the terminal scans the employee's QR code
    // In this case, the qr_token IS the employee's token, verified above
    if (body.method === "terminal_qr" && qrToken.token_type === "employee" && qrToken.staff_id) {
      staffId = qrToken.staff_id;
      institutionId = qrToken.institution_id;
      // The terminal_id is from the terminal auth
    }
  }

  // --- User (admin) authentication path for manual entries ---
  if (!isTerminalRequest && hasUserAuth && body.method === "manual") {
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonError("Non authentifié", 401);
    }

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.institution_id) {
      return jsonError("Aucune institution associée", 403);
    }

    institutionId = profile.institution_id;

    // Verify hr.create permission
    const { data: hasPerm } = await serviceClient.rpc("has_permission", {
      p_code: "hr.create",
    });
    if (!hasPerm) {
      const { data: isSuper } = await serviceClient.rpc("is_super_admin");
      if (!isSuper) {
        return jsonError("Permission insuffisante pour saisie manuelle", 403);
      }
    }
  }

  if (!institutionId) {
    return jsonError("Institution non déterminée", 400);
  }

  // --- Validate method is enabled ---
  const { data: config } = await serviceClient
    .from("institution_attendance_config")
    .select("enabled_methods, require_geolocation")
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (config && config.enabled_methods.length > 0) {
    if (!config.enabled_methods.includes(body.method)) {
      return jsonError(`Méthode '${body.method}' non activée pour cette institution`, 400);
    }
  }

  if (config?.require_geolocation && (body.latitude == null || body.longitude == null)) {
    return jsonError("Position GPS requise pour cette institution", 400);
  }

  // --- Resolve staff (if not already set via QR token) ---
  if (!staffId && body.staff_number) {
    const { data: staff } = await serviceClient
      .from("hr_staff")
      .select("id, status")
      .eq("institution_id", institutionId)
      .eq("staff_number", body.staff_number)
      .maybeSingle();

    if (!staff) {
      return jsonError("Employé introuvable", 404);
    }

    if (staff.status !== "active" && staff.status !== "on_leave") {
      return jsonError("Employé non actif", 400);
    }

    staffId = staff.id;
  }

  if (!staffId) {
    return jsonError("staff_id ou staff_number ou qr_token requis", 400);
  }

  // --- Verify staff belongs to this institution ---
  const { data: staffCheck } = await serviceClient
    .from("hr_staff")
    .select("id, status")
    .eq("id", staffId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (!staffCheck) {
    return jsonError("Employé introuvable dans cette institution", 404);
  }

  if (staffCheck.status !== "active" && staffCheck.status !== "on_leave") {
    return jsonError("Employé non actif", 400);
  }

  // --- Determine event type if not provided ---
  let eventType = body.event_type;

  if (!eventType) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: lastEvent } = await serviceClient
      .from("attendance_events")
      .select("event_type")
      .eq("staff_id", staffId)
      .gte("server_timestamp", todayStart.toISOString())
      .order("server_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    eventType = !lastEvent || lastEvent.event_type === "clock_out" ? "clock_in" : "clock_out";
  }

  // --- Prevent duplicate clock_in within 5 minutes ---
  if (eventType === "clock_in") {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const { data: recentIn } = await serviceClient
      .from("attendance_events")
      .select("id")
      .eq("staff_id", staffId)
      .eq("event_type", "clock_in")
      .gte("server_timestamp", fiveMinAgo.toISOString())
      .maybeSingle();

    if (recentIn) {
      return jsonError("Pointage d'entrée récent détecté (moins de 5 minutes)", 409);
    }
  }

  // --- Insert event with server timestamp ---
  const now = new Date().toISOString();

  const { data: event, error: insertError } = await serviceClient
    .from("attendance_events")
    .insert({
      institution_id: institutionId,
      staff_id: staffId,
      terminal_id: isTerminalRequest ? terminalId : (body.terminal_id ?? null),
      event_type: eventType,
      method: body.method,
      server_timestamp: now,
      client_timestamp: body.client_timestamp ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      metadata: body.metadata ?? {},
    })
    .select("id, event_type, server_timestamp, method")
    .single();

  if (insertError) {
    return jsonError("Erreur lors de l'enregistrement du pointage", 500);
  }

  // Opportunistic cleanup of expired tokens
  await serviceClient
    .from("attendance_qr_tokens")
    .delete()
    .lt("expires_at", new Date(Date.now() - 3600 * 1000).toISOString());

  return jsonResponse({
    success: true,
    event: {
      id: event.id,
      event_type: event.event_type,
      server_timestamp: event.server_timestamp,
      method: event.method,
    },
  });
}

// ================================================================
// Helpers
// ================================================================
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
