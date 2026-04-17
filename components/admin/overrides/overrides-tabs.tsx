import Link from "next/link";

import { cn } from "@/lib/utils";
import type { OverrideEntity } from "@/lib/validators/admin-overrides";

const TABS: ReadonlyArray<{ value: OverrideEntity; label: string }> = [
  { value: "team", label: "Teams" },
  { value: "phase", label: "Phases" },
  { value: "event", label: "Events" },
  { value: "odds", label: "Odds" },
];

export type OverridesTabValue = OverrideEntity;

export function OverridesTabs({ active }: { active: OverridesTabValue }) {
  return (
    <nav
      aria-label="Override entity tabs"
      className="flex w-full overflow-x-auto rounded-lg bg-muted p-1 text-sm"
    >
      {TABS.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={{ pathname: "/admin/overrides", query: { tab: tab.value } }}
            scroll={false}
            className={cn(
              "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-center font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
