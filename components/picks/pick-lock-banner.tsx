import { Clock, Lock, Unlock } from "lucide-react";

import { formatEasternDateTime } from "@/lib/nfl/scheduling";
import { cn } from "@/lib/utils";

export function PickLockBanner({
  pickLockTime,
  phaseStartDate,
  isLocked,
  isFuture = false,
}: {
  pickLockTime: Date;
  phaseStartDate: Date;
  isLocked: boolean;
  isFuture?: boolean;
}) {
  const variant = isLocked ? "locked" : isFuture ? "future" : "open";
  const Icon =
    variant === "locked" ? Lock : variant === "future" ? Clock : Unlock;
  const message =
    variant === "locked"
      ? "Picks locked for this phase"
      : variant === "future"
        ? `This week opens for picks ${formatEasternDateTime(phaseStartDate)}`
        : `Picks lock ${formatEasternDateTime(pickLockTime)}`;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
        variant === "locked"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
