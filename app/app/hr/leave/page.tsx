"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { CalendarOff, Plus, Loader as Loader2, Check, X, Search } from "lucide-react";
import type { Database } from "@/lib/types/database";

type LeaveRequest = Database["public"]["Tables"]["attendance_leave_requests"]["Row"] & {
  hr_staff: { id: string; staff_number: string; first_name: string | null; last_name: string | null };
};

const LEAVE_TYPES: Record<string, string> = {
  vacation: "Congé payé",
  sick: "Maladie",
  personal: "Affaire personnelle",
  unpaid: "Congé sans solde",
  other: "Autre",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  approved: "Approuvé",
  rejected: "Refusé",
  cancelled: "Annulé",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 hover:bg-amber-100",
  approved: "bg-green-100 text-green-700 hover:bg-green-100",
  rejected: "bg-red-100 text-red-700 hover:bg-red-100",
  cancelled: "bg-slate-100 text-slate-600 hover:bg-slate-100",
};

export default function LeavePage() {
  const { profile, permissions, user } = useAuth();
  const { toast } = useToast();

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ staff_id: "", leave_type: "vacation", start_date: "", end_date: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [staffList, setStaffList] = useState<{ id: string; staff_number: string; first_name: string | null; last_name: string | null }[]>([]);

  const canCreate = permissions.includes("hr.create" as never);
  const canApprove = permissions.includes("hr.update" as never);

  const fetchData = useCallback(async () => {
    if (!profile?.institution_id) { setLoading(false); return; }
    setLoading(true);
    const [leaveRes, staffRes] = await Promise.all([
      supabase
        .from("attendance_leave_requests")
        .select("*, hr_staff!inner(id, staff_number, first_name, last_name)")
        .eq("institution_id", profile.institution_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("hr_staff")
        .select("id, staff_number, first_name, last_name")
        .eq("institution_id", profile.institution_id)
        .in("status", ["active", "on_leave"])
        .order("first_name", { ascending: true }),
    ]);
    if (leaveRes.data) setRequests(leaveRes.data as LeaveRequest[]);
    if (staffRes.data) setStaffList(staffRes.data as typeof staffList);
    setLoading(false);
  }, [profile?.institution_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = requests.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return getStaffDisplayName(r.hr_staff).toLowerCase().includes(q) || r.hr_staff.staff_number.toLowerCase().includes(q);
    }
    return true;
  });

  const handleSave = async () => {
    if (!profile?.institution_id || !form.staff_id || !form.start_date || !form.end_date) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("attendance_leave_requests").insert({
        institution_id: profile.institution_id,
        staff_id: form.staff_id,
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason || null,
        status: "pending",
      });
      if (error) throw error;
      toast({ title: "Demande de congé créée" });
      setDialogOpen(false);
      setForm({ staff_id: "", leave_type: "vacation", start_date: "", end_date: "", reason: "" });
      fetchData();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (r: LeaveRequest, approve: boolean) => {
    const { error } = await supabase
      .from("attendance_leave_requests")
      .update({
        status: approve ? "approved" : "rejected",
        approved_by: user?.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    if (error) { toast({ title: "Erreur", variant: "destructive" }); return; }
    toast({ title: approve ? "Congé approuvé" : "Congé refusé" });
    fetchData();
  };

  const handleCancel = async (r: LeaveRequest) => {
    const { error } = await supabase.from("attendance_leave_requests").update({ status: "cancelled" }).eq("id", r.id);
    if (error) { toast({ title: "Erreur", variant: "destructive" }); return; }
    toast({ title: "Demande annulée" });
    fetchData();
  };

  if (loading) return (<div><PageHeader title="Congés" description="Gestion des demandes de congés" /><LoadingState /></div>);

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div>
      <PageHeader
        title="Congés"
        description="Demandes et approbations de congés du personnel"
        action={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="w-4 h-4 mr-2" /> Nouvelle demande</Button>}
      />

      <div className="space-y-6">
        {pendingCount > 0 && (
          <Card className="p-4 border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-800">
              <strong>{pendingCount}</strong> demande(s) de congé en attente d'approbation.
            </p>
          </Card>
        )}

        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Tous les statuts" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="pending">En attente</SelectItem>
                <SelectItem value="approved">Approuvé</SelectItem>
                <SelectItem value="rejected">Refusé</SelectItem>
                <SelectItem value="cancelled">Annulé</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="Aucune demande" message="Aucune demande de congé pour le moment." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employé</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Début</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Motif</TableHead>
                    <TableHead>Statut</TableHead>
                    {canApprove && <TableHead className="w-[120px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-medium">{getStaffDisplayName(r.hr_staff)}</TableCell>
                      <TableCell><Badge variant="outline">{LEAVE_TYPES[r.leave_type] ?? r.leave_type}</Badge></TableCell>
                      <TableCell className="text-sm">{new Date(r.start_date).toLocaleDateString("fr-FR")}</TableCell>
                      <TableCell className="text-sm">{new Date(r.end_date).toLocaleDateString("fr-FR")}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.reason ?? "—"}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[r.status] ?? ""}>{STATUS_LABELS[r.status] ?? r.status}</Badge></TableCell>
                      {canApprove && (
                        <TableCell>
                          {r.status === "pending" ? (
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" onClick={() => handleApprove(r, true)} title="Approuver">
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleApprove(r, false)} title="Refuser">
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : r.status === "approved" && (
                            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => handleCancel(r)}>Annuler</Button>
                          )}
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
          <DialogHeader><DialogTitle>Nouvelle demande de congé</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Employé</Label>
              <Select value={form.staff_id} onValueChange={(v) => setForm({ ...form, staff_id: v })}>
                <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                <SelectContent>
                  {staffList.map((s) => (<SelectItem key={s.id} value={s.id}>{s.staff_number} — {getStaffDisplayName(s)}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type de congé</Label>
              <Select value={form.leave_type} onValueChange={(v) => setForm({ ...form, leave_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vacation">Congé payé</SelectItem>
                  <SelectItem value="sick">Maladie</SelectItem>
                  <SelectItem value="personal">Affaire personnelle</SelectItem>
                  <SelectItem value="unpaid">Congé sans solde</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start">Date de début</Label>
                <Input id="start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">Date de fin</Label>
                <Input id="end" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Motif (optionnel)</Label>
              <Input id="reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Motif de la demande..." />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Annuler</Button></DialogClose>
            <Button onClick={handleSave} disabled={saving || !form.staff_id || !form.start_date || !form.end_date}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarOff className="w-4 h-4 mr-2" />}
              Créer la demande
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
