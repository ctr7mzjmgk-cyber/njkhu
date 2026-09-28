"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { LoadingState } from "@/components/shared/loading-state";
import { EmptyState } from "@/components/shared/empty-state";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import { getStaffDisplayName } from "@/lib/hr/staff-utils";
import { CalendarCheck, Plus, Loader as Loader2, Search, Save } from "lucide-react";
import type { Database } from "@/lib/types/database";

type Schedule = Database["public"]["Tables"]["attendance_schedules"]["Row"];
type StaffMember = Database["public"]["Tables"]["hr_staff"]["Row"];

const DAYS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
];

export default function SchedulesPage() {
  const { profile, permissions } = useAuth();
  const { toast } = useToast();

  const [schedules, setSchedules] = useState<(Schedule & { hr_staff: { id: string; staff_number: string; first_name: string | null; last_name: string | null } })[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [form, setForm] = useState({
    staff_id: "",
    day_of_week: "1",
    start_time: "08:00",
    end_time: "17:00",
    grace_minutes: "15",
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  const canManage = permissions.includes("attendance.manage" as never);

  const fetchData = useCallback(async () => {
    if (!profile?.institution_id) { setLoading(false); return; }
    setLoading(true);
    const [schedRes, staffRes] = await Promise.all([
      supabase
        .from("attendance_schedules")
        .select("*, hr_staff!inner(id, staff_number, first_name, last_name)")
        .eq("institution_id", profile.institution_id)
        .order("day_of_week", { ascending: true }),
      supabase
        .from("hr_staff")
        .select("*")
        .eq("institution_id", profile.institution_id)
        .in("status", ["active", "on_leave"])
        .order("first_name", { ascending: true }),
    ]);
    if (schedRes.data) setSchedules(schedRes.data as typeof schedules);
    if (staffRes.data) setStaffList(staffRes.data as StaffMember[]);
    setLoading(false);
  }, [profile?.institution_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = schedules.filter((s) => {
    if (staffFilter !== "all" && s.staff_id !== staffFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return getStaffDisplayName(s.hr_staff).toLowerCase().includes(q) || s.hr_staff.staff_number.toLowerCase().includes(q);
    }
    return true;
  });

  const openCreate = () => {
    setEditingSchedule(null);
    setForm({ staff_id: "", day_of_week: "1", start_time: "08:00", end_time: "17:00", grace_minutes: "15", is_active: true });
    setDialogOpen(true);
  };

  const openEdit = (s: Schedule) => {
    setEditingSchedule(s);
    setForm({
      staff_id: s.staff_id,
      day_of_week: s.day_of_week.toString(),
      start_time: s.start_time.slice(0, 5),
      end_time: s.end_time.slice(0, 5),
      grace_minutes: s.grace_minutes.toString(),
      is_active: s.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!profile?.institution_id || !form.staff_id) return;
    setSaving(true);
    try {
      const payload = {
        institution_id: profile.institution_id,
        staff_id: form.staff_id,
        day_of_week: parseInt(form.day_of_week, 10),
        start_time: form.start_time,
        end_time: form.end_time,
        grace_minutes: parseInt(form.grace_minutes, 10) || 15,
        is_active: form.is_active,
      };
      if (editingSchedule) {
        const { error } = await supabase.from("attendance_schedules").update(payload).eq("id", editingSchedule.id);
        if (error) throw error;
        toast({ title: "Horaire modifié" });
      } else {
        const { error } = await supabase.from("attendance_schedules").insert(payload);
        if (error) throw error;
        toast({ title: "Horaire créé" });
      }
      setDialogOpen(false);
      fetchData();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (s: Schedule) => {
    const { error } = await supabase.from("attendance_schedules").update({ is_active: !s.is_active }).eq("id", s.id);
    if (error) { toast({ title: "Erreur", variant: "destructive" }); return; }
    fetchData();
  };

  if (loading) return (<div><PageHeader title="Horaires" description="Horaires de travail et tolérance" /><LoadingState /></div>);

  return (
    <div>
      <PageHeader
        title="Horaires de travail"
        description="Définissez les horaires attendus et la tolérance par employé"
        action={canManage && <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Nouvel horaire</Button>}
      />

      <div className="space-y-6">
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="Tous les employés" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les employés</SelectItem>
                {staffList.map((s) => (<SelectItem key={s.id} value={s.id}>{s.staff_number} — {getStaffDisplayName(s)}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="Aucun horaire" message="Définissez les horaires de travail attendus pour vos employés." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employé</TableHead>
                    <TableHead>Jour</TableHead>
                    <TableHead>Début</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Tolérance</TableHead>
                    <TableHead>Statut</TableHead>
                    {canManage && <TableHead className="w-[60px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => canManage && openEdit(s)}>
                      <TableCell className="text-sm font-medium">{getStaffDisplayName(s.hr_staff)}</TableCell>
                      <TableCell>{DAYS.find((d) => d.value === s.day_of_week)?.label}</TableCell>
                      <TableCell className="font-mono text-sm">{s.start_time.slice(0, 5)}</TableCell>
                      <TableCell className="font-mono text-sm">{s.end_time.slice(0, 5)}</TableCell>
                      <TableCell><Badge variant="outline">{s.grace_minutes} min</Badge></TableCell>
                      <TableCell>{s.is_active ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Actif</Badge> : <Badge variant="secondary">Inactif</Badge>}</TableCell>
                      {canManage && (
                        <TableCell>
                          <Switch checked={s.is_active} onCheckedChange={() => handleToggle(s)} onClick={(e) => e.stopPropagation()} />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingSchedule ? "Modifier l'horaire" : "Nouvel horaire"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Employé</Label>
              <Select value={form.staff_id} onValueChange={(v) => setForm({ ...form, staff_id: v })} disabled={!!editingSchedule}>
                <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                <SelectContent>
                  {staffList.map((s) => (<SelectItem key={s.id} value={s.id}>{s.staff_number} — {getStaffDisplayName(s)}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Jour</Label>
              <Select value={form.day_of_week} onValueChange={(v) => setForm({ ...form, day_of_week: v })} disabled={!!editingSchedule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d) => (<SelectItem key={d.value} value={d.value.toString()}>{d.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start">Heure de début</Label>
                <Input id="start" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">Heure de fin</Label>
                <Input id="end" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="grace">Tolérance (minutes)</Label>
              <Input id="grace" type="number" min={0} value={form.grace_minutes} onChange={(e) => setForm({ ...form, grace_minutes: e.target.value })} />
              <p className="text-xs text-muted-foreground">Minutes de tolérance avant de marquer un retard</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            <Button onClick={handleSave} disabled={saving || !form.staff_id}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
