import { formatInTimeZone } from "date-fns-tz";
import { Lock, Unlock } from "lucide-react";

import { cn } from "@/lib/utils";

const DISPLAY_TIME_ZONE = "America/New_York";

export function PickLockBanner({
  pickLockTime,
  isLocked,
}: {
  pickLockTime: Date;
  isLocked: boolean;
}) {
  const formatted = formatInTimeZone(
    pickLockTime,
    DISPLAY_TIME_ZONE,
    "EEE MMM d, h:mm a 'ET'",
  );

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
        isLocked
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {isLocked ? (
        <Lock className="h-4 w-4" aria-hidden />
      ) : (
        <Unlock className="h-4 w-4" aria-hidden />
      )}
      <span>
        {isLocked ? "Picks locked for this phase" : `Picks lock ${formatted}`}
      </span>
    </div>
  );
}
