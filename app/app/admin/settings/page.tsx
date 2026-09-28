"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { ErrorState } from "@/components/shared/error-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { Save, Upload, Loader as Loader2, Building2, FileText, ShieldCheck, Image as ImageIcon } from "lucide-react";

type Institution = Database["public"]["Tables"]["institutions"]["Row"];

export default function SettingsPage() {
  const { permissions, profile } = useAuth();
  const { toast } = useToast();

  const [institution, setInstitution] = useState<Institution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canView = permissions.includes("settings.view" as never);
  const canManage = permissions.includes("settings.manage" as never) ||
    permissions.includes("institutions.manage" as never);

  const fetchInstitution = useCallback(async () => {
    if (!profile?.institution_id) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from("institutions")
        .select("*")
        .eq("id", profile.institution_id)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!data) {
        setError("Introuvable.");
        return;
      }
      setInstitution(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  useEffect(() => {
    fetchInstitution();
  }, [fetchInstitution]);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Paramètres" />
        <Card className="p-6">
          <EmptyState title="Accès refusé" message="Vous n'avez pas la permission d'accéder à cette section." />
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Paramètres" description="Configuration de l'établissement" />
        <LoadingState />
      </div>
    );
  }

  if (error || !institution) {
    return (
      <div>
        <PageHeader title="Paramètres" description="Configuration de l'établissement" />
        {error ? (
          <ErrorState message={error} action={
            <Button variant="outline" size="sm" onClick={fetchInstitution}>Réessayer</Button>
          } />
        ) : (
          <EmptyState title="Introuvable" />
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Paramètres"
        description="Configuration de l'établissement"
      />

      <Tabs defaultValue="identity">
        <TabsList className="flex-wrap">
          <TabsTrigger value="identity">
            <Building2 className="w-4 h-4 mr-2" />
            Identité et documents officiels
          </TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <IdentityDocumentsSettings
            institution={institution}
            canManage={canManage}
            onSaved={fetchInstitution}
            saving={saving}
            setSaving={setSaving}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function IdentityDocumentsSettings({
  institution,
  canManage,
  onSaved,
  saving,
  setSaving,
}: {
  institution: Institution;
  canManage: boolean;
  onSaved: () => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
}) {
  const { toast } = useToast();

  // Identity
  const [name, setName] = useState(institution.name);
  const [shortName, setShortName] = useState(institution.short_name ?? "");
  const [address, setAddress] = useState(institution.address ?? "");
  const [city, setCity] = useState(institution.city ?? "");
  const [phone, setPhone] = useState(institution.phone ?? "");
  const [email, setEmail] = useState(institution.email ?? "");
  const [website, setWebsite] = useState(institution.website ?? "");
  const [logoUrl, setLogoUrl] = useState(institution.logo_url ?? "");

  // Administrative header
  const [republicName, setRepublicName] = useState(institution.republic_name ?? "");
  const [motto, setMotto] = useState(institution.motto ?? "");
  const [ministry, setMinistry] = useState(institution.ministry ?? "");
  const [flagUrl, setFlagUrl] = useState(institution.flag_url ?? "");
  const [headerSeparator, setHeaderSeparator] = useState(institution.header_separator ?? "");

  // Signatory
  const [directorName, setDirectorName] = useState(institution.director_name ?? "");
  const [directorFunction, setDirectorFunction] = useState(institution.director_function ?? "");
  const [signatureUrl, setSignatureUrl] = useState(institution.signature_url ?? "");
  const [stampUrl, setStampUrl] = useState(institution.stamp_url ?? "");

  const [uploadingField, setUploadingField] = useState<string | null>(null);

  const handleUpload = async (field: string, file: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux", description: "Taille maximum : 2 Mo.", variant: "destructive" });
      return;
    }

    setUploadingField(field);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const fileName = `${field}-${Date.now()}.${ext}`;
      const path = `institutions/${institution.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("public-assets")
        .upload(path, file, { upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("public-assets")
        .getPublicUrl(path);

      const publicUrl = urlData.publicUrl;

      switch (field) {
        case "logo_url": setLogoUrl(publicUrl); break;
        case "flag_url": setFlagUrl(publicUrl); break;
        case "signature_url": setSignatureUrl(publicUrl); break;
        case "stamp_url": setStampUrl(publicUrl); break;
      }

      toast({ title: "Fichier téléversé" });
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Téléversement impossible.",
        variant: "destructive",
      });
    } finally {
      setUploadingField(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("institutions")
        .update({
          name: name.trim(),
          short_name: shortName.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          website: website.trim() || null,
          logo_url: logoUrl || null,
          republic_name: republicName.trim() || null,
          motto: motto.trim() || null,
          ministry: ministry.trim() || null,
          flag_url: flagUrl || null,
          header_separator: headerSeparator.trim() || null,
          director_name: directorName.trim() || null,
          director_function: directorFunction.trim() || null,
          signature_url: signatureUrl || null,
          stamp_url: stampUrl || null,
        })
        .eq("id", institution.id);

      if (updateError) throw updateError;

      toast({ title: "Paramètres enregistrés", description: "Les informations de l'établissement ont été mises à jour." });
      onSaved();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Une erreur est survenue.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Section: Identité institutionnelle */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <Building2 className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Identité institutionnelle</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="inst-name">Nom officiel *</Label>
            <Input id="inst-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage || saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-short-name">Nom court</Label>
            <Input id="inst-short-name" value={shortName} onChange={(e) => setShortName(e.target.value)} disabled={!canManage || saving} placeholder="ISM, ENSA..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-address">Adresse</Label>
            <Input id="inst-address" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage || saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-city">Ville</Label>
            <Input id="inst-city" value={city} onChange={(e) => setCity(e.target.value)} disabled={!canManage || saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-phone">Téléphone</Label>
            <Input id="inst-phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canManage || saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-email">Email</Label>
            <Input id="inst-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canManage || saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-website">Site web</Label>
            <Input id="inst-website" value={website} onChange={(e) => setWebsite(e.target.value)} disabled={!canManage || saving} placeholder="https://..." />
          </div>
        </div>

        {/* Logo upload */}
        <div className="mt-5 pt-5 border-t">
          <Label className="mb-3 block">Logo de l'établissement</Label>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl border-2 border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
              )}
            </div>
            {canManage && (
              <div className="flex flex-col gap-2">
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                    {uploadingField === "logo_url" ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Téléversement...</> 
                    ) : (
                      <><Upload className="w-4 h-4" /> Changer le logo</>
                    )}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={saving || uploadingField !== null}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload("logo_url", f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {logoUrl && (
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={saving} onClick={() => setLogoUrl("")}>
                    Retirer
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Section: En-tête administrative */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <FileText className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">En-tête administrative</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="inst-republic">Nom de la République</Label>
            <Input id="inst-republic" value={republicName} onChange={(e) => setRepublicName(e.target.value)} disabled={!canManage || saving} placeholder="République du Sénégal" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-motto">Devise nationale</Label>
            <Input id="inst-motto" value={motto} onChange={(e) => setMotto(e.target.value)} disabled={!canManage || saving} placeholder="Un Peuple, Un But, Une Foi" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-ministry">Ministère de tutelle</Label>
            <Input id="inst-ministry" value={ministry} onChange={(e) => setMinistry(e.target.value)} disabled={!canManage || saving} placeholder="Ministère de l'Enseignement Supérieur" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-separator">Ligne/séparateur d'en-tête</Label>
            <Input id="inst-separator" value={headerSeparator} onChange={(e) => setHeaderSeparator(e.target.value)} disabled={!canManage || saving} placeholder="----------" />
          </div>
        </div>

        {/* Flag upload */}
        <div className="mt-5 pt-5 border-t">
          <Label className="mb-3 block">Drapeau national</Label>
          <div className="flex items-center gap-4">
            <div className="w-20 h-14 rounded-lg border-2 border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
              {flagUrl ? (
                <img src={flagUrl} alt="Drapeau" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
              )}
            </div>
            {canManage && (
              <div className="flex flex-col gap-2">
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                    {uploadingField === "flag_url" ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Téléversement...</>
                    ) : (
                      <><Upload className="w-4 h-4" /> Changer le drapeau</>
                    )}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={saving || uploadingField !== null}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload("flag_url", f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {flagUrl && (
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={saving} onClick={() => setFlagUrl("")}>
                    Retirer
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Section: Signataire */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Signataire</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="inst-director-name">Nom du directeur / signataire</Label>
            <Input id="inst-director-name" value={directorName} onChange={(e) => setDirectorName(e.target.value)} disabled={!canManage || saving} placeholder="Prénom NOM" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-director-function">Fonction</Label>
            <Input id="inst-director-function" value={directorFunction} onChange={(e) => setDirectorFunction(e.target.value)} disabled={!canManage || saving} placeholder="Directeur des Études" />
          </div>
        </div>

        {/* Signature + Stamp uploads */}
        <div className="mt-5 pt-5 border-t grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <Label className="mb-3 block">Signature</Label>
            <div className="flex items-center gap-4">
              <div className="w-24 h-20 rounded-lg border-2 border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {signatureUrl ? (
                  <img src={signatureUrl} alt="Signature" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
                )}
              </div>
              {canManage && (
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                      {uploadingField === "signature_url" ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Téléversement...</>
                      ) : (
                        <><Upload className="w-4 h-4" /> Changer</>
                      )}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={saving || uploadingField !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload("signature_url", f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {signatureUrl && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={saving} onClick={() => setSignatureUrl("")}>
                      Retirer
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <Label className="mb-3 block">Cachet</Label>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-full border-2 border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {stampUrl ? (
                  <img src={stampUrl} alt="Cachet" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
                )}
              </div>
              {canManage && (
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                      {uploadingField === "stamp_url" ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Téléversement...</>
                      ) : (
                        <><Upload className="w-4 h-4" /> Changer</>
                      )}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={saving || uploadingField !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload("stamp_url", f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {stampUrl && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={saving} onClick={() => setStampUrl("")}>
                      Retirer
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Save button */}
      {canManage && (
        <div className="flex justify-end">
          <Button type="submit" disabled={saving || uploadingField !== null}>
            {saving ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enregistrement...</>
            ) : (
              <><Save className="w-4 h-4 mr-2" /> Enregistrer les paramètres</>
            )}
          </Button>
        </div>
      )}
    </form>
  );
}
