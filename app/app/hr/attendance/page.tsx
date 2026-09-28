"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LoadingState } from "@/components/shared/loading-state";
import { EmptyState } from "@/components/shared/empty-state";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import { getStaffDisplayName, getStaffInitials } from "@/lib/hr/staff-utils";
import {
  Clock, LogIn, LogOut, Search, Loader as Loader2, Calendar,
  ArrowDownUp, MapPin, History, User,
} from "lucide-react";
import type { Database } from "@/lib/types/database";

type AttendanceEvent = Database["public"]["Tables"]["attendance_events"]["Row"] & {
  hr_staff: {
    id: string;
    staff_number: string;
    first_name: string | null;
    last_name: string | null;
    photo_url: string | null;
  };
};

type StaffMember = Database["public"]["Tables"]["hr_staff"]["Row"];

const METHOD_LABELS: Record<string, string> = {
  employee_qr: "QR Employé",
  terminal_qr: "QR Terminal",
  fingerprint: "Empreinte",
  manual: "Saisie manuelle",
};

const METHOD_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  employee_qr: "default",
  terminal_qr: "secondary",
  fingerprint: "secondary",
  manual: "outline",
};

export default function AttendancePage() {
  const { profile, permissions } = useAuth();
  const { toast } = useToast();

  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [methodFilter, setMethodFilter] = useState("all");

  // Manual entry form
  const [manualStaffId, setManualStaffId] = useState("");
  const [manualEventType, setManualEventType] = useState("clock_in");
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const canManage = permissions.includes("hr.create" as never);
  const canConfig = permissions.includes("attendance.manage" as never);

  const fetchData = useCallback(async () => {
    if (!profile?.institution_id) { setLoading(false); return; }
    setLoading(true);

    const dayStart = new Date(dateFilter + "T00:00:00");
    const dayEnd = new Date(dateFilter + "T23:59:59");

    const [eventsRes, staffRes] = await Promise.all([
      supabase
        .from("attendance_events")
        .select(`
          *,
          hr_staff!inner(id, staff_number, first_name, last_name, photo_url)
        `)
        .eq("institution_id", profile.institution_id)
        .gte("server_timestamp", dayStart.toISOString())
        .lte("server_timestamp", dayEnd.toISOString())
        .order("server_timestamp", { ascending: false }),
      supabase
        .from("hr_staff")
        .select("*")
        .eq("institution_id", profile.institution_id)
        .in("status", ["active", "on_leave"])
        .order("first_name", { ascending: true }),
    ]);

    if (eventsRes.data) setEvents(eventsRes.data as AttendanceEvent[]);
    if (staffRes.data) setStaffList(staffRes.data as StaffMember[]);
    setLoading(false);
  }, [profile?.institution_id, dateFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = events.filter((e) => {
    if (methodFilter !== "all" && e.method !== methodFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const name = getStaffDisplayName(e.hr_staff).toLowerCase();
      return name.includes(q) || e.hr_staff.staff_number.toLowerCase().includes(q);
    }
    return true;
  });

  // Group events by staff for summary
  const staffSummary = new Map<string, {
    staff: AttendanceEvent["hr_staff"];
    clockIn: AttendanceEvent | null;
    clockOut: AttendanceEvent | null;
    events: AttendanceEvent[];
  }>();

  filtered.forEach((e) => {
    const key = e.staff_id;
    if (!staffSummary.has(key)) {
      staffSummary.set(key, {
        staff: e.hr_staff,
        clockIn: null,
        clockOut: null,
        events: [],
      });
    }
    const entry = staffSummary.get(key)!;
    entry.events.push(e);
    if (e.event_type === "clock_in" && !entry.clockIn) entry.clockIn = e;
    if (e.event_type === "clock_out" && !entry.clockOut) entry.clockOut = e;
  });

  const handleManualEntry = async () => {
    if (!manualStaffId || !profile?.institution_id) return;
    setManualSubmitting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/attendance-clock`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            staff_id: manualStaffId,
            institution_id: profile.institution_id,
            method: "manual",
            event_type: manualEventType,
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erreur");

      toast({
        title: manualEventType === "clock_in" ? "Entrée enregistrée" : "Sortie enregistrée",
        description: `${getStaffDisplayName(staffList.find((s) => s.id === manualStaffId)!)} — ${new Date(data.event.server_timestamp).toLocaleTimeString("fr-FR")}`,
      });

      setManualStaffId("");
      fetchData();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setManualSubmitting(false);
    }
  };

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  if (loading) {
    return (
      <div>
        <PageHeader title="Pointage" description="Gestion des entrées et sorties du personnel" />
        <LoadingState />
      </div>
    );
  }

  const presentCount = Array.from(staffSummary.values()).filter((s) => s.clockIn && !s.clockOut).length;
  const totalEvents = filtered.length;

  return (
    <div>
      <PageHeader
        title="Pointage"
        description="Suivi des entrées et sorties du personnel"
      />

      <div className="space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <LogIn className="w-4 h-4 text-green-600" />
              <span className="text-sm text-muted-foreground">Présents</span>
            </div>
            <p className="text-2xl font-bold">{presentCount}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-muted-foreground">Événements</span>
            </div>
            <p className="text-2xl font-bold">{totalEvents}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Personnel actif</span>
            </div>
            <p className="text-2xl font-bold">{staffList.length}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-orange-600" />
              <span className="text-sm text-muted-foreground">Date</span>
            </div>
            <p className="text-lg font-semibold">{new Date(dateFilter).toLocaleDateString("fr-FR")}</p>
          </Card>
        </div>

        {/* Manual entry card */}
        {canManage && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <ArrowDownUp className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Saisie manuelle de pointage</h3>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <Label htmlFor="staff" className="sr-only">Employé</Label>
                <Select value={manualStaffId} onValueChange={setManualStaffId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un employé" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.staff_number} — {getStaffDisplayName(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-[160px]">
                <Select value={manualEventType} onValueChange={setManualEventType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clock_in">
                      <span className="flex items-center gap-2"><LogIn className="w-3.5 h-3.5 text-green-600" /> Entrée</span>
                    </SelectItem>
                    <SelectItem value="clock_out">
                      <span className="flex items-center gap-2"><LogOut className="w-3.5 h-3.5 text-red-600" /> Sortie</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleManualEntry}
                disabled={!manualStaffId || manualSubmitting}
                className="sm:w-auto"
              >
                {manualSubmitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enregistrement...</>
                ) : (
                  <><Clock className="w-4 h-4 mr-2" /> Pointer</>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par nom ou matricule..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full sm:w-[160px]"
            />
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Toutes les méthodes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les méthodes</SelectItem>
                <SelectItem value="employee_qr">QR Employé</SelectItem>
                <SelectItem value="terminal_qr">QR Terminal</SelectItem>
                <SelectItem value="fingerprint">Empreinte</SelectItem>
                <SelectItem value="manual">Saisie manuelle</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Events table */}
        <Card className="p-4">
          {filtered.length === 0 ? (
            <EmptyState
              title="Aucun pointage"
              message={`Aucun événement de pointage pour le ${new Date(dateFilter).toLocaleDateString("fr-FR")}.`}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employé</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Heure</TableHead>
                    <TableHead>Méthode</TableHead>
                    <TableHead>Localisation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={e.hr_staff.photo_url ?? undefined} />
                            <AvatarFallback className="text-xs bg-primary text-white">
                              {getStaffInitials(e.hr_staff)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{getStaffDisplayName(e.hr_staff)}</p>
                            <p className="text-xs text-muted-foreground">{e.hr_staff.staff_number}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {e.event_type === "clock_in" ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                            <LogIn className="w-3 h-3 mr-1" /> Entrée
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                            <LogOut className="w-3 h-3 mr-1" /> Sortie
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {formatTime(e.server_timestamp)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={METHOD_COLORS[e.method] ?? "outline"}>
                          {METHOD_LABELS[e.method] ?? e.method}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {e.latitude != null && e.longitude != null ? (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {Number(e.latitude).toFixed(4)}, {Number(e.longitude).toFixed(4)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Daily summary per staff */}
        {staffSummary.size > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <History className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Résumé par employé</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employé</TableHead>
                    <TableHead>Entrée</TableHead>
                    <TableHead>Sortie</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from(staffSummary.values()).map(({ staff, clockIn, clockOut }) => (
                    <TableRow key={staff.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="w-7 h-7">
                            <AvatarImage src={staff.photo_url ?? undefined} />
                            <AvatarFallback className="text-xs bg-primary text-white">
                              {getStaffInitials(staff)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{getStaffDisplayName(staff)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {clockIn ? formatTime(clockIn.server_timestamp) : "—"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {clockOut ? formatTime(clockOut.server_timestamp) : "—"}
                      </TableCell>
                      <TableCell>
                        {clockIn && !clockOut ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Présent</Badge>
                        ) : clockIn && clockOut ? (
                          <Badge variant="secondary">Terminé</Badge>
                        ) : (
                          <Badge variant="outline">Absent</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
