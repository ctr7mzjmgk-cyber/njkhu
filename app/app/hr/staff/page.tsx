"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { Plus, Search, MoveHorizontal as MoreHorizontal, Pencil, Trash2, Upload, Loader as Loader2, Lock } from "lucide-react";
import { getStaffDisplayName, getStaffInitials } from "@/lib/hr/staff-utils";

type Staff = Database["public"]["Tables"]["hr_staff"]["Row"];

const STATUS_OPTIONS = [
  { value: "active", label: "Actif" },
  { value: "on_leave", label: "En congé" },
  { value: "terminated", label: "Licencié" },
  { value: "retired", label: "Retraité" },
];

const EMPLOYMENT_TYPES = [
  { value: "cdi", label: "CDI" },
  { value: "cdd", label: "CDD" },
  { value: "internship", label: "Stage" },
  { value: "consultant", label: "Consultant" },
];

const CIVILITY_OPTIONS = [
  { value: "M.", label: "M." },
  { value: "Mme", label: "Mme" },
  { value: "Mlle", label: "Mlle" },
  { value: "Dr", label: "Dr" },
  { value: "Pr", label: "Pr" },
];

const GENDER_OPTIONS = [
  { value: "M", label: "Masculin" },
  { value: "F", label: "Féminin" },
];

const MARITAL_OPTIONS = [
  { value: "celibataire", label: "Célibataire" },
  { value: "marie", label: "Marié(e)" },
  { value: "divorce", label: "Divorcé(e)" },
  { value: "veuf", label: "Veuf/Veuve" },
];

export default function StaffPage() {
  const { permissions, profile } = useAuth();
  const { toast } = useToast();

  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canCreate = permissions.includes("hr.create" as never);
  const canUpdate = permissions.includes("hr.update" as never);
  const canDelete = permissions.includes("hr.delete" as never);

  const fetchStaff = useCallback(async () => {
    if (!profile?.institution_id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("hr_staff")
        .select("*")
        .eq("institution_id", profile.institution_id)
        .order("created_at", { ascending: false });
      if (err) throw err;
      setStaff(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const filtered = staff.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = getStaffDisplayName(s).toLowerCase();
    return s.staff_number.toLowerCase().includes(q) || name.includes(q) || (s.personal_email ?? "").toLowerCase().includes(q);
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error: err } = await supabase.from("hr_staff").delete().eq("id", deleteTarget.id);
      if (err) throw err;
      toast({ title: "Personnel supprimé" });
      setDeleteTarget(null);
      fetchStaff();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div><PageHeader title="Personnel" description="Gestion du personnel administratif et support" /><LoadingState /></div>;
  }
  if (error) {
    return <div><PageHeader title="Personnel" description="Gestion du personnel" /><ErrorState message={error} action={<Button variant="outline" size="sm" onClick={fetchStaff}>Réessayer</Button>} /></div>;
  }

  return (
    <div>
      <PageHeader
        title="Personnel"
        description="Gestion du personnel administratif et support"
        action={canCreate && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Nouveau membre
          </Button>
        )}
      />

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Rechercher par nom, matricule ou email..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Tous les statuts" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              {STATUS_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="Aucun personnel" message="Aucun membre du personnel trouvé." action={canCreate && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="w-4 h-4 mr-2" /> Ajouter</Button>
          )} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Matricule</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Embauche</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const displayName = getStaffDisplayName(s);
                  const initials = getStaffInitials(s);
                  const statusLabel = STATUS_OPTIONS.find((o) => o.value === s.status)?.label ?? s.status;
                  const empLabel = EMPLOYMENT_TYPES.find((o) => o.value === s.employment_type)?.label ?? s.employment_type ?? "—";
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-9 h-9">
                            {s.photo_url && <AvatarImage src={s.photo_url} alt={displayName} />}
                            <AvatarFallback className="text-xs bg-primary text-white">{initials}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{displayName}</p>
                            {s.civility && <p className="text-xs text-muted-foreground">{s.civility}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{s.staff_number}</TableCell>
                      <TableCell>
                        <div className="text-xs">
                          <p className="text-muted-foreground">{s.personal_email ?? "—"}</p>
                          <p className="text-muted-foreground">{s.personal_phone ?? "—"}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{empLabel}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{new Date(s.hire_date).toLocaleDateString("fr-FR")}</TableCell>
                      <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{statusLabel}</Badge></TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canUpdate && <DropdownMenuItem onClick={() => { setEditing(s); setFormOpen(true); }}><Pencil className="w-4 h-4 mr-2" /> Modifier</DropdownMenuItem>}
                            {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(s)}><Trash2 className="w-4 h-4 mr-2" /> Supprimer</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <StaffFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        staff={editing}
        allStaff={staff}
        institutionId={profile?.institution_id ?? ""}
        onSaved={fetchStaff}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce membre du personnel ?</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer « {deleteTarget ? getStaffDisplayName(deleteTarget) : ""} » ? Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StaffFormDialog({
  open, onOpenChange, staff, allStaff, institutionId, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: Staff | null;
  allStaff: Staff[];
  institutionId: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [loadingNumber, setLoadingNumber] = useState(false);
  const [staffNumber, setStaffNumber] = useState("");
  const [civility, setCivility] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [managerId, setManagerId] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [status, setStatus] = useState("active");
  const [employmentType, setEmploymentType] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [nationality, setNationality] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [personalPhone, setPersonalPhone] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");

  useEffect(() => {
    if (open) {
      setStaffNumber(staff?.staff_number ?? "");
      if (!staff && institutionId) {
        generateStaffNumber(institutionId);
      }
      setCivility(staff?.civility ?? "");
      setFirstName(staff?.first_name ?? "");
      setLastName(staff?.last_name ?? "");
      setPhotoUrl(staff?.photo_url ?? "");
      setManagerId(staff?.manager_id ?? "none");
      setHireDate(staff?.hire_date ?? new Date().toISOString().slice(0, 10));
      setStatus(staff?.status ?? "active");
      setEmploymentType(staff?.employment_type ?? "");
      setGender(staff?.gender ?? "");
      setBirthDate(staff?.birth_date ?? "");
      setBirthPlace(staff?.birth_place ?? "");
      setNationality(staff?.nationality ?? "");
      setMaritalStatus(staff?.marital_status ?? "");
      setPersonalEmail(staff?.personal_email ?? "");
      setPersonalPhone(staff?.personal_phone ?? "");
      setAddress(staff?.address ?? "");
      setEmergencyContactName(staff?.emergency_contact_name ?? "");
      setEmergencyContactPhone(staff?.emergency_contact_phone ?? "");
    }
  }, [open, staff]);

  const generateStaffNumber = async (instId: string) => {
    setLoadingNumber(true);
    try {
      const { data, error } = await supabase.rpc("generate_staff_number", { p_institution_id: instId });
      if (error) throw error;
      if (data) setStaffNumber(data as string);
    } catch {
      // fallback: keep empty
    } finally {
      setLoadingNumber(false);
    }
  };

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux", description: "Taille maximum : 2 Mo.", variant: "destructive" });
      return;
    }
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const fileName = `staff-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("documents")
        .upload(`hr-photos/${fileName}`, file);
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage
        .from("documents")
        .getPublicUrl(`hr-photos/${fileName}`);
      setPhotoUrl(urlData.publicUrl);
      toast({ title: "Photo téléversée" });
    } catch (err) {
      toast({ title: "Erreur téléversement", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffNumber.trim() || !firstName.trim() || !lastName.trim()) {
      toast({ title: "Champs requis", description: "Matricule, prénom et nom sont obligatoires.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        institution_id: institutionId,
        staff_number: staffNumber.trim(),
        civility: civility || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        photo_url: photoUrl || null,
        manager_id: managerId && managerId !== "none" ? managerId : null,
        hire_date: hireDate,
        status,
        employment_type: employmentType || null,
        gender: gender || null,
        birth_date: birthDate || null,
        birth_place: birthPlace.trim() || null,
        nationality: nationality.trim() || null,
        marital_status: maritalStatus || null,
        personal_email: personalEmail.trim() || null,
        personal_phone: personalPhone.trim() || null,
        address: address.trim() || null,
        emergency_contact_name: emergencyContactName.trim() || null,
        emergency_contact_phone: emergencyContactPhone.trim() || null,
      };

      if (staff) {
        const { error: err } = await supabase.from("hr_staff").update(payload).eq("id", staff.id);
        if (err) throw err;
        toast({ title: "Personnel mis à jour" });
      } else {
        const { error: err } = await supabase.from("hr_staff").insert(payload);
        if (err) throw err;
        toast({ title: "Personnel créé" });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Une erreur est survenue.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const managerOptions = allStaff.filter((s) => s.id !== staff?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{staff ? "Modifier la fiche personnel" : "Nouvelle fiche personnel"}</DialogTitle>
          <DialogDescription>Renseignez les informations du membre du personnel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Photo + identité */}
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-2">
              <Avatar className="w-20 h-20">
                {photoUrl && <AvatarImage src={photoUrl} alt="Photo" />}
                <AvatarFallback className="bg-muted text-muted-foreground">
                  {firstName[0]?.toUpperCase() ?? "?"}{lastName[0]?.toUpperCase() ?? ""}
                </AvatarFallback>
              </Avatar>
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <Upload className="w-3 h-3" /> Photo
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handleUploadPhoto} />
              </label>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sf-civ">Civilité</Label>
                <Select value={civility} onValueChange={setCivility} disabled={saving}>
                  <SelectTrigger id="sf-civ"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {CIVILITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sf-first">Prénom(s) *</Label>
                <Input id="sf-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sf-last">Nom *</Label>
                <Input id="sf-last" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={saving} />
              </div>
            </div>
          </div>

          {/* Matricule + embauche + statut */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sf-num">
                Matricule {staff && <Lock className="w-3 h-3 inline ml-1 text-muted-foreground" />}
              </Label>
              <div className="flex gap-2">
                <Input id="sf-num" value={staffNumber} onChange={(e) => setStaffNumber(e.target.value)} disabled={saving || loadingNumber || !!staff} placeholder="A001" className={staff ? "bg-muted" : ""} />
                {!staff && (
                  <Button type="button" variant="outline" size="sm" disabled={saving || loadingNumber} onClick={() => generateStaffNumber(institutionId)}>
                    {loadingNumber ? <Loader2 className="w-4 h-4 animate-spin" /> : "Auto"}
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-hire">Date d'embauche</Label>
              <Input id="sf-hire" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-status">Statut</Label>
              <Select value={status} onValueChange={setStatus} disabled={saving}>
                <SelectTrigger id="sf-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-type">Type d'emploi</Label>
              <Select value={employmentType} onValueChange={setEmploymentType} disabled={saving}>
                <SelectTrigger id="sf-type"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Supérieur hiérarchique */}
          <div className="space-y-2">
            <Label htmlFor="sf-manager">Supérieur hiérarchique</Label>
            <Select value={managerId} onValueChange={setManagerId} disabled={saving}>
              <SelectTrigger id="sf-manager"><SelectValue placeholder="Aucun (niveau supérieur)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucun (niveau supérieur)</SelectItem>
                {managerOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{getStaffDisplayName(m)} ({m.staff_number})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Naissance */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sf-bdate">Date de naissance</Label>
              <Input id="sf-bdate" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-bplace">Lieu de naissance</Label>
              <Input id="sf-bplace" value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-gender">Sexe</Label>
              <Select value={gender} onValueChange={setGender} disabled={saving}>
                <SelectTrigger id="sf-gender"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-nat">Nationalité</Label>
              <Input id="sf-nat" value={nationality} onChange={(e) => setNationality(e.target.value)} disabled={saving} />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sf-email">Email personnel</Label>
              <Input id="sf-email" type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-phone">Téléphone</Label>
              <Input id="sf-phone" value={personalPhone} onChange={(e) => setPersonalPhone(e.target.value)} disabled={saving} placeholder="+221 ..." />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sf-marital">Situation matrimoniale</Label>
              <Select value={maritalStatus} onValueChange={setMaritalStatus} disabled={saving}>
                <SelectTrigger id="sf-marital"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {MARITAL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-addr">Adresse</Label>
              <Input id="sf-addr" value={address} onChange={(e) => setAddress(e.target.value)} disabled={saving} />
            </div>
          </div>

          {/* Urgence */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sf-emerg-name">Contact d'urgence — Nom</Label>
              <Input id="sf-emerg-name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sf-emerg-phone">Contact d'urgence — Téléphone</Label>
              <Input id="sf-emerg-phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} disabled={saving} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving ? "Enregistrement..." : staff ? "Enregistrer" : "Créer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
