import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  color = "text-primary",
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  color?: string;
}) {
  return (
    <Card className="group p-5 border-border/80 hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
          <p className="text-[29px] leading-none font-bold tracking-tight mt-2 text-foreground">{value}</p>
          {trend && <p className="text-xs text-muted-foreground mt-1">{trend}</p>}
        </div>
        <div className={`p-2.5 rounded-xl bg-muted/80 ${color} transition-transform duration-200 group-hover:scale-105`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </Card>
  );
}
