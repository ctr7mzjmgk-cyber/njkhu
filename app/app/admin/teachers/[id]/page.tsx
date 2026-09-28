"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { TeacherStatusBadge, TEACHER_STATUS_OPTIONS } from "@/components/shared/status-badge";
import { TeacherFormDialog } from "@/components/teachers/teacher-form-dialog";
import { TeacherAssignmentDialog } from "@/components/teachers/teacher-assignment-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { ArrowLeft, Pencil, Plus, MoveHorizontal as MoreHorizontal, Trash2, User, Mail, Phone, Calendar, MapPin, Globe, Heart, ShieldAlert, Users } from "lucide-react";

type Teacher = Database["public"]["Tables"]["teachers"]["Row"];
type TeacherAssignment = Database["public"]["Tables"]["teacher_assignments"]["Row"];
type AssignmentWithRelations = TeacherAssignment & {
  subjects?: { name: string; code: string };
  classes?: { name: string };
};

const CIVILITY_LABELS: Record<string, string> = { M: "M.", Mme: "Mme", Mlle: "Mlle", Dr: "Dr", Pr: "Pr" };
const GENDER_LABELS: Record<string, string> = { M: "Masculin", F: "Féminin" };
const MARITAL_LABELS: Record<string, string> = { celibataire: "Célibataire", marie: "Marié(e)", divorce: "Divorcé(e)", veuf: "Veuf/Veuve" };

export default function TeacherDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions, profile } = useAuth();
  const { toast } = useToast();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [assignments, setAssignments] = useState<AssignmentWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [deletingAssignment, setDeletingAssignment] = useState<TeacherAssignment | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canUpdate = permissions.includes("teachers.update" as never);

  const fetchTeacher = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.from("teachers").select("*").eq("id", id).maybeSingle();
    if (error || !data) { setTeacher(null); return; }
    setTeacher(data);
  }, [id]);

  const fetchAssignments = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from("teacher_assignments")
      .select("*, subjects(name, code), classes(name)")
      .eq("teacher_id", id)
      .order("created_at", { ascending: false });
    if (error) return;
    setAssignments(data ?? []);
  }, [id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchTeacher(), fetchAssignments()]);
      setLoading(false);
    })();
  }, [fetchTeacher, fetchAssignments]);

  const handleStatusChange = async (newStatus: string) => {
    if (!teacher) return;
    try {
      const { error: updateError } = await supabase.from("teachers").update({ status: newStatus }).eq("id", teacher.id);
      if (updateError) throw updateError;
      setTeacher({ ...teacher, status: newStatus as Teacher["status"] });
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    }
  };

  const handleDeleteAssignment = async () => {
    if (!deletingAssignment) return;
    setDeleteLoading(true);
    try {
      const { error } = await supabase.from("teacher_assignments").delete().eq("id", deletingAssignment.id);
      if (error) throw error;
      toast({ title: "Affectation supprimée" });
      setDeletingAssignment(null);
      fetchAssignments();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return <div><Button variant="ghost" size="sm" onClick={() => router.push("/app/admin/teachers")} className="mb-4"><ArrowLeft className="w-4 h-4 mr-2" /> Retour</Button><LoadingState /></div>;
  }
  if (!teacher) {
    return <div><Button variant="ghost" size="sm" onClick={() => router.push("/app/admin/teachers")} className="mb-4"><ArrowLeft className="w-4 h-4 mr-2" /> Retour</Button><EmptyState title="Formateur introuvable" /></div>;
  }

  const displayName = teacher.last_name || teacher.first_name ? `${teacher.last_name ?? ""} ${teacher.first_name ?? ""}`.trim() : teacher.teacher_number;
  const initials = (teacher.first_name?.[0] ?? "") + (teacher.last_name?.[0] ?? "");
  const fullNameForDisplay = [teacher.civility ? CIVILITY_LABELS[teacher.civility] ?? teacher.civility : null, teacher.last_name, teacher.first_name].filter(Boolean).join(" ");

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => router.push("/app/admin/teachers")} className="mb-4"><ArrowLeft className="w-4 h-4 mr-2" /> Retour à la liste</Button>

      <PageHeader title={displayName} description={`Matricule : ${teacher.teacher_number}`} action={canUpdate && (
        <Button variant="outline" onClick={() => setFormOpen(true)}><Pencil className="w-4 h-4 mr-2" /> Modifier</Button>
      )} />

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <Avatar className="w-16 h-16"><AvatarFallback className="bg-primary text-white text-lg">{initials.toUpperCase() || "?"}</AvatarFallback></Avatar>
        <div className="flex items-center gap-3 flex-wrap">
          {teacher.profile_id ? (
            <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-600"><ShieldAlert className="w-3 h-3" /> Compte portail actif</Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground"><ShieldAlert className="w-3 h-3" /> Aucun compte portail</Badge>
          )}
          <TeacherStatusBadge status={teacher.status} />
          {canUpdate && (
            <Select value={teacher.status} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TEACHER_STATUS_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
              </SelectContent>
            </Select>
          )}
          {teacher.email && <Badge variant="outline" className="gap-1"><Mail className="w-3 h-3" /> {teacher.email}</Badge>}
        </div>
      </div>

      <Tabs defaultValue="identity">
        <TabsList className="flex-wrap">
          <TabsTrigger value="identity"><User className="w-4 h-4 mr-2" /> Identité</TabsTrigger>
          <TabsTrigger value="contact"><Phone className="w-4 h-4 mr-2" /> Coordonnées</TabsTrigger>
          <TabsTrigger value="complementary"><Globe className="w-4 h-4 mr-2" /> Info complémentaires</TabsTrigger>
          <TabsTrigger value="assignments"><Users className="w-4 h-4 mr-2" /> Affectations</TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-foreground mb-4">Identité</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <InfoRow icon={User} label="Matricule" value={teacher.teacher_number} />
              <InfoRow icon={User} label="Civilité" value={teacher.civility ? CIVILITY_LABELS[teacher.civility] ?? teacher.civility : "—"} />
              <InfoRow icon={User} label="Nom complet" value={fullNameForDisplay || "—"} />
              <InfoRow icon={User} label="Nom" value={teacher.last_name ?? "—"} />
              <InfoRow icon={User} label="Prénom(s)" value={teacher.first_name ?? "—"} />
              <InfoRow icon={Calendar} label="Date de naissance" value={teacher.birth_date ? new Date(teacher.birth_date).toLocaleDateString("fr-FR") : "—"} />
              <InfoRow icon={MapPin} label="Lieu de naissance" value={teacher.birth_place ?? "—"} />
              <InfoRow icon={Users} label="Sexe" value={teacher.gender ? GENDER_LABELS[teacher.gender] ?? teacher.gender : "—"} />
              <InfoRow icon={User} label="Spécialisation" value={teacher.specialization ?? "—"} />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="contact">
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-foreground mb-4">Coordonnées</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <InfoRow icon={Mail} label="Email" value={teacher.email ?? "—"} />
              <InfoRow icon={Phone} label="Téléphone" value={teacher.phone ?? "—"} />
              <InfoRow icon={MapPin} label="Adresse" value={teacher.address ?? "—"} />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="complementary">
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-foreground mb-4">Informations complémentaires</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <InfoRow icon={Globe} label="Nationalité" value={teacher.nationality ?? "—"} />
              <InfoRow icon={Heart} label="Situation matrimoniale" value={teacher.marital_status ? MARITAL_LABELS[teacher.marital_status] ?? teacher.marital_status : "—"} />
            </div>
            <div className="border-t mt-6 pt-6">
              <h4 className="text-sm font-semibold text-foreground mb-4">Contact d'urgence</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <InfoRow icon={User} label="Nom du contact" value={teacher.emergency_contact_name ?? "—"} />
                <InfoRow icon={Phone} label="Téléphone" value={teacher.emergency_contact_phone ?? "—"} />
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="assignments">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Affectations (Matière + Classe)</h3>
              {canUpdate && <Button size="sm" onClick={() => setAssignmentOpen(true)}><Plus className="w-4 h-4 mr-2" /> Nouvelle affectation</Button>}
            </div>
            {assignments.length === 0 ? (
              <EmptyState title="Aucune affectation" message="Affectez ce formateur à des matières et classes pour lui permettre de créer des évaluations et saisir des notes." action={canUpdate && <Button size="sm" onClick={() => setAssignmentOpen(true)}><Plus className="w-4 h-4 mr-2" /> Ajouter</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Matière</TableHead><TableHead>Classe</TableHead><TableHead className="w-[50px]" /></TableRow></TableHeader>
                  <TableBody>
                    {assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.subjects?.name ?? "—"}{a.subjects?.code && <span className="text-xs text-muted-foreground ml-1">({a.subjects.code})</span>}</TableCell>
                        <TableCell className="text-muted-foreground">{a.classes?.name ?? "—"}</TableCell>
                        <TableCell>
                          {canUpdate && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem className="text-destructive" onClick={() => setDeletingAssignment(a)}><Trash2 className="w-4 h-4 mr-2" /> Supprimer</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <TeacherFormDialog open={formOpen} onOpenChange={setFormOpen} teacher={teacher} onSaved={fetchTeacher} />
      {canUpdate && <TeacherAssignmentDialog open={assignmentOpen} onOpenChange={setAssignmentOpen} teacherId={teacher.id} institutionId={profile?.institution_id ?? ""} onSaved={fetchAssignments} />}

      <AlertDialog open={!!deletingAssignment} onOpenChange={(o) => !o && setDeletingAssignment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette affectation ?</AlertDialogTitle>
            <AlertDialogDescription>Le formateur ne pourra plus créer d'évaluations ni saisir de notes pour cette matière et cette classe.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAssignment} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-muted-foreground" /></div>
      <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-medium text-foreground mt-0.5">{value}</p></div>
    </div>
  );
}
