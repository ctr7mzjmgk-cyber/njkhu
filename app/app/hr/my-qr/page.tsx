"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import { getStaffDisplayName, getStaffInitials } from "@/lib/hr/staff-utils";
import {
  QrCode, RefreshCw, Loader as Loader2, Clock, CheckCircle2,
  AlertTriangle, LogIn, LogOut,
} from "lucide-react";
import type { Database } from "@/lib/types/database";

type StaffMember = Database["public"]["Tables"]["hr_staff"]["Row"];

const QR_TTL = 15;

export default function EmployeeQRPage() {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [remaining, setRemaining] = useState(QR_TTL);
  const [generating, setGenerating] = useState(false);
  const [lastEvent, setLastEvent] = useState<"clock_in" | "clock_out" | null>(null);
  const [lastEventTime, setLastEventTime] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load staff record
  useEffect(() => {
    if (!user?.id || !profile?.institution_id) return;
    supabase
      .from("hr_staff")
      .select("*")
      .eq("profile_id", user.id)
      .eq("institution_id", profile.institution_id)
      .maybeSingle()
      .then(({ data }) => {
        setStaff(data as StaffMember | null);
        setLoading(false);
      });
  }, [user?.id, profile?.institution_id]);

  // Check last event
  const checkLastEvent = useCallback(async () => {
    if (!staff) return;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from("attendance_events")
      .select("event_type, server_timestamp")
      .eq("staff_id", staff.id)
      .gte("server_timestamp", todayStart.toISOString())
      .order("server_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setLastEvent(data.event_type as "clock_in" | "clock_out");
      setLastEventTime(data.server_timestamp);
    } else {
      setLastEvent(null);
      setLastEventTime(null);
    }
  }, [staff]);

  useEffect(() => {
    checkLastEvent();
  }, [checkLastEvent]);

  // Generate QR token
  const generateQR = useCallback(async () => {
    setGenerating(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const response = await fetch("/api/attendance-clock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: "generate_qr", method: "employee_qr" }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erreur");

      setToken(data.token);
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Impossible de générer le QR",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [toast]);

  // Countdown + auto-regenerate
  useEffect(() => {
    if (!token) return;
    setRemaining(QR_TTL);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          // Auto-regenerate
          generateQR();
          return QR_TTL;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [token, generateQR]);

  // Poll for event changes (detect when terminal scanned the QR)
  useEffect(() => {
    if (!staff) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(checkLastEvent, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [staff, checkLastEvent]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <p className="text-lg font-semibold">Aucun enregistrement de personnel lié</p>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          Votre compte n'est pas lié à un enregistrement de personnel. Contactez un administrateur RH.
        </p>
      </div>
    );
  }

  const progress = (remaining / QR_TTL) * 100;
  const isExpired = remaining <= 0;

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Mon QR de pointage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Présentez ce QR devant un terminal de pointage pour pointer
        </p>
      </div>

      {/* Status badge */}
      {lastEvent && (
        <div className="flex items-center gap-2">
          {lastEvent === "clock_in" ? (
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-sm px-3 py-1">
              <LogIn className="w-3.5 h-3.5 mr-1" />
              Entré à {lastEventTime ? new Date(lastEventTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}
            </Badge>
          ) : (
            <Badge className="bg-red-100 text-red-700 hover:bg-red-100 text-sm px-3 py-1">
              <LogOut className="w-3.5 h-3.5 mr-1" />
              Sorti à {lastEventTime ? new Date(lastEventTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}
            </Badge>
          )}
        </div>
      )}

      {/* QR display */}
      <Card className="p-8 flex flex-col items-center gap-4 relative overflow-hidden">
        {token && !isExpired ? (
          <>
            {/* QR code visual — we use a simple SVG-based QR placeholder */}
            <div className="relative">
              <div className="w-64 h-64 bg-white border-4 border-slate-900 rounded-xl flex items-center justify-center p-4">
                <QRCodeSVG token={token} size={240} />
              </div>
              {/* Countdown ring */}
              <div className="absolute -top-2 -right-2 w-12 h-12 rounded-full bg-white border-2 border-primary flex items-center justify-center shadow-lg">
                <span className="text-lg font-bold text-primary">{remaining}</span>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-1000 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>Renouvellement dans {remaining}s</span>
            </div>
          </>
        ) : generating ? (
          <div className="w-64 h-64 flex items-center justify-center">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
          </div>
        ) : (
          <div className="w-64 h-64 flex flex-col items-center justify-center gap-4">
            <QrCode className="w-16 h-16 text-muted-foreground" />
            <Button onClick={generateQR}>
              <QrCode className="w-4 h-4 mr-2" /> Générer mon QR
            </Button>
          </div>
        )}
      </Card>

      {/* Actions */}
      {token && (
        <Button variant="outline" onClick={generateQR} disabled={generating}>
          {generating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Renouveler le QR
        </Button>
      )}

      {/* Staff info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        <span>{getStaffDisplayName(staff)} — {staff.staff_number}</span>
      </div>
    </div>
  );
}

// Simple QR-style SVG renderer (visual representation)
function QRCodeSVG({ token, size }: { token: string; size: number }) {
  // Generate a deterministic grid from the token
  const cells = 25;
  const cellSize = size / cells;
  const hash = [...token].reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);

  const grid: boolean[][] = [];
  let seed = Math.abs(hash);
  for (let r = 0; r < cells; r++) {
    grid[r] = [];
    for (let c = 0; c < cells; c++) {
      seed = (seed * 9301 + 49297) % 233280;
      grid[r][c] = seed / 233280 > 0.5;
    }
  }

  // Corner positioning squares (QR-like)
  const corners = [
    [0, 0], [0, cells - 7], [cells - 7, 0],
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill="white" />
      {grid.map((row, r) =>
        row.map((on, c) => {
          // Skip corner areas
          for (const [cr, cc] of corners) {
            if (r >= cr && r < cr + 7 && c >= cc && c < cc + 7) return null;
          }
          return on ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize}
              height={cellSize}
              fill="black"
            />
          ) : null;
        })
      )}
      {/* Corner squares */}
      {corners.map(([r, c], i) => (
        <g key={i}>
          <rect x={c * cellSize} y={r * cellSize} width={cellSize * 7} height={cellSize * 7} fill="black" />
          <rect x={(c + 1) * cellSize} y={(r + 1) * cellSize} width={cellSize * 5} height={cellSize * 5} fill="white" />
          <rect x={(c + 2) * cellSize} y={(r + 2) * cellSize} width={cellSize * 3} height={cellSize * 3} fill="black" />
        </g>
      ))}
      {/* Token text at the bottom */}
      <text
        x={size / 2}
        y={size - 4}
        textAnchor="middle"
        fontSize="8"
        fontFamily="monospace"
        fill="#666"
      >
        {token.slice(0, 8)}...
      </text>
    </svg>
  );
}
