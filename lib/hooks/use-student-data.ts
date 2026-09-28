"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";

type Student = Database["public"]["Tables"]["students"]["Row"];
type Enrollment = Database["public"]["Tables"]["enrollments"]["Row"];
type Schedule = Database["public"]["Tables"]["schedules"]["Row"];
type Attendance = Database["public"]["Tables"]["attendance"]["Row"];
type Grade = Database["public"]["Tables"]["grades"]["Row"];
type Assessment = Database["public"]["Tables"]["assessments"]["Row"];
type PaymentPlan = Database["public"]["Tables"]["payment_plans"]["Row"];
type Installment = Database["public"]["Tables"]["installments"]["Row"];
type Payment = Database["public"]["Tables"]["payments"]["Row"];
type Document = Database["public"]["Tables"]["documents"]["Row"];
type Notification = Database["public"]["Tables"]["notifications"]["Row"];
type Certificate = Database["public"]["Tables"]["certificates"]["Row"];

export type EnrollmentWithRelations = Enrollment & {
  courses?: { name: string; programs?: { name: string } };
  classes?: { name: string; capacity: number; room: string | null };
  academic_years?: { name: string };
};

export type ScheduleWithRelations = Schedule & {
  classes?: { name: string };
  subjects?: { name: string; code: string };
  teachers?: { teacher_number: string; specialization: string | null };
};

export type AssessmentWithRelations = Assessment & {
  classes?: { name: string };
  subjects?: { name: string; code: string };
};

export type GradeWithAssessment = Grade & {
  assessments?: AssessmentWithRelations;
};

export type PlanWithRelations = PaymentPlan & {
  courses?: { name: string };
  academic_years?: { name: string };
};

export interface StudentPortalData {
  student: Student | null;
  enrollments: EnrollmentWithRelations[];
  schedules: ScheduleWithRelations[];
  attendance: (Attendance & { schedules?: ScheduleWithRelations })[];
  grades: GradeWithAssessment[];
  paymentPlans: PlanWithRelations[];
  installments: Record<string, Installment[]>;
  payments: Record<string, Payment[]>;
  documents: Document[];
  notifications: Notification[];
  certificates: (Certificate & { courses?: { name: string } })[];
  loading: boolean;
  refresh: () => void;
}

interface CachedData {
  student: Student | null;
  enrollments: EnrollmentWithRelations[];
  schedules: ScheduleWithRelations[];
  attendance: (Attendance & { schedules?: ScheduleWithRelations })[];
  grades: GradeWithAssessment[];
  paymentPlans: PlanWithRelations[];
  installments: Record<string, Installment[]>;
  payments: Record<string, Payment[]>;
  documents: Document[];
  notifications: Notification[];
  certificates: (Certificate & { courses?: { name: string } })[];
}

let cache: CachedData | null = null;

export function useStudentData(): StudentPortalData {
  const [student, setStudent] = useState<Student | null>(cache?.student ?? null);
  const [enrollments, setEnrollments] = useState<EnrollmentWithRelations[]>(cache?.enrollments ?? []);
  const [schedules, setSchedules] = useState<ScheduleWithRelations[]>(cache?.schedules ?? []);
  const [attendance, setAttendance] = useState<(Attendance & { schedules?: ScheduleWithRelations })[]>(cache?.attendance ?? []);
  const [grades, setGrades] = useState<GradeWithAssessment[]>(cache?.grades ?? []);
  const [paymentPlans, setPaymentPlans] = useState<PlanWithRelations[]>(cache?.paymentPlans ?? []);
  const [installments, setInstallments] = useState<Record<string, Installment[]>>(cache?.installments ?? {});
  const [payments, setPayments] = useState<Record<string, Payment[]>>(cache?.payments ?? {});
  const [documents, setDocuments] = useState<Document[]>(cache?.documents ?? []);
  const [notifications, setNotifications] = useState<Notification[]>(cache?.notifications ?? []);
  const [certificates, setCertificates] = useState<(Certificate & { courses?: { name: string } })[]>(cache?.certificates ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [refreshKey, setRefreshKey] = useState(0);
  const initializedRef = useRef(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!initializedRef.current && cache) {
        initializedRef.current = true;
      }
      const hasCache = cache !== null;
      if (!hasCache) setLoading(true);
      try {
        const { data: studentData } = await supabase
          .from("students")
          .select("*")
          .eq("profile_id", (await supabase.auth.getUser()).data.user?.id ?? "")
          .maybeSingle();
        if (cancelled || !studentData) { if (!cancelled) setLoading(false); return; }
        if (!hasCache) setStudent(studentData);

        const sid = studentData.id;

        const [enrRes, schRes, attRes, gradeRes, planRes, docRes, notifRes, certRes] = await Promise.all([
          supabase.from("enrollments").select("*, courses(name, programs(name)), classes(name, capacity, room), academic_years(name)").eq("student_id", sid).order("enrollment_date", { ascending: false }),
          supabase.from("schedules").select("*, classes(name), subjects(name, code), teachers(teacher_number, specialization)").order("day_of_week", { ascending: true }).order("start_time", { ascending: true }),
          supabase.from("attendance").select("*, schedules(*, classes(name), subjects(name, code), teachers(teacher_number, specialization))").eq("student_id", sid).order("date", { ascending: false }),
          supabase.from("grades").select("*, assessments(*, classes(name), subjects(name, code))").eq("student_id", sid).eq("status", "validated").order("created_at", { ascending: false }),
          supabase.from("payment_plans").select("*, courses(name), academic_years(name)").eq("student_id", sid).order("created_at", { ascending: false }),
          supabase.from("document_students").select("document_id, documents(*)").eq("student_id", sid),
          supabase.from("notifications").select("*").eq("profile_id", studentData.profile_id ?? "").order("created_at", { ascending: false }).limit(50),
          supabase.from("certificates").select("*, courses(name)").eq("student_id", sid).order("created_at", { ascending: false }),
        ]);

        if (cancelled) return;

        const newEnrollments = enrRes.data ?? [];
        const newSchedules = schRes.data ?? [];
        const newAttendance = attRes.data ?? [];
        const newGrades = (gradeRes.data ?? []).filter((g) => {
          const asmtStatus = g.assessments?.status;
          return asmtStatus === "published" || asmtStatus === "validated";
        }) as GradeWithAssessment[];
        const newPaymentPlans = planRes.data ?? [];
        const newDocuments = (docRes.data ?? []).map((d: unknown) => (d as { documents: Document }).documents).filter(Boolean);
        const newNotifications = notifRes.data ?? [];
        const newCertificates = certRes.data ?? [];

        setStudent(studentData);
        setEnrollments(newEnrollments);
        setSchedules(newSchedules);
        setAttendance(newAttendance);
        setGrades(newGrades);
        setPaymentPlans(newPaymentPlans);
        setDocuments(newDocuments);
        setNotifications(newNotifications);
        setCertificates(newCertificates);

        const instMap: Record<string, Installment[]> = {};
        const payMap: Record<string, Payment[]> = {};
        for (const plan of newPaymentPlans) {
          const { data: insts } = await supabase.from("installments").select("*").eq("payment_plan_id", plan.id).order("installment_number", { ascending: true });
          instMap[plan.id] = insts ?? [];
          const instIds = (insts ?? []).map((i) => i.id);
          if (instIds.length > 0) {
            const { data: pays } = await supabase.from("payments").select("*").in("installment_id", instIds).order("payment_date", { ascending: false });
            payMap[plan.id] = pays ?? [];
          } else {
            payMap[plan.id] = [];
          }
        }
        if (!cancelled) {
          setInstallments(instMap);
          setPayments(payMap);

          cache = {
            student: studentData,
            enrollments: newEnrollments,
            schedules: newSchedules,
            attendance: newAttendance,
            grades: newGrades,
            paymentPlans: newPaymentPlans,
            installments: instMap,
            payments: payMap,
            documents: newDocuments,
            notifications: newNotifications,
            certificates: newCertificates,
          };
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return {
    student, enrollments, schedules, attendance, grades,
    paymentPlans, installments, payments, documents, notifications, certificates,
    loading, refresh,
  };
}
