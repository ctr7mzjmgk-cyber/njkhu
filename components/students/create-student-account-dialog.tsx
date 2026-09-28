"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader as Loader2, ShieldCheck, Mail, Copy, CircleCheck as CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/lib/types/database";

type Student = Database["public"]["Tables"]["students"]["Row"];

interface CreateStudentAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: Student | null;
  onCreated?: () => void;
}

export function CreateStudentAccountDialog({
  open,
  onOpenChange,
  student,
  onCreated,
}: CreateStudentAccountDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(student?.email ?? "");
      setPassword("");
      setErrors({});
      setCreatedPassword(null);
      setCopied(false);
    }
  }, [open, student]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!email.trim()) e.email = "L'email est requis";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Email invalide";
    if (password && password.length < 6) e.password = "Le mot de passe doit faire au moins 6 caractères";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !student) return;

    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          action: "link_student_account",
          student_id: student.id,
          email: email.trim(),
          password: password || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erreur");
      }

      if (data.temporary_password) {
        setCreatedPassword(data.temporary_password);
      } else {
        toast({
          title: "Compte portail créé",
          description: "L'étudiant peut désormais se connecter.",
        });
        onCreated?.();
        onOpenChange(false);
      }
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

  const handleCopyPassword = () => {
    if (!createdPassword) return;
    navigator.clipboard.writeText(createdPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    if (createdPassword) {
      onCreated?.();
    }
    onOpenChange(false);
  };

  if (createdPassword) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Compte étudiant créé avec succès</DialogTitle>
            <DialogDescription>
              {student ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() : "L'étudiant"} peut maintenant se connecter. Communiquez le mot de passe temporaire ci-dessous. Il pourra le modifier après connexion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="w-4 h-4" />
                <span className="font-medium">Email de connexion</span>
              </div>
              <p className="text-sm font-mono pl-6">{email.trim()}</p>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="font-medium">Mot de passe temporaire</span>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleCopyPassword}>
                  {copied ? <><CheckCircle2 className="w-4 h-4 mr-1 text-green-600" /> Copié</> : <><Copy className="w-4 h-4 mr-1" /> Copier</>}
                </Button>
              </div>
              <p className="text-lg font-mono font-bold pl-6 break-all">{createdPassword}</p>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Notez ce mot de passe. Il ne sera plus affiché après la fermeture de cette fenêtre.</span>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleClose}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Créer un compte portail étudiant</DialogTitle>
          <DialogDescription>
            {student
              ? `Un compte sera créé pour ${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()
              : "Crée un compte Auth et le lie à cet étudiant."} Le mot de passe est optionnel : un mot de passe temporaire sera généré automatiquement.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account_email">Email de connexion *</Label>
            <Input
              id="account_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="etudiant@email.com"
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="account_password">Mot de passe (optionnel)</Label>
            <Input
              id="account_password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="Auto-généré si vide"
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
          </div>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Le compte sera créé avec le rôle « Étudiant » et lié à cet étudiant existant.
              L'étudiant pourra se connecter, accéder à son portail et modifier son mot de passe.
            </span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Annuler
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Créer le compte
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
