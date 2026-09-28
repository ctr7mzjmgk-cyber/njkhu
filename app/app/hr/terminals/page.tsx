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
import {
  Cpu, Plus, Search, Loader as Loader2, Copy, Check, KeyRound,
  Power, Settings, Trash2, Clock, ExternalLink,
} from "lucide-react";
import type { Database } from "@/lib/types/database";

type Terminal = Database["public"]["Tables"]["attendance_terminals"]["Row"];
type AttendanceConfig = Database["public"]["Tables"]["institution_attendance_config"]["Row"];

const TERMINAL_TYPES: Record<string, string> = {
  physical_qr: "QR Physique",
  fingerprint: "Lecteur d'empreintes",
  virtual: "Terminal virtuel",
  mobile: "Application mobile",
};

const ALL_METHODS = [
  { value: "employee_qr", label: "QR Employé" },
  { value: "terminal_qr", label: "QR Terminal" },
  { value: "fingerprint", label: "Empreinte digitale" },
  { value: "manual", label: "Saisie manuelle" },
];

export default function TerminalsPage() {
  const { profile, permissions } = useAuth();
  const { toast } = useToast();

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [config, setConfig] = useState<AttendanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    code: "",
    name: "",
    terminal_type: "virtual",
    location: "",
  });
  const [creating, setCreating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Config editing
  const [configForm, setConfigForm] = useState({
    enabled_methods: [] as string[],
    require_geolocation: false,
    grace_period_minutes: 15,
    auto_clock_out_hours: "" as string,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  const canManage = permissions.includes("attendance.manage" as never);
  const canDelete = permissions.includes("hr.delete" as never);

  const fetchData = useCallback(async () => {
    if (!profile?.institution_id) { setLoading(false); return; }
    setLoading(true);

    const [termRes, configRes] = await Promise.all([
      supabase
        .from("attendance_terminals")
        .select("*")
        .eq("institution_id", profile.institution_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("institution_attendance_config")
        .select("*")
        .eq("institution_id", profile.institution_id)
        .maybeSingle(),
    ]);

    if (termRes.data) setTerminals(termRes.data as Terminal[]);
    if (configRes.data) {
      const cfg = configRes.data as AttendanceConfig;
      setConfig(cfg);
      setConfigForm({
        enabled_methods: cfg.enabled_methods,
        require_geolocation: cfg.require_geolocation,
        grace_period_minutes: cfg.grace_period_minutes,
        auto_clock_out_hours: cfg.auto_clock_out_hours?.toString() ?? "",
      });
    }
    setLoading(false);
  }, [profile?.institution_id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = terminals.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q);
  });

  const handleCreate = async () => {
    if (!profile?.institution_id || !createForm.code || !createForm.name) return;
    setCreating(true);
    try {
      // Generate a random API key
      const apiKey = `term_${crypto.randomUUID().replace(/-/g, "")}`;
      // Hash it with a simple approach — we'll store the hash and return the plaintext once
      const { data, error } = await supabase
        .from("attendance_terminals")
        .insert({
          institution_id: profile.institution_id,
          code: createForm.code,
          name: createForm.name,
          terminal_type: createForm.terminal_type,
          location: createForm.location || null,
          api_key_hash: await hashKey(apiKey),
        })
        .select("id")
        .single();

      if (error) throw error;

      setGeneratedKey(apiKey);
      setCreateForm({ code: "", name: "", terminal_type: "virtual", location: "" });
      fetchData();
      toast({ title: "Terminal créé", description: "Copiez la clé API — elle ne sera plus affichée." });
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (terminal: Terminal) => {
    setTogglingId(terminal.id);
    try {
      const { error } = await supabase
        .from("attendance_terminals")
        .update({ is_active: !terminal.is_active })
        .eq("id", terminal.id);
      if (error) throw error;
      toast({ title: terminal.is_active ? "Terminal désactivé" : "Terminal activé" });
      fetchData();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const { error } = await supabase
        .from("attendance_terminals")
        .delete()
        .eq("id", deleteId);
      if (error) throw error;
      toast({ title: "Terminal supprimé" });
      setDeleteId(null);
      fetchData();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Une erreur est survenue",
        variant: "destructive",
      });
    }
  };

  const handleSaveConfig = async () => {
    if (!profile?.institution_id) return;
    setSavingConfig(true);
    try {
      const payload = {
        institution_id: profile.institution_id,
        enabled_methods: configForm.enabled_methods,
        require_geolocation: configForm.require_geolocation,
        grace_period_minutes: configForm.grace_period_minutes,
        auto_clock_out_hours: configForm.auto_clock_out_hours
          ? parseInt(configForm.auto_clock_out_hours, 10)
          : null,
      };

      if (config) {
        const { error } = await supabase
          .from("institution_attendance_config")
          .update(payload)
          .eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("institution_attendance_config")
          .insert(payload);
        if (error) throw error;
      }

      toast({ title: "Configuration enregistrée" });
      fetchData();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const toggleMethod = (method: string) => {
    setConfigForm((prev) => ({
      ...prev,
      enabled_methods: prev.enabled_methods.includes(method)
        ? prev.enabled_methods.filter((m) => m !== method)
        : [...prev.enabled_methods, method],
    }));
  };

  const copyKey = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 3000);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Terminaux de pointage" description="Gestion des dispositifs et configuration" />
        <LoadingState />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Terminaux de pointage"
        description="Gestion des dispositifs et configuration du pointage"
        action={canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Nouveau terminal
          </Button>
        )}
      />

      <div className="space-y-6">
        {/* Configuration card */}
        {canManage && (
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Configuration du pointage</h3>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Méthodes de pointage activées</Label>
                <div className="flex flex-wrap gap-2">
                  {ALL_METHODS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => toggleMethod(m.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        configForm.enabled_methods.includes(m.value)
                          ? "bg-primary text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Si aucune méthode n'est sélectionnée, toutes les méthodes sont acceptées.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="grace">Période de grâce (minutes)</Label>
                  <Input
                    id="grace"
                    type="number"
                    min={0}
                    value={configForm.grace_period_minutes}
                    onChange={(e) => setConfigForm({ ...configForm, grace_period_minutes: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auto_out">Auto-sortie (heures)</Label>
                  <Input
                    id="auto_out"
                    type="number"
                    min={0}
                    placeholder="Désactivé"
                    value={configForm.auto_clock_out_hours}
                    onChange={(e) => setConfigForm({ ...configForm, auto_clock_out_hours: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-3 pt-7">
                  <Switch
                    id="geo"
                    checked={configForm.require_geolocation}
                    onCheckedChange={(v) => setConfigForm({ ...configForm, require_geolocation: v })}
                  />
                  <Label htmlFor="geo" className="cursor-pointer">Géolocalisation requise</Label>
                </div>
              </div>

              <Button onClick={handleSaveConfig} disabled={savingConfig}>
                {savingConfig ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enregistrement...</>
                ) : (
                  "Enregistrer la configuration"
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* Terminals table */}
        <Card className="p-4">
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un terminal..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="Aucun terminal"
              message={canManage ? "Créez votre premier terminal de pointage." : "Aucun terminal configuré."}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Localisation</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Dernière activité</TableHead>
                    {canManage && <TableHead className="w-[80px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{t.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{t.code}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{TERMINAL_TYPES[t.terminal_type] ?? t.terminal_type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.location ?? "—"}
                      </TableCell>
                      <TableCell>
                        {t.is_active ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Actif</Badge>
                        ) : (
                          <Badge variant="destructive">Inactif</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.last_seen_at
                          ? new Date(t.last_seen_at).toLocaleString("fr-FR", {
                              dateStyle: "short", timeStyle: "short",
                            })
                          : "Jamais"}
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              asChild
                              title="Ouvrir la borne"
                            >
                              <a href={`/rh/borne-pointage/${t.id}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={togglingId === t.id}
                              onClick={() => handleToggle(t)}
                              title={t.is_active ? "Désactiver" : "Activer"}
                            >
                              <Power className="w-4 h-4" />
                            </Button>
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => setDeleteId(t.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
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

      {/* Create terminal dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setGeneratedKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau terminal de pointage</DialogTitle>
          </DialogHeader>

          {generatedKey ? (
            <div className="space-y-4 py-4">
              <div className="flex items-start gap-2 p-4 rounded-lg bg-amber-50 border border-amber-200">
                <KeyRound className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">Clé API du terminal</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Copiez cette clé maintenant. Elle ne sera plus jamais affichée.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-3 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono break-all">
                  {generatedKey}
                </code>
                <Button onClick={copyKey} variant="outline" size="icon">
                  {copiedKey ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>Fermer</Button>
                </DialogClose>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="term_code">Code</Label>
                  <Input
                    id="term_code"
                    placeholder="T001"
                    value={createForm.code}
                    onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="term_name">Nom</Label>
                  <Input
                    id="term_name"
                    placeholder="Entrée principale"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="term_type">Type de terminal</Label>
                  <Select
                    value={createForm.terminal_type}
                    onValueChange={(v) => setCreateForm({ ...createForm, terminal_type: v })}
                  >
                    <SelectTrigger id="term_type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="physical_qr">QR Physique</SelectItem>
                      <SelectItem value="fingerprint">Lecteur d'empreintes</SelectItem>
                      <SelectItem value="virtual">Terminal virtuel</SelectItem>
                      <SelectItem value="mobile">Application mobile</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="term_loc">Localisation (optionnel)</Label>
                  <Input
                    id="term_loc"
                    placeholder="Hall d'entrée, 1er étage..."
                    value={createForm.location}
                    onChange={(e) => setCreateForm({ ...createForm, location: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Annuler</Button>
                </DialogClose>
                <Button onClick={handleCreate} disabled={creating || !createForm.code || !createForm.name}>
                  {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Créer
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer ce terminal ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            Cette action est irréversible. Les événements de pointage associés seront conservés
            mais le terminal ne sera plus référencé.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Annuler</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
