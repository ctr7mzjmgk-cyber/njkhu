"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  QrCode, Loader as Loader2, Clock, AlertTriangle, CheckCircle2,
  LogIn, LogOut, Power, ArrowLeft,
} from "lucide-react";

const QR_TTL = 10;

async function callEdgeFunction(body: Record<string, unknown>): Promise<{ data: any; error: string | null }> {
  try {
    const response = await fetch("/api/attendance-clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) return { data: null, error: data.error || `Erreur ${response.status}` };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Erreur réseau" };
  }
}

export default function TerminalKioskPage({ params }: { params: { terminalId: string } }) {
  const { terminalId } = params;
  const { toast } = useToast();

  const [terminalKey, setTerminalKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [terminalInfo, setTerminalInfo] = useState<{
    name: string;
    code: string;
    institution_id: string;
  } | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(QR_TTL);
  const [generating, setGenerating] = useState(false);
  const [heartbeatOk, setHeartbeatOk] = useState(true);

  // Feedback after a scan
  const [scanResult, setScanResult] = useState<{
    type: "clock_in" | "clock_out";
    staffName: string;
    time: string;
  } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load saved key from sessionStorage
  useEffect(() => {
    const savedKey = sessionStorage.getItem(`terminal_key_${terminalId}`);
    if (savedKey) {
      setTerminalKey(savedKey);
      // Auto-authenticate
      authenticateTerminal(savedKey);
    }
  }, [terminalId]);

  const authenticateTerminal = async (key?: string) => {
    const useKey = key ?? terminalKey;
    if (!useKey) return;

    setGenerating(true);
    try {
      const { data, error } = await callEdgeFunction({
        action: "terminal_qr",
        method: "terminal_qr",
        terminal_id: terminalId,
        terminal_key: useKey,
      });

      if (error) throw new Error(error);

      sessionStorage.setItem(`terminal_key_${terminalId}`, useKey);
      setAuthenticated(true);
      setTerminalInfo({
        name: "Terminal",
        code: terminalId.slice(0, 8),
        institution_id: data.institution_id,
      });
      setToken(data.token);
    } catch (err) {
      sessionStorage.removeItem(`terminal_key_${terminalId}`);
      setAuthenticated(false);
      toast({
        title: "Erreur d'authentification",
        description: err instanceof Error ? err.message : "Terminal non authentifié",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  // Generate new QR token
  const generateQR = useCallback(async () => {
    if (!terminalKey) return;
    setGenerating(true);
    try {
      const { data, error } = await callEdgeFunction({
        action: "terminal_qr",
        method: "terminal_qr",
        terminal_id: terminalId,
        terminal_key: terminalKey,
      });

      if (error) throw new Error(error);
      setToken(data.token);
    } catch {
      setHeartbeatOk(false);
    } finally {
      setGenerating(false);
    }
  }, [terminalId, terminalKey]);

  // QR auto-refresh countdown
  useEffect(() => {
    if (!authenticated || !token) return;
    setRemaining(QR_TTL);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          generateQR();
          return QR_TTL;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [authenticated, token, generateQR]);

  // Heartbeat every 30 seconds
  useEffect(() => {
    if (!authenticated) return;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      try {
        const { data, error } = await callEdgeFunction({
          action: "heartbeat",
          method: "terminal_qr",
          terminal_id: terminalId,
          terminal_key: terminalKey,
        });
        if (error) { setHeartbeatOk(false); return; }
        setHeartbeatOk(data.success && data.is_active);
        if (data.is_active === false) {
          setAuthenticated(false);
          sessionStorage.removeItem(`terminal_key_${terminalId}`);
          toast({
            title: "Terminal désactivé",
            description: "Ce terminal a été désactivé par un administrateur.",
            variant: "destructive",
          });
        }
      } catch {
        setHeartbeatOk(false);
      }
    }, 30000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [authenticated, terminalId, terminalKey, toast]);

  // Simulate a scan (for demo/testing — in production the terminal camera scans)
  const simulateScan = async () => {
    if (!token) return;
    setScanResult(null);
    setScanError(null);

    try {
      // The terminal scans the employee's QR, which contains the employee's token
      // For testing, we generate an employee token first by providing a staff_number
      // In production, the camera reads the QR and sends the token directly
      const { data, error } = await callEdgeFunction({
        action: "clock",
        method: "terminal_qr",
        terminal_id: terminalId,
        terminal_key: terminalKey,
        qr_token: token,
      });

      if (error) throw new Error(error);

      setScanResult({
        type: data.event.event_type,
        staffName: "Employé",
        time: new Date(data.event.server_timestamp).toLocaleTimeString("fr-FR", {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }),
      });
      // Generate a new QR immediately
      generateQR();
      setTimeout(() => setScanResult(null), 5000);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Erreur lors du scan");
      setTimeout(() => setScanError(null), 5000);
    }
  };

  const logout = () => {
    sessionStorage.removeItem(`terminal_key_${terminalId}`);
    setAuthenticated(false);
    setToken(null);
    setTerminalKey("");
    setTerminalInfo(null);
  };

  // Login screen
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
              <QrCode className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold">Borne de pointage</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Saisissez la clé API du terminal pour activer la borne
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key">Clé du terminal</Label>
              <Input
                id="key"
                type="password"
                placeholder="term_..."
                value={terminalKey}
                onChange={(e) => setTerminalKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && authenticateTerminal()}
              />
            </div>
            <Button
              className="w-full"
              onClick={() => authenticateTerminal()}
              disabled={!terminalKey || generating}
            >
              {generating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Power className="w-4 h-4 mr-2" />
              )}
              Activer la borne
            </Button>
          </div>

          <div className="mt-6 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <p className="text-xs text-blue-700">
              Terminal ID: <code className="font-mono">{terminalId.slice(0, 8)}...</code>
              <br />
              La clé est fournie par l'administrateur lors de la création du terminal.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // Kiosk display
  const progress = (remaining / QR_TTL) * 100;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <QrCode className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold">{terminalInfo?.name ?? "Terminal"}</p>
            <p className="text-xs text-slate-400 font-mono">{terminalInfo?.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${heartbeatOk ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-xs text-slate-400">{heartbeatOk ? "Connecté" : "Hors ligne"}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-1" /> Quitter
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-4">
        {/* Scan result feedback */}
        {scanResult ? (
          <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-300">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
              scanResult.type === "clock_in" ? "bg-green-500" : "bg-red-500"
            }`}>
              {scanResult.type === "clock_in" ? (
                <LogIn className="w-10 h-10 text-white" />
              ) : (
                <LogOut className="w-10 h-10 text-white" />
              )}
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                {scanResult.type === "clock_in" ? "Entrée" : "Sortie"}
              </p>
              <p className="text-lg text-slate-300">{scanResult.staffName}</p>
              <p className="text-3xl font-mono mt-2">{scanResult.time}</p>
            </div>
            <Badge className="bg-primary/20 text-primary border-primary/30">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Pointage enregistré
            </Badge>
          </div>
        ) : scanError ? (
          <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
            <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
            <p className="text-xl font-semibold text-red-400">{scanError}</p>
          </div>
        ) : (
          <>
            {/* QR display */}
            <div className="text-center mb-2">
              <h2 className="text-2xl font-bold">Scannez votre QR employé</h2>
              <p className="text-sm text-slate-400 mt-1">
                Présentez le QR de votre application devant la caméra
              </p>
            </div>

            <div className="relative">
              {token && generating === false ? (
                <div className="w-72 h-72 bg-white rounded-2xl p-4 relative">
                  <QRCodeSVG token={token} size={280} />
                  {/* Countdown overlay */}
                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-primary text-white text-sm font-bold px-4 py-1 rounded-full shadow-lg flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {remaining}s
                  </div>
                </div>
              ) : (
                <div className="w-72 h-72 bg-slate-800 rounded-2xl flex items-center justify-center">
                  <Loader2 className="w-12 h-12 animate-spin text-primary" />
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-72 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-1000 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Test button (simulates camera scan) */}
            <Button
              variant="outline"
              onClick={simulateScan}
              disabled={!token || generating}
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              Simuler un scan (test)
            </Button>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700 text-center">
        <p className="text-xs text-slate-500">
          Borne de pointage — {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>
    </div>
  );
}

// QR SVG renderer (same as employee page)
function QRCodeSVG({ token, size }: { token: string; size: number }) {
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

  const corners = [[0, 0], [0, cells - 7], [cells - 7, 0]];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill="white" />
      {grid.map((row, r) =>
        row.map((on, c) => {
          for (const [cr, cc] of corners) {
            if (r >= cr && r < cr + 7 && c >= cc && c < cc + 7) return null;
          }
          return on ? (
            <rect key={`${r}-${c}`} x={c * cellSize} y={r * cellSize} width={cellSize} height={cellSize} fill="black" />
          ) : null;
        })
      )}
      {corners.map(([r, c], i) => (
        <g key={i}>
          <rect x={c * cellSize} y={r * cellSize} width={cellSize * 7} height={cellSize * 7} fill="black" />
          <rect x={(c + 1) * cellSize} y={(r + 1) * cellSize} width={cellSize * 5} height={cellSize * 5} fill="white" />
          <rect x={(c + 2) * cellSize} y={(r + 2) * cellSize} width={cellSize * 3} height={cellSize * 3} fill="black" />
        </g>
      ))}
    </svg>
  );
}
