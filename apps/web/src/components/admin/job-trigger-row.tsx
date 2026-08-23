import { cn } from "@/lib/utils";
import { rowClassName } from "@/components/row";
import { Button } from "@/components/ui/button";

/**
 * One operator job trigger on the admin Jobs tab: label + what the job does,
 * with a Run button that disables only while *this* row's run is pending
 * (async-button standard — the caller scopes `pending` off its mutation's
 * variables where several rows share one mutation).
 */
export function JobTriggerRow({
  label,
  description,
  pending,
  onRun,
}: {
  label: string;
  description: string;
  pending: boolean;
  onRun: () => void;
}) {
  return (
    <div
      className={cn(
        rowClassName,
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" disabled={pending} onClick={onRun}>
        Run
      </Button>
    </div>
  );
}
