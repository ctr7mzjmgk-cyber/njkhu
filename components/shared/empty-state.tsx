import { Inbox } from "lucide-react";

export function EmptyState({
  title = "Aucune donnée disponible",
  message,
  action,
}: {
  title?: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Inbox className="w-7 h-7 text-muted-foreground/60" />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {message && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
