import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Terminal-Key",
};

interface ClockRequest {
  staff_id?: string;
  staff_number?: string;
  institution_id?: string;
  terminal_id?: string;
  terminal_key?: string;
  method: "employee_qr" | "terminal_qr" | "fingerprint" | "manual";
  event_type?: "clock_in" | "clock_out";
  latitude?: number;
  longitude?: number;
  client_timestamp?: string;
  metadata?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Méthode non autorisée" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body: ClockRequest = await req.json();

    // --- Determine which client is calling ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const terminalKey = req.headers.get("X-Terminal-Key") ?? body.terminal_key;
    const hasUserAuth = authHeader.startsWith("Bearer ");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // For terminal-based requests, we use the service role (terminal auth is via X-Terminal-Key)
    // For user-based requests (manual entry by admin), we use the service role but verify the user JWT
    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    let institutionId = body.institution_id;
    let terminalId: string | null = body.terminal_id ?? null;
    let isTerminalRequest = false;

    // --- Terminal authentication path ---
    if (terminalKey && terminalId) {
      isTerminalRequest = true;
      const { data: terminal, error: termError } = await serviceClient
        .from("attendance_terminals")
        .select("id, institution_id, is_active, api_key_hash")
        .eq("id", terminalId)
        .eq("is_active", true)
        .maybeSingle();

      if (termError || !terminal) {
        return jsonError("Termininal introuvable ou inactif", 404);
      }

      // Hash the provided key and compare
      const keyHash = await hashKey(terminalKey);
      if (terminal.api_key_hash !== keyHash) {
        return jsonError("Clé terminal invalide", 401);
      }

      institutionId = terminal.institution_id;

      // Update last_seen_at
      await serviceClient
        .from("attendance_terminals")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", terminal.id);
    }

    // --- User (admin) authentication path ---
    if (!isTerminalRequest && hasUserAuth) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        auth: { persistSession: false },
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        return jsonError("Non authentifié", 401);
      }

      // Get the user's profile to find their institution
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile?.institution_id) {
        return jsonError("Aucune institution associée à votre compte", 403);
      }

      institutionId = profile.institution_id;

      // For manual entries, verify the user has hr.create permission
      if (body.method === "manual") {
        const { data: hasPerm } = await serviceClient.rpc("has_permission", {
          p_code: "hr.create",
        });
        if (!hasPerm) {
          // Check super_admin
          const { data: isSuper } = await serviceClient.rpc("is_super_admin");
          if (!isSuper) {
            return jsonError("Permission insuffisante pour saisie manuelle", 403);
          }
        }
      }
    }

    if (!institutionId) {
      return jsonError("Institution non déterminée", 400);
    }

    // --- Validate method is enabled for this institution ---
    const { data: config } = await serviceClient
      .from("institution_attendance_config")
      .select("enabled_methods, require_geolocation")
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (config && config.enabled_methods.length > 0) {
      if (!config.enabled_methods.includes(body.method)) {
        return jsonError(
          `Méthode '${body.method}' non activée pour cette institution`,
          400
        );
      }
    }

    if (config?.require_geolocation && (body.latitude == null || body.longitude == null)) {
      return jsonError("Position GPS requise pour cette institution", 400);
    }

    // --- Resolve staff ---
    let staffId = body.staff_id;

    if (!staffId && body.staff_number) {
      const { data: staff, error: staffError } = await serviceClient
        .from("hr_staff")
        .select("id, status")
        .eq("institution_id", institutionId)
        .eq("staff_number", body.staff_number)
        .maybeSingle();

      if (staffError || !staff) {
        return jsonError("Employé introuvable", 404);
      }

      if (staff.status !== "active" && staff.status !== "on_leave") {
        return jsonError("Employé non actif", 400);
      }

      staffId = staff.id;
    }

    if (!staffId) {
      return jsonError("staff_id ou staff_number requis", 400);
    }

    // --- Determine event type if not provided ---
    let eventType = body.event_type;

    if (!eventType) {
      // Auto-detect: find the last event for this staff today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: lastEvent } = await serviceClient
        .from("attendance_events")
        .select("event_type, server_timestamp")
        .eq("staff_id", staffId)
        .gte("server_timestamp", todayStart.toISOString())
        .order("server_timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastEvent) {
        eventType = "clock_in";
      } else if (lastEvent.event_type === "clock_in") {
        eventType = "clock_out";
      } else {
        eventType = "clock_in";
      }
    }

    // --- Prevent duplicate clock_in within a short window ---
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

    // --- Insert the event with server timestamp ---
    const now = new Date().toISOString();

    const insertRow = {
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
    };

    const { data: event, error: insertError } = await serviceClient
      .from("attendance_events")
      .insert(insertRow)
      .select("id, event_type, server_timestamp, method")
      .single();

    if (insertError) {
      return jsonError("Erreur lors de l'enregistrement du pointage", 500);
    }

    return new Response(
      JSON.stringify({
        success: true,
        event: {
          id: event.id,
          event_type: event.event_type,
          server_timestamp: event.server_timestamp,
          method: event.method,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return jsonError(message, 500);
  }
});

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
