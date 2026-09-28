"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase/client";
import { Save, Loader as Loader2, Lock, KeyRound, Building2, AlertCircle } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Institution = { id: string; name: string; code: string };

export default function ProfilePage() {
  const { user, profile, roles, refresh } = useAuth();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState(profile?.first_name ?? "");
  const [lastName, setLastName] = useState(profile?.last_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [selectedInstitution, setSelectedInstitution] = useState("");
  const [linkingInstitution, setLinkingInstitution] = useState(false);
  const [institutionLinked, setInstitutionLinked] = useState(false);

  useEffect(() => {
    if (!profile?.institution_id) {
      supabase
        .from("institutions")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name")
        .then(({ data }) => {
          if (data) setInstitutions(data as Institution[]);
        });
    }
  }, [profile?.institution_id]);

  const handleLinkInstitution = async () => {
    if (!profile || !selectedInstitution) return;
    setLinkingInstitution(true);
    setInstitutionLinked(false);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ institution_id: selectedInstitution })
        .eq("id", profile.id);
      if (error) throw error;
      setInstitutionLinked(true);
      toast({ title: "Institution associée", description: "Votre compte est maintenant lié à l'institution. La génération de matricules est disponible." });
      await refresh();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Impossible d'associer l'institution.", variant: "destructive" });
    } finally {
      setLinkingInstitution(false);
    }
  };

  const displayName =
    profile && (profile.first_name || profile.last_name)
      ? `${profile.first_name} ${profile.last_name}`.trim()
      : "Utilisateur";

  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSaved(false);

    const { error } = await supabase
      .from("profiles")
      .update({ first_name: firstName, last_name: lastName, phone })
      .eq("id", profile.id);

    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);

    if (!newPassword || newPassword.length < 6) {
      setPasswordError("Le nouveau mot de passe doit faire au moins 6 caractères.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Les mots de passe ne correspondent pas.");
      return;
    }

    setPasswordSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      setPasswordSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Mon profil" description="Vos informations personnelles" />

      <div className="max-w-2xl space-y-6">
        {!profile?.institution_id && (
          <Card className="p-6 border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-900">Aucune institution associée</h3>
                <p className="text-sm text-amber-700 mt-1 mb-4">
                  Votre compte n'est lié à aucune institution. La création d'étudiants, de formateurs et de personnel est bloquée, et les matricules ne peuvent pas être générés. Associez votre compte à une institution ci-dessous.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Select value={selectedInstitution} onValueChange={setSelectedInstitution}>
                    <SelectTrigger className="w-full sm:w-[300px]">
                      <SelectValue placeholder="Sélectionner une institution" />
                    </SelectTrigger>
                    <SelectContent>
                      {institutions.map((inst) => (
                        <SelectItem key={inst.id} value={inst.id}>
                          {inst.name} ({inst.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleLinkInstitution}
                    disabled={!selectedInstitution || linkingInstitution}
                  >
                    {linkingInstitution ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Association...</>
                    ) : (
                      <><Building2 className="w-4 h-4 mr-2" /> Associer</>
                    )}
                  </Button>
                </div>
                {institutionLinked && (
                  <p className="text-sm text-green-700 mt-3 flex items-center gap-1">
                    Institution associée avec succès. Vous pouvez maintenant créer des étudiants, formateurs et personnel.
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <Avatar className="w-16 h-16">
              <AvatarImage src={profile?.avatar_url ?? undefined} alt={displayName} />
              <AvatarFallback className="bg-primary text-white text-lg">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-lg font-semibold">{displayName}</h2>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <div className="flex gap-1 mt-2">
                {roles.map((role) => (
                  <Badge key={role} variant="secondary" className="capitalize">
                    {role.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nom</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={saving}
                placeholder="+221 ..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ""} disabled />
              <p className="text-xs text-muted-foreground">
                L'email ne peut pas être modifié ici. Contactez un administrateur.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Enregistrer
                  </>
                )}
              </Button>
              {saved && (
                <span className="text-sm text-green-600">Modifications enregistrées</span>
              )}
            </div>
          </form>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Changer mon mot de passe</h3>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nouveau mot de passe *</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordSaving}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmer le nouveau mot de passe *</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordSaving}
                placeholder="••••••••"
              />
            </div>
            {passwordError && (
              <p className="text-sm text-destructive">{passwordError}</p>
            )}
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={passwordSaving}>
                {passwordSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 mr-2" />
                    Mettre à jour
                  </>
                )}
              </Button>
              {passwordSaved && (
                <span className="text-sm text-green-600">Mot de passe mis à jour</span>
              )}
            </div>
          </form>
        </Card>

        <Card className="p-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">Informations système</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Date de création</dt>
              <dd className="text-foreground">
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString("fr-FR")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Statut</dt>
              <dd className="text-foreground">
                {profile?.is_active ? "Actif" : "Inactif"}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
