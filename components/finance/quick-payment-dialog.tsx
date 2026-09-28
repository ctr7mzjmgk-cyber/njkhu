"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { Loader2, Banknote } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { PAYMENT_METHOD_OPTIONS } from "@/components/shared/status-badge";

type PaymentType = "enrollment" | "monthly";

interface QuickPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const MONTHS = [
  { value: "1", label: "Janvier" },
  { value: "2", label: "Février" },
  { value: "3", label: "Mars" },
  { value: "4", label: "Avril" },
  { value: "5", label: "Mai" },
  { value: "6", label: "Juin" },
  { value: "7", label: "Juillet" },
  { value: "8", label: "Août" },
  { value: "9", label: "Septembre" },
  { value: "10", label: "Octobre" },
  { value: "11", label: "Novembre" },
  { value: "12", label: "Décembre" },
];

interface StudentOption {
  id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
}

interface CourseOption {
  id: string;
  name: string;
  enrollment_fee: number;
  monthly_fee: number;
}

interface AcademicYearOption {
  id: string;
  name: string;
}

export function QuickPaymentDialog({ open, onOpenChange, onSaved }: QuickPaymentDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);

  const [academicYearId, setAcademicYearId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("enrollment");
  const [month, setMonth] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !profile?.institution_id) return;
    supabase
      .from("academic_years")
      .select("id, name")
      .eq("institution_id", profile.institution_id)
      .order("start_date", { ascending: false })
      .then(({ data }) => setAcademicYears(data ?? []));

    supabase
      .from("courses")
      .select("id, name, enrollment_fee, monthly_fee")
      .eq("institution_id", profile.institution_id)
      .order("name")
      .then(({ data }) => setCourses(data ?? []));

    supabase
      .from("students")
      .select("id, student_number, first_name, last_name")
      .eq("institution_id", profile.institution_id)
      .order("student_number")
      .then(({ data }) => setStudents(data ?? []));

    setAcademicYearId("");
    setCourseId("");
    setStudentId("");
    setPaymentType("enrollment");
    setMonth("");
    setAmount("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setMethod("cash");
    setNote("");
    setErrors({});
  }, [open, profile?.institution_id]);

  useEffect(() => {
    if (!courseId) return;
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;
    if (paymentType === "enrollment") {
      setAmount(String(course.enrollment_fee || 0));
    } else {
      setAmount(String(course.monthly_fee || 0));
    }
  }, [courseId, paymentType, courses]);

  useEffect(() => {
    if (paymentType !== "monthly") {
      setMonth("");
    }
  }, [paymentType]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!academicYearId) e.academicYearId = "L'année académique est requise";
    if (!courseId) e.courseId = "La formation est requise";
    if (!studentId) e.studentId = "L'étudiant est requis";
    if (paymentType === "monthly" && !month) e.month = "Le mois est requis";
    if (!amount || Number(amount) <= 0) e.amount = "Le montant doit être positif";
    if (!paymentDate) e.paymentDate = "La date est requise";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !profile?.institution_id || !profile?.id) return;

    setLoading(true);
    try {
      const course = courses.find((c) => c.id === courseId);
      if (!course) throw new Error("Formation introuvable");

      const installmentLabel =
        paymentType === "enrollment"
          ? "Frais d'inscription"
          : `${MONTHS.find((m) => m.value === month)?.label ?? `Mens ${month}`}`;

      const installmentType = paymentType;

      // 1. Find existing payment plan for this student/course/year
      const { data: existingPlan } = await supabase
        .from("payment_plans")
        .select("id, total_amount, currency, enrollment_fee, tuition_amount")
        .eq("student_id", studentId)
        .eq("course_id", courseId)
        .eq("academic_year_id", academicYearId)
        .maybeSingle();

      let planId: string;

      if (existingPlan) {
        planId = existingPlan.id;
      } else {
        // Create a minimal payment plan so we have a container for the installment
        const total =
          paymentType === "enrollment"
            ? course.enrollment_fee || Number(amount)
            : course.monthly_fee || Number(amount);

        const { data: newPlan, error: planErr } = await supabase
          .from("payment_plans")
          .insert({
            institution_id: profile.institution_id,
            student_id: studentId,
            course_id: courseId,
            academic_year_id: academicYearId,
            total_amount: total,
            enrollment_fee: course.enrollment_fee || 0,
            tuition_amount: course.monthly_fee || 0,
            currency: "XOF",
            status: "pending",
          })
          .select("id")
          .single();

        if (planErr) throw planErr;
        planId = newPlan.id;
      }

      // 2. Find existing matching installment (same type, same label for monthly)
      let installmentId: string | null = null;

      const { data: existingInstallments } = await supabase
        .from("installments")
        .select("id, label, installment_type, amount_due, amount_paid")
        .eq("payment_plan_id", planId)
        .order("installment_number", { ascending: true });

      if (existingInstallments && existingInstallments.length > 0) {
        const match = existingInstallments.find(
          (inst) =>
            inst.installment_type === installmentType &&
            inst.label === installmentLabel
        );
        if (match) installmentId = match.id;
      }

      // 3. If no matching installment, create one
      if (!installmentId) {
        const nextNumber =
          (existingInstallments?.length ?? 0) + 1;

        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + 1);
        const dueDateStr = dueDate.toISOString().split("T")[0];

        const { data: newInst, error: instErr } = await supabase
          .from("installments")
          .insert({
            payment_plan_id: planId,
            student_id: studentId,
            academic_year_id: academicYearId,
            installment_number: nextNumber,
            label: installmentLabel,
            amount_due: Number(amount),
            due_date: dueDateStr,
            installment_type: installmentType,
          })
          .select("id")
          .single();

        if (instErr) throw instErr;
        installmentId = newInst.id;
      }

      // 4. Record the payment against the installment
      const noteText = [
        note.trim(),
        paymentType === "monthly" && month
          ? `Mensualité: ${MONTHS.find((m) => m.value === month)?.label ?? ""}`
          : null,
        paymentType === "enrollment" ? "Frais d'inscription" : null,
      ]
        .filter(Boolean)
        .join(" — ");

      const { data: payment, error: payErr } = await supabase
        .from("payments")
        .insert({
          installment_id: installmentId,
          student_id: studentId,
          academic_year_id: academicYearId,
          amount: Number(amount),
          payment_date: paymentDate,
          method,
          status: "completed",
          collected_by: profile.id,
          note: noteText || null,
        })
        .select("id")
        .single();

      if (payErr) throw payErr;

      // 5. Record the payment transaction (triggers recalc)
      const { error: txErr } = await supabase
        .from("payment_transactions")
        .insert({
          payment_id: payment.id,
          provider: "manual",
          amount: Number(amount),
          currency: "XOF",
          signature_verified: true,
        });

      if (txErr) throw txErr;

      const studentLabel =
        students.find((s) => s.id === studentId)?.student_number ?? "étudiant";

      toast({
        title: "Paiement enregistré",
        description: `${Number(amount).toLocaleString("fr-FR")} FCFA — ${installmentLabel} (${studentLabel})`,
      });

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

  const studentDisplay = (s: StudentOption) => {
    const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
    return name ? `${s.student_number} — ${name}` : s.student_number;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Banknote className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Enregistrer un paiement</DialogTitle>
              <DialogDescription>
                Encaissement rapide indépendant des échéanciers
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qp-year">Année académique *</Label>
              <Select value={academicYearId} onValueChange={setAcademicYearId} disabled={loading}>
                <SelectTrigger id="qp-year"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {academicYears.map((ay) => (
                    <SelectItem key={ay.id} value={ay.id}>{ay.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.academicYearId && <p className="text-xs text-destructive">{errors.academicYearId}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qp-course">Formation *</Label>
              <Select value={courseId} onValueChange={setCourseId} disabled={loading}>
                <SelectTrigger id="qp-course"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.courseId && <p className="text-xs text-destructive">{errors.courseId}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qp-student">Étudiant *</Label>
            <Select value={studentId} onValueChange={setStudentId} disabled={loading}>
              <SelectTrigger id="qp-student"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{studentDisplay(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.studentId && <p className="text-xs text-destructive">{errors.studentId}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qp-type">Type de paiement *</Label>
              <Select
                value={paymentType}
                onValueChange={(v) => setPaymentType(v as PaymentType)}
                disabled={loading}
              >
                <SelectTrigger id="qp-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="enrollment">Frais d'inscription</SelectItem>
                  <SelectItem value="monthly">Mensualité</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentType === "monthly" && (
              <div className="space-y-2">
                <Label htmlFor="qp-month">Mois *</Label>
                <Select value={month} onValueChange={setMonth} disabled={loading}>
                  <SelectTrigger id="qp-month"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.month && <p className="text-xs text-destructive">{errors.month}</p>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="qp-amount">Montant payé *</Label>
              <Input
                id="qp-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                placeholder="0.00"
              />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="qp-date">Date du paiement *</Label>
              <Input
                id="qp-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={loading}
              />
              {errors.paymentDate && <p className="text-xs text-destructive">{errors.paymentDate}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qp-method">Méthode de paiement</Label>
            <Select value={method} onValueChange={setMethod} disabled={loading}>
              <SelectTrigger id="qp-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qp-note">Note (optionnel)</Label>
            <Input
              id="qp-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={loading}
              placeholder="Note interne..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Annuler
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Enregistrer le paiement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
