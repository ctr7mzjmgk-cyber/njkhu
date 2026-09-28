import type { Database } from "@/lib/types/database";

type Staff = Database["public"]["Tables"]["hr_staff"]["Row"];

export function getStaffDisplayName(
  s: Pick<Staff, "first_name" | "last_name" | "staff_number">
): string {
  const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
  return name || s.staff_number;
}

export function getStaffInitials(
  s: Pick<Staff, "first_name" | "last_name">
): string {
  return `${s.first_name?.[0] ?? "?"}${s.last_name?.[0] ?? ""}`.toUpperCase();
}
