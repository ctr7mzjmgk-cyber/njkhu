"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { LoadingState } from "@/components/shared/loading-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import { getStaffDisplayName } from "@/lib/hr/staff-utils";
import {
  UsersRound, Building2, Briefcase, UserCheck, LogIn, LogOut,
  CalendarOff, Clock, ArrowRight,
} from "lucide-react";
import Link from "next/link";

export default function HRDashboardPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    staff: 0,
    departments: 0,
    positions: 0,
    activeAssignments: 0,
  });
  const [attendanceStats, setAttendanceStats] = useState({
    presentToday: 0,
    lateToday: 0,
    onLeaveToday: 0,
    pendingLeaveRequests: 0,
  });
  const [recentStaff, setRecentStaff] = useState<
    { id: string; staff_number: string; hire_date: string; status: string; first_name: string | null; last_name: string | null }[]
  >([]);
  const [todayEvents, setTodayEvents] = useState<
    { id: string; event_type: string; server_timestamp: string; staff_id: string; method: string }[]
  >([]);

  const fetchDashboard = useCallback(async () => {
    if (!profile?.institution_id) { setLoading(false); return; }
    setLoading(true);
    try {
      const instId = profile.institution_id;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      const todayStr = new Date().toISOString().split("T")[0];

      const [
        { count: staffCount },
        { count: deptCount }
      ] = await Promise.all([
        supabase.from("hr_staff").select("*", { count: "exact", head: true }).eq("institution_id", instId),
        supabase.from("hr_departments").select("*", { count: "exact", head: true }).eq("institution_id", instId),
      ]);

      const { count: posCount } = await supabase
        .from("hr_positions").select("*", { count: "exact", head: true }).eq("institution_id", instId);
      const { count: assignCount } = await supabase
        .from("hr_assignments").select("*", { count: "exact", head: true }).is("end_date", null);

      const { data: recent } = await supabase
        .from("hr_staff")
        .select("id, staff_number, hire_date, status, first_name, last_name")
        .eq("institution_id", instId)
        .order("created_at", { ascending: false })
        .limit(5);

      // Today's attendance events
      const { data: todayEvts } = await supabase
        .from("attendance_events")
        .select("id, event_type, server_timestamp, staff_id, method")
        .eq("institution_id", instId)
        .gte("server_timestamp", todayStart.toISOString())
        .lte("server_timestamp", todayEnd.toISOString())
        .order("server_timestamp", { ascending: false });

      // Active staff for present count
      const { data: activeStaff } = await supabase
        .from("hr_staff")
        .select("id")
        .eq("institution_id", instId)
        .eq("status", "active");

      const activeStaffIds = (activeStaff ?? []).map((s) => s.id);

      // Approved leaves for today
      const { data: todayLeaves } = await supabase
        .from("attendance_leave_requests")
        .select("staff_id")
        .eq("institution_id", instId)
        .eq("status", "approved")
        .lte("start_date", todayStr)
        .gte("end_date", todayStr);

      const onLeaveIds = new Set((todayLeaves ?? []).map((l) => l.staff_id));
      const clockInIds = new Set((todayEvts ?? []).filter((e) => e.event_type === "clock_in").map((e) => e.staff_id));
      const presentCount = activeStaffIds.filter((id) => clockInIds.has(id) && !onLeaveIds.has(id)).length;

      // Pending leave requests
      const { count: pendingLeaves } = await supabase
        .from("attendance_leave_requests")
        .select("*", { count: "exact", head: true })
        .eq("institution_id", instId)
        .eq("status", "pending");

      setStats({
        staff: staffCount ?? 0,
        departments: deptCount ?? 0,
        positions: posCount ?? 0,
        activeAssignments: assignCount ?? 0,
      });
      setAttendanceStats({
        presentToday: presentCount,
        lateToday: 0,
        onLeaveToday: onLeaveIds.size,
        pendingLeaveRequests: pendingLeaves ?? 0,
      });
      setRecentStaff(
        (recent as { id: string; staff_number: string; hire_date: string; status: string; first_name: string | null; last_name: string | null }[]) ?? [],
      );
      setTodayEvents((todayEvts as { id: string; event_type: string; server_timestamp: string; staff_id: string; method: string }[]) ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Ressources Humaines" description="Vue d'ensemble du personnel" />
        <LoadingState />
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    active: "Actif",
    on_leave: "En congé",
    terminated: "Licencié",
    retired: "Retraité",
  };

  return (
    <div>
      <PageHeader
        title="Ressources Humaines"
        description="Vue d'ensemble du personnel administratif et support"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Personnel" value={stats.staff} icon={UsersRound} />
        <StatCard label="Directions & Services" value={stats.departments} icon={Building2} />
        <StatCard label="Postes & Fonctions" value={stats.positions} icon={Briefcase} />
        <StatCard label="Affectations actives" value={stats.activeAssignments} icon={UserCheck} />
      </div>

      {/* Attendance section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <LogIn className="w-4 h-4 text-green-600" />
              <span className="text-sm font-semibold">Présents aujourd'hui</span>
            </div>
            <Link href="/app/hr/attendance"><Button variant="ghost" size="sm" className="text-xs">Détails <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
          </div>
          <p className="text-3xl font-bold text-green-600">{attendanceStats.presentToday}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CalendarOff className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-semibold">En congé aujourd'hui</span>
            </div>
            <Link href="/app/hr/leave"><Button variant="ghost" size="sm" className="text-xs">Détails <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
          </div>
          <p className="text-3xl font-bold text-purple-600">{attendanceStats.onLeaveToday}</p>
          {attendanceStats.pendingLeaveRequests > 0 && (
            <p className="text-xs text-amber-600 mt-1">{attendanceStats.pendingLeaveRequests} demande(s) en attente</p>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold">Pointages du jour</span>
            </div>
            <Link href="/app/hr/calendar"><Button variant="ghost" size="sm" className="text-xs">Calendrier <ArrowRight className="w-3 h-3 ml-1" /></Button></Link>
          </div>
          <p className="text-3xl font-bold text-blue-600">{todayEvents.length}</p>
        </Card>
      </div>

      {/* Recent clock events log */}
      {todayEvents.length > 0 && (
        <Card className="p-4 mb-6">
          <h2 className="text-sm font-semibold text-foreground mb-3">Pointages récents du jour</h2>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {todayEvents.slice(0, 10).map((e) => {
              const s = recentStaff.find((st) => st.id === e.staff_id);
              return (
                <div key={e.id} className="flex items-center justify-between rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    {e.event_type === "clock_in" ? (
                      <LogIn className="w-3.5 h-3.5 text-green-600" />
                    ) : (
                      <LogOut className="w-3.5 h-3.5 text-red-500" />
                    )}
                    <span className="text-sm font-medium">
                      {s ? getStaffDisplayName({ first_name: s.first_name, last_name: s.last_name, staff_number: s.staff_number }) : "Employé"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{e.method}</Badge>
                    <span className="text-xs font-mono text-muted-foreground">
                      {new Date(e.server_timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Personnel récent</h2>
        {recentStaff.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucun membre du personnel enregistré pour le moment.
          </p>
        ) : (
          <div className="space-y-2">
            {recentStaff.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{s.staff_number}</span>
                  <span className="text-sm text-muted-foreground">{getStaffDisplayName({ first_name: s.first_name, last_name: s.last_name, staff_number: s.staff_number })}</span>
                  <Badge variant={s.status === "active" ? "default" : "secondary"}>
                    {statusLabels[s.status] ?? s.status}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Embauché le {new Date(s.hire_date).toLocaleDateString("fr-FR")}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
