import { LockIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export function LockBadge({ lockedAt }: { lockedAt: Date | null }) {
  if (!lockedAt) return null;
  return (
    <Badge variant="secondary" className="gap-1">
      <LockIcon className="size-3" />
      Locked
    </Badge>
  );
}
