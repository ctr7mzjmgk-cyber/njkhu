"use client";

import { supabase } from "@/lib/supabase/client";

export interface SchoolCertificateStudent {
  id: string;
  student_number: string;
  civility: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  birth_date: string | null;
  birth_place: string | null;
  gender: string | null;
  nationality: string | null;
  status: string;
  admission_date: string;
}

export interface SchoolCertificateEnrollment {
  id: string | null;
  status: string | null;
  enrollment_date: string | null;
}

export interface SchoolCertificateAcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface SchoolCertificateCourse {
  id: string | null;
  name: string | null;
  status: string | null;
}

export interface SchoolCertificateProgram {
  id: string | null;
  name: string | null;
  code: string | null;
  duration_years: number | null;
}

export interface SchoolCertificateClass {
  id: string | null;
  name: string | null;
  room: string | null;
}

export interface SchoolCertificateInstitution {
  id: string;
  name: string;
  short_name: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  republic_name: string | null;
  motto: string | null;
  ministry: string | null;
  flag_url: string | null;
  header_separator: string | null;
  director_name: string | null;
  director_function: string | null;
  signature_url: string | null;
  stamp_url: string | null;
}

export interface SchoolCertificateData {
  certificate_number: string;
  qr_token: string;
  issue_date: string;
  issue_place: string;
  student: SchoolCertificateStudent;
  enrollment: SchoolCertificateEnrollment;
  academic_year: SchoolCertificateAcademicYear;
  course: SchoolCertificateCourse;
  program: SchoolCertificateProgram;
  class: SchoolCertificateClass;
  institution: SchoolCertificateInstitution;
}

export async function fetchSchoolCertificate(
  studentId: string,
  academicYearId: string
): Promise<{ data: SchoolCertificateData | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_school_certificate", {
    p_student_id: studentId,
    p_academic_year_id: academicYearId,
  });

  if (error) {
    return { data: null, error: error.message };
  }
  if (!data) {
    return { data: null, error: "Aucune donnée retournée par la base." };
  }
  return { data: data as unknown as SchoolCertificateData, error: null };
}
