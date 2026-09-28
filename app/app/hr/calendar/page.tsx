"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LoadingState } from "@/components/shared/loading-state";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import { getStaffDisplayName } from "@/lib/hr/staff-utils";
import { ChevronLeft, ChevronRight, LogIn, LogOut, CalendarOff, Clock } from "lucide-react";
import type { Database } from "@/lib/types/database";

type StaffMember = Database["public"]["Tables"]["hr_staff"]["Row"];
type AttendanceEvent = Database["public"]["Tables"]["attendance_events"]["Row"];
type LeaveRequest = Database["public"]["Tables"]["attendance_leave_requests"]["Row"];
type Schedule = Database["public"]["Tables"]["attendance_schedules"]["Row"];

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const DAY_NAMES = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function CalendarPage() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [staffFilter, setStaffFilter] = useState("all");
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedDate, setSelectedDate] = useState<{ date: Date; events: AttendanceEvent[]; leaves: LeaveRequest[] } | null>(null);

  const fetchData = useCallback(async () => {
    if (!profile?.institution_id) { setLoading(false); return; }
    setLoading(true);

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const startDate = new Date(year, month, 1).toISOString();
    const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    const [staffRes, eventsRes, leaveRes, schedRes] = await Promise.all([
      supabase.from("hr_staff").select("*").eq("institution_id", profile.institution_id).in("status", ["active", "on_leave"]).order("first_name"),
      supabase.from("attendance_events").select("*").eq("institution_id", profile.institution_id).gte("server_timestamp", startDate).lte("server_timestamp", endDate).order("server_timestamp"),
      supabase.from("attendance_leave_requests").select("*").eq("institution_id", profile.institution_id).eq("status", "approved").lte("start_date", endDate.slice(0, 10)).gte("end_date", startDate.slice(0, 10)),
      supabase.from("attendance_schedules").select("*").eq("institution_id", profile.institution_id).eq("is_active", true),
    ]);

    if (staffRes.data) setStaffList(staffRes.data as StaffMember[]);
    if (eventsRes.data) setEvents(eventsRes.data as AttendanceEvent[]);
    if (leaveRes.data) setLeaves(leaveRes.data as LeaveRequest[]);
    if (schedRes.data) setSchedules(schedRes.data as Schedule[]);
    setLoading(false);
  }, [profile?.institution_id, currentMonth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredEvents = events.filter((e) => staffFilter === "all" || e.staff_id === staffFilter);
  const filteredLeaves = leaves.filter((l) => staffFilter === "all" || l.staff_id === staffFilter);

  // Build calendar data
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  const days: (Date | null)[] = [];
  for (let i = 0; i < startDayOfWeek; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);

  const getDayEvents = (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    return filteredEvents.filter((e) => e.server_timestamp.startsWith(dateStr));
  };

  const getDayLeaves = (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    return filteredLeaves.filter((l) => l.start_date <= dateStr && l.end_date >= dateStr);
  };

  const getDaySchedule = (date: Date) => {
    const dow = date.getDay();
    return schedules.filter((s) => s.day_of_week === dow);
  };

  const isExpected = (date: Date) => {
    return getDaySchedule(date).length > 0;
  };

  const hasClockIn = (date: Date) => getDayEvents(date).some((e) => e.event_type === "clock_in");

  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const goToday = () => { setCurrentMonth(new Date()); setSelectedDate(null); };

  const handleDayClick = (date: Date) => {
    setSelectedDate({ date, events: getDayEvents(date), leaves: getDayLeaves(date) });
  };

  if (loading) return (<div><PageHeader title="Calendrier" description="Vue calendrier des présences et congés" /><LoadingState /></div>);

  return (
    <div>
      <PageHeader title="Calendrier de pointage" description="Présences, absences et congés du personnel" />

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-lg font-semibold min-w-[180px] text-center">{MONTH_NAMES[month]} {year}</span>
            <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" onClick={goToday} className="ml-2">Aujourd'hui</Button>
          </div>
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-full sm:w-[240px]"><SelectValue placeholder="Tous les employés" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les employés</SelectItem>
              {staffList.map((s) => (<SelectItem key={s.id} value={s.id}>{s.staff_number} — {getStaffDisplayName(s)}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar grid */}
          <Card className="p-4 lg:col-span-2">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {DAY_NAMES.map((d) => (<div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((date, i) => {
                if (!date) return <div key={i} className="aspect-square" />;
                const dayEvents = getDayEvents(date);
                const dayLeaves = getDayLeaves(date);
                const expected = isExpected(date);
                const hasIn = dayEvents.some((e) => e.event_type === "clock_in");
                const hasOut = dayEvents.some((e) => e.event_type === "clock_out");
                const isToday = date.toDateString() === new Date().toDateString();
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                return (
                  <button
                    key={i}
                    onClick={() => handleDayClick(date)}
                    className={`aspect-square rounded-lg border text-sm p-1 flex flex-col items-center justify-start transition-colors relative
                      ${isToday ? "border-primary border-2" : "border-slate-100 hover:border-primary/40"}
                      ${dayLeaves.length > 0 ? "bg-purple-50" : hasIn ? "bg-green-50" : expected && !isWeekend ? "bg-red-50" : "bg-white"}
                    `}
                  >
                    <span className={`text-xs ${isToday ? "font-bold text-primary" : "text-slate-700"}`}>{date.getDate()}</span>
                    {dayLeaves.length > 0 && <CalendarOff className="w-3 h-3 text-purple-500 mt-0.5" />}
                    {hasIn && <LogIn className="w-3 h-3 text-green-500 mt-0.5" />}
                    {hasOut && <LogOut className="w-3 h-3 text-red-400 mt-0.5" />}
                    {dayEvents.length > 0 && <span className="text-[10px] text-muted-foreground mt-0.5">{dayEvents.length}</span>}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-slate-100">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className="w-3 h-3 rounded bg-green-50 border border-slate-200" /> Présent</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className="w-3 h-3 rounded bg-red-50 border border-slate-200" /> Absent (jour attendu)</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className="w-3 h-3 rounded bg-purple-50 border border-slate-200" /> En congé</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className="w-3 h-3 rounded bg-white border border-slate-200" /> Pas d'horaire</span>
            </div>
          </Card>

          {/* Day detail panel */}
          <Card className="p-4">
            {selectedDate ? (
              <>
                <h3 className="text-sm font-semibold mb-3">
                  {selectedDate.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                </h3>

                {selectedDate.leaves.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Congés</p>
                    <div className="space-y-1">
                      {selectedDate.leaves.map((l) => {
                        const s = staffList.find((st) => st.id === l.staff_id);
                        return (
                          <div key={l.id} className="flex items-center gap-2 text-sm">
                            <CalendarOff className="w-3.5 h-3.5 text-purple-500" />
                            <span>{s ? getStaffDisplayName(s) : "Employé"}</span>
                            <Badge variant="outline" className="text-xs">Congé</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedDate.events.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Pointages ({selectedDate.events.length})</p>
                    <div className="space-y-2">
                      {selectedDate.events.map((e) => {
                        const s = staffList.find((st) => st.id === e.staff_id);
                        return (
                          <div key={e.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-2">
                            <div className="flex items-center gap-2">
                              {e.event_type === "clock_in" ? <LogIn className="w-3.5 h-3.5 text-green-600" /> : <LogOut className="w-3.5 h-3.5 text-red-500" />}
                              <span className="text-sm">{s ? getStaffDisplayName(s) : "Employé"}</span>
                            </div>
                            <span className="text-xs font-mono text-muted-foreground">{formatTime(e.server_timestamp)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : selectedDate.leaves.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Aucun événement ce jour.</p>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Sélectionnez un jour pour voir les détails</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
