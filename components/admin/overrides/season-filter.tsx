"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SeasonFilter({
  seasons,
  current,
}: {
  seasons: Array<{ id: string; year: number }>;
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(nextSeasonId: string) {
    const next = new URLSearchParams(params.toString());
    next.set("season", nextSeasonId);
    // Phase filter is scoped to a single season — reset when switching.
    next.delete("phase");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-48">
        <SelectValue placeholder="Select season" />
      </SelectTrigger>
      <SelectContent>
        {seasons.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.year} season
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
