"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { getStaffDisplayName } from "@/lib/hr/staff-utils";
import {
  LogIn, LogOut, Clock, Calendar, Users, TrendingUp, Search,
  CheckCircle2, XCircle, AlertCircle,
} from "lucide-react";
import type { Database } from "@/lib/types/database";

type StaffMember = Database["public"]["Tables"]["hr_staff"]["Row"];
type AttendanceEvent = Database["public"]["Tables"]["attendance_events"]["Row"];
type Schedule = Database["public"]["Tables"]["attendance_schedules"]["Row"];
type LeaveRequest = Database["public"]["Tables"]["attendance_leave_requests"]["Row"];

interface StaffDaySummary {
  staffId: string;
  staff: StaffMember;
  clockIn: AttendanceEvent | null;
  clockOut: AttendanceEvent | null;
  schedule: Schedule | null;
  isLate: boolean;
  isAbsent: boolean;
  isOnLeave: boolean;
  workMinutes: number | null;
}

export default function ReportsPage() {
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);
  const [search, setSearch] = useState("");
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [corrections, setCorrections] = useState<{ id: string; staff_id: string; reason: string; correction_type: string; created_at: string }[]>([]);

  const fetchData = useCallback(async () => {
    if (!profile?.institution_id) { setLoading(false); return; }
    setLoading(true);
    const dayStart = new Date(dateFilter + "T00:00:00").toISOString();
    const dayEnd = new Date(dateFilter + "T23:59:59").toISOString();
    const dateStr = dateFilter;

    const [staffRes, eventsRes, schedRes, leaveRes, corrRes] = await Promise.all([
      supabase.from("hr_staff").select("*").eq("institution_id", profile.institution_id).in("status", ["active", "on_leave"]).order("first_name"),
      supabase.from("attendance_events").select("*").eq("institution_id", profile.institution_id).gte("server_timestamp", dayStart).lte("server_timestamp", dayEnd).order("server_timestamp"),
      supabase.from("attendance_schedules").select("*").eq("institution_id", profile.institution_id).eq("is_active", true),
      supabase.from("attendance_leave_requests").select("*").eq("institution_id", profile.institution_id).eq("status", "approved").lte("start_date", dateStr).gte("end_date", dateStr),
      supabase.from("attendance_corrections").select("id, staff_id, reason, correction_type, created_at").eq("institution_id", profile.institution_id).order("created_at", { ascending: false }).limit(10),
    ]);

    if (staffRes.data) setStaffList(staffRes.data as StaffMember[]);
    if (eventsRes.data) setEvents(eventsRes.data as AttendanceEvent[]);
    if (schedRes.data) setSchedules(schedRes.data as Schedule[]);
    if (leaveRes.data) setLeaves(leaveRes.data as LeaveRequest[]);
    if (corrRes.data) setCorrections(corrRes.data as typeof corrections);
    setLoading(false);
  }, [profile?.institution_id, dateFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build per-staff summary for the selected day
  const targetDate = new Date(dateFilter);
  const dow = targetDate.getDay();

  const summaries: StaffDaySummary[] = staffList.map((staff) => {
    const staffEvents = events.filter((e) => e.staff_id === staff.id);
    const clockIn = staffEvents.find((e) => e.event_type === "clock_in") ?? null;
    const clockOut = staffEvents.filter((e) => e.event_type === "clock_out").pop() ?? null;
    const schedule = schedules.find((s) => s.staff_id === staff.id && s.day_of_week === dow) ?? null;
    const isOnLeave = leaves.some((l) => l.staff_id === staff.id);

    let isLate = false;
    if (clockIn && schedule) {
      const expectedTime = new Date(dateFilter + "T" + schedule.start_time);
      const actualTime = new Date(clockIn.server_timestamp);
      const diffMin = (actualTime.getTime() - expectedTime.getTime()) / 60000;
      isLate = diffMin > schedule.grace_minutes;
    }

    let workMinutes: number | null = null;
    if (clockIn && clockOut) {
      workMinutes = Math.round((new Date(clockOut.server_timestamp).getTime() - new Date(clockIn.server_timestamp).getTime()) / 60000);
    }

    const isAbsent = !clockIn && !isOnLeave && !!schedule;

    return { staffId: staff.id, staff, clockIn, clockOut, schedule, isLate, isAbsent, isOnLeave, workMinutes };
  });

  const filtered = summaries.filter((s) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return getStaffDisplayName(s.staff).toLowerCase().includes(q) || s.staff.staff_number.toLowerCase().includes(q);
    }
    return true;
  });

  // Stats
  const presentCount = summaries.filter((s) => s.clockIn).length;
  const lateCount = summaries.filter((s) => s.isLate).length;
  const absentCount = summaries.filter((s) => s.isAbsent).length;
  const onLeaveCount = summaries.filter((s) => s.isOnLeave).length;

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const formatDuration = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h${m.toString().padStart(2, "0")}`;
  };

  if (loading) return (<div><PageHeader title="Rapports" description="Tableaux de bord de pointage" /><LoadingState /></div>);

  return (
    <div>
      <PageHeader title="Rapports de pointage" description="Statistiques de présences, retards et absences" />

      <div className="space-y-6">
        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full sm:w-[180px]" />
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Rechercher un employé..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
        </Card>

        {/* Stats cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Présents" value={presentCount} icon={CheckCircle2} />
          <StatCard label="En retard" value={lateCount} icon={AlertCircle} />
          <StatCard label="Absents" value={absentCount} icon={XCircle} />
          <StatCard label="En congé" value={onLeaveCount} icon={Calendar} />
        </div>

        {/* Daily summary table */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">
            Résumé du {new Date(dateFilter).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </h3>
          {filtered.length === 0 ? (
            <EmptyState title="Aucune donnée" message="Aucun employé actif pour cette date." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employé</TableHead>
                    <TableHead>Horaire attendu</TableHead>
                    <TableHead>Entrée</TableHead>
                    <TableHead>Sortie</TableHead>
                    <TableHead>Temps travaillé</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(({ staff, clockIn, clockOut, schedule, isLate, isAbsent, isOnLeave, workMinutes }) => (
                    <TableRow key={staff.id}>
                      <TableCell className="text-sm font-medium">{getStaffDisplayName(staff)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {schedule ? `${schedule.start_time.slice(0, 5)} - ${schedule.end_time.slice(0, 5)}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {clockIn ? (
                          <span className={isLate ? "text-amber-600 font-semibold" : "text-green-600"}>{formatTime(clockIn.server_timestamp)}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {clockOut ? formatTime(clockOut.server_timestamp) : "—"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {workMinutes != null ? formatDuration(workMinutes) : "—"}
                      </TableCell>
                      <TableCell>
                        {isOnLeave ? (
                          <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">Congé</Badge>
                        ) : isAbsent ? (
                          <Badge variant="destructive">Absent</Badge>
                        ) : isLate ? (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Retard</Badge>
                        ) : clockIn ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Présent</Badge>
                        ) : (
                          <Badge variant="outline">Non prévu</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Recent corrections */}
        {corrections.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Corrections récentes</h3>
            </div>
            <div className="space-y-2">
              {corrections.map((c) => {
                const s = staffList.find((st) => st.id === c.staff_id);
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                    <div>
                      <p className="text-sm font-medium">{s ? getStaffDisplayName(s) : "Employé"}</p>
                      <p className="text-xs text-muted-foreground">{c.reason}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{c.correction_type}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString("fr-FR")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
