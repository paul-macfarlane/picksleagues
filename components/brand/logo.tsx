import { LogoMark } from "@/components/brand/logo-mark";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="h-7 w-7" title="PicksLeagues logo" />
      <span className="text-base font-bold tracking-tight sm:text-lg">
        PicksLeagues
      </span>
    </span>
  );
}
