"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader as Loader2, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { TEACHER_STATUS_OPTIONS } from "@/components/shared/status-badge";
import type { Database } from "@/lib/types/database";

type Teacher = Database["public"]["Tables"]["teachers"]["Row"];

const CIVILITY_OPTIONS = [
  { value: "M", label: "M." },
  { value: "Mme", label: "Mme" },
  { value: "Mlle", label: "Mlle" },
  { value: "Dr", label: "Dr" },
  { value: "Pr", label: "Pr" },
];

const GENDER_OPTIONS = [
  { value: "M", label: "Masculin" },
  { value: "F", label: "Féminin" },
];

const MARITAL_STATUS_OPTIONS = [
  { value: "celibataire", label: "Célibataire" },
  { value: "marie", label: "Marié(e)" },
  { value: "divorce", label: "Divorcé(e)" },
  { value: "veuf", label: "Veuf/Veuve" },
];

interface TeacherFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teacher?: Teacher | null;
  onSaved?: () => void;
}

export function TeacherFormDialog({ open, onOpenChange, teacher, onSaved }: TeacherFormDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loadingNumber, setLoadingNumber] = useState(false);

  const [teacherNumber, setTeacherNumber] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [status, setStatus] = useState("active");

  const [civility, setCivility] = useState<string>("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [gender, setGender] = useState<string>("");
  const [nationality, setNationality] = useState("");
  const [maritalStatus, setMaritalStatus] = useState<string>("");
  const [address, setAddress] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setTeacherNumber(teacher?.teacher_number ?? "");
      setSpecialization(teacher?.specialization ?? "");
      setStatus(teacher?.status ?? "active");
      setCivility(teacher?.civility ?? "");
      setFirstName(teacher?.first_name ?? "");
      setLastName(teacher?.last_name ?? "");
      setEmail(teacher?.email ?? "");
      setPhone(teacher?.phone ?? "");
      setBirthDate(teacher?.birth_date ?? "");
      setBirthPlace(teacher?.birth_place ?? "");
      setGender(teacher?.gender ?? "");
      setNationality(teacher?.nationality ?? "");
      setMaritalStatus(teacher?.marital_status ?? "");
      setAddress(teacher?.address ?? "");
      setEmergencyContactName(teacher?.emergency_contact_name ?? "");
      setEmergencyContactPhone(teacher?.emergency_contact_phone ?? "");
      setErrors({});

      if (!teacher && profile?.institution_id) {
        generateTeacherNumber(profile.institution_id);
      }
    }
  }, [open, teacher, profile?.institution_id]);

  const generateTeacherNumber = async (institutionId: string) => {
    setLoadingNumber(true);
    try {
      const { data, error } = await supabase.rpc("generate_teacher_number", {
        p_institution_id: institutionId,
      });
      if (error) throw error;
      if (data) setTeacherNumber(data as string);
    } catch {
      // fallback: keep empty, user can type manually
    } finally {
      setLoadingNumber(false);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!teacherNumber.trim()) e.teacherNumber = "Le matricule est requis";
    if (!lastName.trim()) e.lastName = "Le nom est requis";
    if (!firstName.trim()) e.firstName = "Le prénom est requis";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Email invalide";
    if (emergencyContactPhone && emergencyContactPhone.length < 6) e.emergencyContactPhone = "Téléphone d'urgence invalide";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (!profile?.institution_id) {
      toast({ title: "Erreur", description: "Aucune institution associée à votre compte.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const identityPayload = {
        civility: civility || null,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        birth_date: birthDate || null,
        birth_place: birthPlace.trim() || null,
        gender: gender || null,
        nationality: nationality.trim() || null,
        marital_status: maritalStatus || null,
        address: address.trim() || null,
        emergency_contact_name: emergencyContactName.trim() || null,
        emergency_contact_phone: emergencyContactPhone.trim() || null,
      };

      if (teacher) {
        const { error } = await supabase
          .from("teachers")
          .update({
            teacher_number: teacherNumber.trim(),
            specialization: specialization.trim() || null,
            status,
            ...identityPayload,
          })
          .eq("id", teacher.id);

        if (error) throw error;
        toast({ title: "Formateur modifié", description: "Les informations ont été mises à jour." });
      } else {
        const { error } = await supabase.from("teachers").insert({
          institution_id: profile.institution_id,
          teacher_number: teacherNumber.trim(),
          specialization: specialization.trim() || null,
          status,
          ...identityPayload,
        });

        if (error) throw error;
        toast({ title: "Formateur créé", description: "Le formateur a été enregistré." });
      }

      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Une erreur est survenue.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{teacher ? "Modifier le formateur" : "Nouveau formateur"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Informations professionnelles</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="teacher_number">
                  Matricule {teacher && <Lock className="w-3 h-3 inline ml-1 text-muted-foreground" />}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="teacher_number"
                    value={teacherNumber}
                    onChange={(e) => setTeacherNumber(e.target.value)}
                    disabled={loading || loadingNumber || !!teacher}
                    placeholder="A001"
                    className={teacher ? "bg-muted" : ""}
                  />
                  {!teacher && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loading || loadingNumber || !profile?.institution_id}
                      onClick={() => profile?.institution_id && generateTeacherNumber(profile.institution_id)}
                    >
                      {loadingNumber ? <Loader2 className="w-4 h-4 animate-spin" /> : "Auto"}
                    </Button>
                  )}
                </div>
                {errors.teacherNumber && <p className="text-xs text-destructive">{errors.teacherNumber}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Statut</Label>
                <Select value={status} onValueChange={setStatus} disabled={loading}>
                  <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEACHER_STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="specialization">Spécialisation</Label>
                <Input id="specialization" value={specialization} onChange={(e) => setSpecialization(e.target.value)} disabled={loading} placeholder="Mathématiques, Informatique..." />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Identité</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="civility">Civilité</Label>
                <Select value={civility} onValueChange={setCivility} disabled={loading}>
                  <SelectTrigger id="civility"><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    {CIVILITY_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gender">Sexe</Label>
                <Select value={gender} onValueChange={setGender} disabled={loading}>
                  <SelectTrigger id="gender"><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Nom *</Label>
                <Input id="last_name" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={loading} autoFocus />
                {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="first_name">Prénom(s) *</Label>
                <Input id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={loading} />
                {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="birth_date">Date de naissance</Label>
                <Input id="birth_date" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} disabled={loading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birth_place">Lieu de naissance</Label>
                <Input id="birth_place" value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} disabled={loading} placeholder="Dakar" />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Coordonnées</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} placeholder="formateur@email.com" />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Téléphone</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={loading} placeholder="+221 ..." />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="address">Adresse</Label>
                <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} disabled={loading} placeholder="Rue, ville, quartier..." />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Informations complémentaires</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nationality">Nationalité</Label>
                <Input id="nationality" value={nationality} onChange={(e) => setNationality(e.target.value)} disabled={loading} placeholder="Sénégalaise" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="marital_status">Situation matrimoniale</Label>
                <Select value={maritalStatus} onValueChange={setMaritalStatus} disabled={loading}>
                  <SelectTrigger id="marital_status"><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    {MARITAL_STATUS_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Contact d'urgence</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="emergency_contact_name">Nom du contact</Label>
                <Input id="emergency_contact_name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} disabled={loading} placeholder="Nom complet" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergency_contact_phone">Téléphone</Label>
                <Input id="emergency_contact_phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} disabled={loading} placeholder="+221 ..." />
                {errors.emergencyContactPhone && <p className="text-xs text-destructive">{errors.emergencyContactPhone}</p>}
              </div>
            </div>
          </div>

          <DialogFooter className="border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {teacher ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
